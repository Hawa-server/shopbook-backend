// repayment.create, debtWriteOff.create and openingDebt.create (BE9, Epic 4),
// each with its REVERSAL. All PERMANENT records: never changed or deleted.
//
// - A repayment can be recorded by anyone (F-17). More than the customer
//   owes is SAVED and flagged `overpaid` (Decision 4-5): the money was really
//   received; the extra becomes credit for their next purchase.
// - A write-off: owner only (Decision 4-1). A debt brought forward from the
//   notebook: owner and manager (Decision 4-8).
// - A wrong record is fixed with a REVERSAL (Decision 4-9): a record of the
//   same kind with `corrects…Id` and a reason, which cancels the original IN
//   FULL (the server copies the amount, customer and method: nothing sent
//   twice). Once only; a reversal can't be reversed. Repayments and debts
//   brought forward: owner and manager; write-offs: owner.
// - Every one updates the customer's debt lots and cached balance in the
//   same transaction (src/services/debtLots.js). The customer row is locked
//   first, then the original being reversed (runOperation's lock order).

const { z } = require('zod');
const locale = require('../../locale');
const { dateIn } = require('../../lib/time');
const debtLots = require('../../services/debtLots');
const { flagsFor } = require('../../services/saleView');
const { insertNew, clockSkew, registerReceipt, markMoneyRecorded, updateDebts, lockCustomer } = require('./common');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = () => z.string().trim().toLowerCase().regex(UUID, 'Must be an ID made with crypto.randomUUID().');
const tidy = (t) => t.normalize('NFC').trim();
const text = (empty) => z.string().transform(tidy).pipe(z.string().min(1, empty).max(200, 'Use at most 200 characters.'));
const amount = () => z.number({ error: 'Enter an amount.' }).int('Use whole minor units.').min(1, 'The amount must be more than zero.').max(1e15);
const recordedAt = () => z.iso.datetime({ error: 'Give the time it was recorded (UTC ISO 8601).' });
const receipt = () => z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,4}-[0-9]{1,9}$/, 'A receipt number looks like K7M-0042.');
const invalid = (ctx, fields) => ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', fields);

// Refuses a role (FORBIDDEN) unless it's one of `roles`.
function allow(ctx, roles, what) {
  if (!roles.includes(ctx.membership.role)) ctx.reject('FORBIDDEN', `Your role can't ${what}.`);
}

// The checks every reversal shares: the original exists in this business,
// belongs to the customer the phone names, isn't itself a reversal, and
// hasn't been reversed already.
//
// ORDER MATTERS: the customer is locked FIRST and nothing is read before
// that. In MySQL the first ordinary read of a transaction fixes what it
// sees from then on; reading the original before waiting for the customer's
// lock could make this transaction miss a record another phone committed in
// the meantime, and rebuild the customer's lots without it. So the phone
// names the customer, and every read here is a LOCKING read (always the
// latest data). Returns the original.
async function originalFor(ctx, model, column, originalId, customerId) {
  await lockCustomer(ctx, customerId);
  const [original] = await ctx.lock('reversal', model, { id: originalId });
  if (!original || original.customerId !== customerId) ctx.reject('NOT_FOUND', "The record to reverse doesn't exist for this customer.", { [column]: 'Unknown record.' });
  if (original[column]) ctx.reject('CANNOT_REVERSE_A_REVERSAL', "A reversal can't be reversed: record the original again instead.");
  const earlier = await ctx.lock('reversal', model, { [column]: originalId });
  if (earlier.length > 0) ctx.reject('ALREADY_REVERSED', 'This record has already been reversed.');
  return original;
}

// Inserts a reversal; the database's one-reversal-per-original key is the
// last guard (ALREADY_REVERSED), and any other clash is ID_TAKEN.
async function insertReversal(ctx, model, row) {
  try {
    await ctx.s[model].create(row, { transaction: ctx.transaction });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      if (/reversal/.test(err.parent?.sqlMessage ?? '')) ctx.reject('ALREADY_REVERSED', 'This record has already been reversed.');
      ctx.reject('ID_TAKEN', 'This ID is already used. Make a new one.');
    }
    throw err;
  }
}

// ---- repayment.create ------------------------------------------------------

const repaymentSchema = z.union([
  z.object({
    repaymentId: id(), receiptNumber: receipt(), customerId: id(), amountMinor: amount(),
    method: z.string().trim().min(1).max(30), note: text('Write a note.').nullable().optional(), recordedAt: recordedAt(),
  }).strict(),
  z.object({
    repaymentId: id(), receiptNumber: receipt(), customerId: id(), correctsRepaymentId: id(), correctionReason: text('Give the reason.'), recordedAt: recordedAt(),
  }).strict(),
], { error: 'Send either a repayment (customerId, amountMinor, method) or a reversal (correctsRepaymentId, correctionReason).' });

// A repayment, or the reversal of one.
async function repaymentHandler(ctx, p) {
  const at = new Date(p.recordedAt);
  const flags = { overpaid: false, methodDisabled: false, clockSkew: clockSkew(ctx, at) };

  if (p.correctsRepaymentId) {
    allow(ctx, ['owner', 'manager'], 'correct repayments');
    const original = await originalFor(ctx, 'Repayment', 'correctsRepaymentId', p.correctsRepaymentId, p.customerId);
    await registerReceipt(ctx, p.receiptNumber, 'repayment', p.repaymentId);
    await insertReversal(ctx, 'Repayment', {
      id: p.repaymentId, customerId: original.customerId, deviceId: ctx.device.id, receiptNumber: p.receiptNumber,
      amountMinor: Number(original.amountMinor), method: original.method, note: null,
      correctsRepaymentId: original.id, correctionReason: p.correctionReason, flags,
      recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
    });
    ctx.stamp('Repayment', { id: p.repaymentId });
    const { balanceMinor } = await updateDebts(ctx, original.customerId, null, { full: true });
    return { repaymentId: p.repaymentId, receiptNumber: p.receiptNumber, reversesReceiptNumber: original.receiptNumber, balanceMinor, flags: flagsFor(ctx.membership.role, flags) };
  }

  const customer = await lockCustomer(ctx, p.customerId);
  if (!Object.hasOwn(locale.PAYMENT_METHODS, p.method)) {
    ctx.reject('PAYMENT_METHOD_UNKNOWN', 'Unknown payment method.', { method: 'Unknown payment method.' });
  }
  const enabled = (await ctx.s.BusinessSettings.findOne({ where: {}, transaction: ctx.transaction })).paymentMethods;
  flags.methodDisabled = !enabled.includes(p.method);
  flags.overpaid = p.amountMinor > Math.max(0, Number(customer.balanceMinor)); // Decision 4-5: saved, flagged
  await registerReceipt(ctx, p.receiptNumber, 'repayment', p.repaymentId);
  await insertNew(ctx, 'Repayment', {
    id: p.repaymentId, customerId: customer.id, deviceId: ctx.device.id, receiptNumber: p.receiptNumber, amountMinor: p.amountMinor,
    method: p.method, note: p.note ?? null, flags, recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  ctx.stamp('Repayment', { id: p.repaymentId });
  const { balanceMinor } = await updateDebts(ctx, customer.id, debtLots.repaymentEvent({ id: p.repaymentId, amountMinor: p.amountMinor, recordedAt: at }));
  await markMoneyRecorded(ctx);
  return { repaymentId: p.repaymentId, receiptNumber: p.receiptNumber, balanceMinor, flags: flagsFor(ctx.membership.role, flags) };
}

// ---- debtWriteOff.create (owner only) ---------------------------------------

const writeOffSchema = z.union([
  z.object({
    writeOffId: id(), customerId: id(), amountMinor: amount(),
    reason: z.enum(['moved', 'died', 'disputed', 'other'], { error: 'Choose a reason.' }), note: text('Write a note.').nullable().optional(), recordedAt: recordedAt(),
  }).strict(),
  z.object({ writeOffId: id(), customerId: id(), correctsDebtWriteOffId: id(), correctionReason: text('Give the reason.'), recordedAt: recordedAt() }).strict(),
], { error: 'Send either a write-off (customerId, amountMinor, reason) or a reversal (correctsDebtWriteOffId, correctionReason).' });

// A write-off, or the reversal of one.
async function writeOffHandler(ctx, p) {
  const at = new Date(p.recordedAt);
  if (p.correctsDebtWriteOffId) {
    const original = await originalFor(ctx, 'DebtWriteOff', 'correctsDebtWriteOffId', p.correctsDebtWriteOffId, p.customerId);
    await insertReversal(ctx, 'DebtWriteOff', {
      id: p.writeOffId, customerId: original.customerId, amountMinor: Number(original.amountMinor), reason: original.reason, note: original.note,
      correctsDebtWriteOffId: original.id, correctionReason: p.correctionReason, recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
    });
    ctx.stamp('DebtWriteOff', { id: p.writeOffId });
    const { balanceMinor } = await updateDebts(ctx, original.customerId, null, { full: true });
    return { writeOffId: p.writeOffId, balanceMinor };
  }
  if (p.reason === 'other' && !p.note) invalid(ctx, { note: 'Write what happened.' });
  const customer = await lockCustomer(ctx, p.customerId);
  await insertNew(ctx, 'DebtWriteOff', {
    id: p.writeOffId, customerId: customer.id, amountMinor: p.amountMinor, reason: p.reason, note: p.note ?? null,
    recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  ctx.stamp('DebtWriteOff', { id: p.writeOffId });
  const { balanceMinor } = await updateDebts(ctx, customer.id, debtLots.writeOffEvent({ id: p.writeOffId, amountMinor: p.amountMinor, recordedAt: at }));
  await markMoneyRecorded(ctx);
  return { writeOffId: p.writeOffId, balanceMinor };
}

// ---- openingDebt.create (owner and manager) ----------------------------------

const openingSchema = z.union([
  z.object({
    openingDebtId: id(), customerId: id(), amountMinor: amount(),
    owedSince: z.iso.date({ error: 'Give the date the debt started (YYYY-MM-DD).' }), note: text('Write a note.').nullable().optional(), recordedAt: recordedAt(),
  }).strict(),
  z.object({ openingDebtId: id(), customerId: id(), correctsOpeningDebtId: id(), correctionReason: text('Give the reason.'), recordedAt: recordedAt() }).strict(),
], { error: 'Send either a debt brought forward (customerId, amountMinor, owedSince) or a reversal (correctsOpeningDebtId, correctionReason).' });

// A debt brought forward from the notebook, or the reversal of one.
async function openingHandler(ctx, p) {
  const at = new Date(p.recordedAt);
  if (p.correctsOpeningDebtId) {
    const original = await originalFor(ctx, 'OpeningDebt', 'correctsOpeningDebtId', p.correctsOpeningDebtId, p.customerId);
    await insertReversal(ctx, 'OpeningDebt', {
      id: p.openingDebtId, customerId: original.customerId, deviceId: ctx.device.id, amountMinor: Number(original.amountMinor),
      owedSince: original.owedSince, note: null, correctsOpeningDebtId: original.id, correctionReason: p.correctionReason,
      recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
    });
    ctx.stamp('OpeningDebt', { id: p.openingDebtId });
    const { balanceMinor } = await updateDebts(ctx, original.customerId, null, { full: true });
    return { openingDebtId: p.openingDebtId, balanceMinor };
  }
  if (p.owedSince > dateIn(ctx.business.timezone, ctx.now.getTime())) invalid(ctx, { owedSince: "The date can't be in the future." });
  const customer = await lockCustomer(ctx, p.customerId);
  await insertNew(ctx, 'OpeningDebt', {
    id: p.openingDebtId, customerId: customer.id, deviceId: ctx.device.id, amountMinor: p.amountMinor, owedSince: p.owedSince,
    note: p.note ?? null, recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  ctx.stamp('OpeningDebt', { id: p.openingDebtId });
  const event = debtLots.openingEvent({ id: p.openingDebtId, amountMinor: p.amountMinor, owedSince: p.owedSince, recordedAt: at }, ctx.business.timezone);
  const { balanceMinor } = await updateDebts(ctx, customer.id, event);
  await markMoneyRecorded(ctx);
  return { openingDebtId: p.openingDebtId, balanceMinor };
}

module.exports = {
  repaymentCreate: { roles: ['owner', 'manager', 'associate'], schema: repaymentSchema, handler: repaymentHandler },
  debtWriteOffCreate: { roles: ['owner'], schema: writeOffSchema, handler: writeOffHandler },
  openingDebtCreate: { roles: ['owner', 'manager'], schema: openingSchema, handler: openingHandler },
};
