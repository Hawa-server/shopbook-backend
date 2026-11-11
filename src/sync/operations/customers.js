// customer.upsert (BE8 add, BE9 edit; Epic 4 AC1–AC9).
//
// - Everyone may ADD a customer (often in the middle of a sale); the
//   business's default credit limit and language are copied in.
// - Only the owner and manager may EDIT (name, phone, language, hide); only
//   the OWNER may set or remove a credit limit (Decision 4-3, 4-4).
// - Editing is "last change received wins, with history" like products:
//   the phone says which version it edited, ChangeLog keeps both.
// - A customer who owes (or is owed) can't be hidden (AC6).
// - Two customers with the same phone number is a WARNING, never an error:
//   family members share phones (AC3).
// - The balance and oldestUnpaidAt are never sent by a phone: the server
//   works them out (debt lots).

const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { z } = require('zod');
const locale = require('../../locale');
const { formatMoney } = require('../../locale/money');
const { normalizePhone } = require('../../lib/phone');
const { insertNew, lockCustomer } = require('./common');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PHONE_MESSAGE = 'Enter a valid mobile number, for example 024 123 4567.';
const tidy = (t) => t.normalize('NFC').trim().replace(/\s+/g, ' ');

const schema = z.object({
  customerId: z.string().trim().toLowerCase().regex(UUID, 'Must be an ID made with crypto.randomUUID().'),
  baseVersion: z.number().int().min(1).nullable(),
  fields: z.object({
    name: z.string().transform(tidy).pipe(z.string().min(1, "Enter the customer's name.").max(80, 'Use at most 80 characters.')),
    phone: z.string().max(30).nullable(),
    language: z.enum(Object.keys(locale.LANGUAGES), { error: 'Choose one of the supported languages.' }),
    creditLimitMinor: z.number().int().min(0).max(1e15).nullable(), // owner only
    isHidden: z.boolean(),
  }).partial().strict().refine((f) => Object.keys(f).length > 0, { message: 'Give at least one field.' }),
});

const invalid = (ctx, fields) => ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', fields);
const KEYS = ['name', 'phone', 'language', 'creditLimitMinor', 'isHidden'];
// History values (the phone number is personal data: only whether there is one).
function snapshot(row, keys) {
  return Object.fromEntries(keys.map((k) => (k === 'phone' ? ['hasPhone', Boolean(row.phone)] : [k, k === 'creditLimitMinor' && row[k] != null ? Number(row[k]) : row[k] ?? null])));
}

// The phone number in E.164 (or null), or a rejection.
function phoneOf(ctx, fields) {
  if (!('phone' in fields) || !fields.phone) return null;
  const phone = normalizePhone(fields.phone, ctx.business.country);
  if (!phone) invalid(ctx, { phone: PHONE_MESSAGE });
  return phone;
}

// Another customer with the same phone number: a warning with their ID.
async function phoneWarnings(ctx, customerId, phone) {
  if (!phone) return [];
  const same = await ctx.s.Customer.findOne({ where: { phone, id: { [Op.ne]: customerId } }, attributes: ['id'], transaction: ctx.transaction });
  return same ? [{ code: 'CUSTOMER_PHONE_DUPLICATE', customerId: same.id }] : [];
}

// Adds or edits one customer.
async function handler(ctx, { customerId, baseVersion, fields }) {
  const role = ctx.membership.role;
  if ('creditLimitMinor' in fields && role !== 'owner') {
    ctx.reject('FORBIDDEN', 'Only the owner can set credit limits.', { creditLimitMinor: 'Only the owner can set credit limits.' });
  }
  const phone = phoneOf(ctx, fields);
  const history = (before, after, conflict) => ctx.s.ChangeLog.create({
    id: randomUUID(), entity: 'customer', entityId: customerId, changedBy: ctx.user.id, changedAt: ctx.now, before, after, conflict,
  }, { transaction: ctx.transaction });

  if (baseVersion === null) {
    // ---- Add (anyone).
    if (!fields.name) invalid(ctx, { name: "Enter the customer's name." });
    const settings = await ctx.s.BusinessSettings.findOne({ where: {}, transaction: ctx.transaction });
    const row = {
      id: customerId, name: fields.name, nameNormalized: fields.name.toLowerCase(), phone,
      language: fields.language ?? settings.defaultLanguage,
      creditLimitMinor: 'creditLimitMinor' in fields ? fields.creditLimitMinor
        : settings.defaultCreditLimitMinor === null ? null : Number(settings.defaultCreditLimitMinor),
      isHidden: false, balanceMinor: 0, version: 1, createdBy: ctx.user.id, updatedBy: ctx.user.id,
    };
    await insertNew(ctx, 'Customer', row);
    await history(null, { ...snapshot(row, KEYS), version: 1 }, false);
    ctx.stamp('Customer', { id: customerId });
    return { customerId, version: 1, warnings: await phoneWarnings(ctx, customerId, phone) };
  }

  // ---- Edit (owner and manager).
  if (role === 'associate') ctx.reject('FORBIDDEN', "Your role can't edit customers.");
  const customer = await lockCustomer(ctx, customerId);
  if (fields.isHidden === true && Number(customer.balanceMinor) !== 0) {
    const amount = formatMoney(Math.abs(Number(customer.balanceMinor)), ctx.business.currency);
    const message = Number(customer.balanceMinor) > 0 ? `${customer.name} still owes ${amount}.` : `The shop still owes ${customer.name} ${amount}.`;
    ctx.reject('CUSTOMER_OWES', message, { isHidden: message });
  }
  const changes = { ...fields };
  if ('phone' in fields) changes.phone = phone;
  if (fields.name) changes.nameNormalized = fields.name.toLowerCase();
  const version = customer.version + 1;
  await ctx.s.Customer.update({ ...changes, version, updatedBy: ctx.user.id }, { where: { id: customerId }, transaction: ctx.transaction });
  const keys = KEYS.filter((k) => k in fields);
  await history({ ...snapshot(customer, keys), version: customer.version }, { ...snapshot({ ...customer.get({ plain: true }), ...changes }, keys), version }, baseVersion < customer.version);
  ctx.stamp('Customer', { id: customerId });
  return { customerId, version, warnings: 'phone' in fields ? await phoneWarnings(ctx, customerId, phone) : [] };
}

module.exports = { customerUpsert: { roles: ['owner', 'manager', 'associate'], schema, handler } };
