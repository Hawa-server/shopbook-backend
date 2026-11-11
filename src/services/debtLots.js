// The debt-lot service (BE9): keeps ONE customer's debt lots, credit lots
// and allocations (the worked-out view of what they owe) and the cached
// balance on the customer row in step with their permanent records.
//
// It's called inside an operation's transaction with the customer row
// already locked (runOperation's lock order), so nobody ever sees a
// half-rebuilt balance and two phones can't rebuild the same customer at once.
//
// Two paths, one rule (debtRule.apply):
// - THE NEWEST EVENT (the usual case: its order key comes after everything
//   already processed): applied on top of the customer's open lots, nothing
//   replayed. Fast however long the history.
// - A LATE EVENT OR A REVERSAL: the customer is rebuilt in full from their
//   permanent records. This is the only code allowed to delete rows of the
//   three worked-out tables (PROJECTION_MODELS), and only one customer's,
//   inside the transaction (approved by the owner, 11 Nov 2026).
// check:balances rebuilds every customer in full and compares, so the fast
// path is always checked against the full one.

const { Op } = require('sequelize');
const rule = require('./debtRule');
const { startOfDay } = require('../lib/time');
const { PROJECTION_MODELS } = require('../models');

const num = (v) => Number(v);

// ---- Permanent records → events -------------------------------------------

// A credit sale's debt event (only its credit part is a debt).
const saleEvent = (s) => ({ kind: 'credit_sale', id: s.id, effectiveAt: s.recordedAt, recordedAt: s.recordedAt, amountMinor: num(s.creditMinor) });
// A repayment's event.
const repaymentEvent = (r) => ({ kind: 'repayment', id: r.id, effectiveAt: r.recordedAt, recordedAt: r.recordedAt, amountMinor: num(r.amountMinor) });
// A write-off's event.
const writeOffEvent = (w) => ({ kind: 'write_off', id: w.id, effectiveAt: w.recordedAt, recordedAt: w.recordedAt, amountMinor: num(w.amountMinor) });
// A debt brought forward: it counts from the START of the day it was owed
// since, in the business's own time zone.
const openingEvent = (o, timeZone) => ({
  kind: 'opening_debt', id: o.id, effectiveAt: startOfDay(String(o.owedSince), timeZone), recordedAt: o.recordedAt, amountMinor: num(o.amountMinor),
});

// The originals still in effect: neither a reversal, nor reversed by one.
function inEffect(rows, column) {
  const reversed = new Set(rows.map((r) => r[column]).filter(Boolean));
  return rows.filter((r) => !r[column] && !reversed.has(r.id));
}

// Every event of one customer, from their permanent records.
async function loadEvents(models, transaction, { businessId, customerId, timeZone }) {
  const where = { businessId, customerId };
  const [sales, repayments, writeOffs, openings] = await Promise.all([
    models.Sale.findAll({ where: { ...where, creditMinor: { [Op.gt]: 0 } }, attributes: ['id', 'creditMinor', 'recordedAt'], transaction }),
    models.Repayment.findAll({ where, attributes: ['id', 'amountMinor', 'recordedAt', 'correctsRepaymentId'], transaction }),
    models.DebtWriteOff.findAll({ where, attributes: ['id', 'amountMinor', 'recordedAt', 'correctsDebtWriteOffId'], transaction }),
    models.OpeningDebt.findAll({ where, attributes: ['id', 'amountMinor', 'owedSince', 'recordedAt', 'correctsOpeningDebtId'], transaction }),
  ]);
  return [
    ...sales.map(saleEvent),
    ...inEffect(repayments, 'correctsRepaymentId').map(repaymentEvent),
    ...inEffect(writeOffs, 'correctsDebtWriteOffId').map(writeOffEvent),
    ...inEffect(openings, 'correctsOpeningDebtId').map((o) => openingEvent(o, timeZone)),
  ];
}

// ---- Writing the worked-out rows and the cache ---------------------------

// Plain rows for the database, with the business and customer.
const lotRow = (ids, l, amountField) => ({
  id: l.id, ...ids, sourceType: l.sourceType, sourceId: l.sourceId, originalMinor: l.originalMinor, [amountField]: l[amountField],
  effectiveAt: l.effectiveAt, orderKey: l.orderKey,
});
const allocationRow = (ids, a) => ({ id: a.id, ...ids, debtLotId: a.debtLotId, sourceType: a.sourceType, sourceId: a.sourceId, amountMinor: a.amountMinor, orderKey: a.orderKey });

// Updates the customer's cached balance and oldestUnpaidAt; true if they changed
// (the caller then gives the customer row a new sequence number).
async function updateCache(models, transaction, { businessId, customerId }, { balanceMinor, oldestUnpaidAt }) {
  const customer = await models.Customer.findOne({ where: { businessId, id: customerId }, attributes: ['balanceMinor', 'oldestUnpaidAt'], transaction });
  const sameOldest = (customer.oldestUnpaidAt?.getTime() ?? null) === (oldestUnpaidAt?.getTime() ?? null);
  if (num(customer.balanceMinor) === balanceMinor && sameOldest) return false;
  await models.Customer.update({ balanceMinor, oldestUnpaidAt }, { where: { businessId, id: customerId }, transaction });
  return true;
}

// The full rebuild of one customer: deletes their worked-out rows and writes
// them again from the rule. Returns { changed, balanceMinor, oldestUnpaidAt }.
async function rebuildFull(models, transaction, { businessId, customerId, timeZone }) {
  const result = rule.rebuild(businessId, await loadEvents(models, transaction, { businessId, customerId, timeZone }));
  const ids = { businessId, customerId };
  for (const model of PROJECTION_MODELS) await models[model].destroy({ where: ids, transaction }); // allocations first (they point at lots)
  if (result.debtLots.length) await models.DebtLot.bulkCreate(result.debtLots.map((l) => lotRow(ids, l, 'outstandingMinor')), { transaction });
  if (result.creditLots.length) await models.CreditLot.bulkCreate(result.creditLots.map((l) => lotRow(ids, l, 'remainingMinor')), { transaction });
  if (result.allocations.length) await models.DebtAllocation.bulkCreate(result.allocations.map((a) => allocationRow(ids, a)), { transaction });
  const changed = await updateCache(models, transaction, ids, result);
  return { changed, balanceMinor: result.balanceMinor, oldestUnpaidAt: result.oldestUnpaidAt };
}

// The highest order key already processed for this customer (or null).
async function lastKey(models, transaction, ids) {
  const keys = await Promise.all(['DebtLot', 'CreditLot', 'DebtAllocation'].map((m) => models[m].max('orderKey', { where: ids, transaction })));
  return keys.filter(Boolean).sort().at(-1) ?? null;
}

// Applies one NEW event (its record already saved in this transaction). The
// newest event goes on top of the open lots; anything else rebuilds in full.
async function applyNewEvent(models, transaction, { businessId, customerId, timeZone }, event) {
  const ids = { businessId, customerId };
  const last = await lastKey(models, transaction, ids);
  if (last !== null && rule.orderKeyOf(event) <= last) return rebuildFull(models, transaction, { businessId, customerId, timeZone });

  // The open lots are all the newest event can touch (closed ones add 0 to the balance).
  const state = rule.emptyState(businessId);
  const open = {
    debt: await models.DebtLot.findAll({ where: { ...ids, outstandingMinor: { [Op.gt]: 0 } }, transaction }),
    credit: await models.CreditLot.findAll({ where: { ...ids, remainingMinor: { [Op.gt]: 0 } }, transaction }),
  };
  const before = new Map();
  for (const l of open.debt) {
    const lot = { ...l.get({ plain: true }), originalMinor: num(l.originalMinor), outstandingMinor: num(l.outstandingMinor) };
    state.debtLots.push(lot);
    before.set(lot.id, lot.outstandingMinor);
  }
  for (const c of open.credit) {
    const lot = { ...c.get({ plain: true }), originalMinor: num(c.originalMinor), remainingMinor: num(c.remainingMinor) };
    state.creditLots.push(lot);
    before.set(lot.id, lot.remainingMinor);
  }

  rule.apply(state, event);

  for (const l of state.debtLots) {
    if (!before.has(l.id)) await models.DebtLot.create(lotRow(ids, l, 'outstandingMinor'), { transaction });
    else if (before.get(l.id) !== l.outstandingMinor) await models.DebtLot.update({ outstandingMinor: l.outstandingMinor }, { where: { ...ids, id: l.id }, transaction });
  }
  for (const c of state.creditLots) {
    if (!before.has(c.id)) await models.CreditLot.create(lotRow(ids, c, 'remainingMinor'), { transaction });
    else if (before.get(c.id) !== c.remainingMinor) await models.CreditLot.update({ remainingMinor: c.remainingMinor }, { where: { ...ids, id: c.id }, transaction });
  }
  if (state.allocations.length) await models.DebtAllocation.bulkCreate(state.allocations.map((a) => allocationRow(ids, a)), { transaction });

  const totals = rule.summary(state);
  const changed = await updateCache(models, transaction, ids, totals);
  return { changed, ...totals };
}

module.exports = { loadEvents, rebuildFull, applyNewEvent, saleEvent, repaymentEvent, writeOffEvent, openingEvent };
