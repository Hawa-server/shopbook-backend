// Pieces shared by the money operations (sales BE8; repayments, write-offs
// and debts brought forward BE9), so each rule lives in ONE place.

const { Op } = require('sequelize');
const { insertNew, clockSkew } = require('./stock');
const debtLots = require('../../services/debtLots');

// Writes `number` in the receipt registry for a record of `recordType`
// (sale, correction or repayment), in the operation's transaction. The
// number must start with THIS phone's code, and is used once in the whole
// business (RECEIPT_NUMBER_INVALID / RECEIPT_NUMBER_TAKEN).
async function registerReceipt(ctx, number, recordType, recordId) {
  const prefix = number.split('-')[0];
  if (prefix !== ctx.device.deviceCode) {
    ctx.reject('RECEIPT_NUMBER_INVALID', "This receipt number doesn't start with this phone's code.", { receiptNumber: `It must start with ${ctx.device.deviceCode}-.` });
  }
  try {
    await ctx.s.ReceiptNumber.create({ receiptNumber: number, recordType, recordId, deviceId: ctx.device.id, createdAt: ctx.now }, { transaction: ctx.transaction });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') ctx.reject('RECEIPT_NUMBER_TAKEN', 'This receipt number is already used.', { receiptNumber: 'Already used.' });
    throw err;
  }
}

// The business's first money record (a sale, repayment, debt brought
// forward or write-off) locks its country, currency and time zone.
async function markMoneyRecorded(ctx) {
  if (ctx.business.moneyRecordedAt) return;
  await ctx.models.Business.update({ moneyRecordedAt: ctx.now }, {
    where: { id: ctx.business.id, moneyRecordedAt: { [Op.is]: null } }, transaction: ctx.transaction,
  });
}

// Brings the customer's debt lots and cached balance up to date after a new
// debt record (the newest goes on top; a late one or a reversal rebuilds in
// full), and gives the customer row a new sequence number when the balance changed.
async function updateDebts(ctx, customerId, event, { full = false } = {}) {
  const where = { businessId: ctx.business.id, customerId, timeZone: ctx.business.timezone };
  const outcome = full ? await debtLots.rebuildFull(ctx.models, ctx.transaction, where) : await debtLots.applyNewEvent(ctx.models, ctx.transaction, where, event);
  if (outcome.changed) ctx.stamp('Customer', { id: customerId });
  return outcome;
}

// Locks the customer (first in the lock order) or rejects NOT_FOUND.
async function lockCustomer(ctx, customerId) {
  const [customer] = await ctx.lock('customer', 'Customer', { id: customerId });
  if (!customer) ctx.reject('NOT_FOUND', "This customer doesn't exist.", { customerId: 'Unknown customer.' });
  return customer;
}

module.exports = { insertNew, clockSkew, registerReceipt, markMoneyRecorded, updateDebts, lockCustomer };
