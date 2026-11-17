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
// A time written for a raw SQL statement WITH its milliseconds, in UTC
// ("2026-11-11 11:18:52.445"). Raw statements would otherwise drop them.
const sqlTime = (t) => (t == null ? null : new Date(t).toISOString().replace('T', ' ').replace('Z', ''));

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
    // Plain rows (raw), not Sequelize objects: thousands of them stay fast.
    models.Sale.findAll({ where: { ...where, creditMinor: { [Op.gt]: 0 } }, attributes: ['id', 'creditMinor', 'recordedAt'], raw: true, transaction }),
    models.Repayment.findAll({ where, attributes: ['id', 'amountMinor', 'recordedAt', 'correctsRepaymentId'], raw: true, transaction }),
    models.DebtWriteOff.findAll({ where, attributes: ['id', 'amountMinor', 'recordedAt', 'correctsDebtWriteOffId'], raw: true, transaction }),
    models.OpeningDebt.findAll({ where, attributes: ['id', 'amountMinor', 'owedSince', 'recordedAt', 'correctsOpeningDebtId'], raw: true, transaction }),
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
  effectiveAt: sqlTime(l.effectiveAt), orderKey: l.orderKey,
});
const allocationRow = (ids, a) => ({ id: a.id, ...ids, debtLotId: a.debtLotId, sourceType: a.sourceType, sourceId: a.sourceId, amountMinor: a.amountMinor, orderKey: a.orderKey });

// Updates the customer's cached balance and oldestUnpaidAt; true if they changed
// (the caller then gives the customer row a new sequence number). One
// conditional UPDATE: it only matches when a value really differs.
async function updateCache(models, transaction, { businessId, customerId }, { balanceMinor, oldestUnpaidAt }) {
  const [, meta] = await models.Customer.sequelize.query(
    `UPDATE Customer SET balanceMinor = ?, oldestUnpaidAt = ?
     WHERE businessId = ? AND id = ? AND NOT (balanceMinor <=> ? AND oldestUnpaidAt <=> ?)`,
    { replacements: [balanceMinor, sqlTime(oldestUnpaidAt), businessId, customerId, balanceMinor, sqlTime(oldestUnpaidAt)], transaction },
  );
  return (meta?.affectedRows ?? meta) > 0;
}

// The worked-out tables and the fields that make two rows "the same".
const TABLES = [
  { model: 'DebtLot', amount: 'outstandingMinor', toRow: (ids, l) => lotRow(ids, l, 'outstandingMinor') },
  { model: 'CreditLot', amount: 'remainingMinor', toRow: (ids, l) => lotRow(ids, l, 'remainingMinor') },
  { model: 'DebtAllocation', amount: 'amountMinor', toRow: allocationRow },
];
const sameRow = (a, b, amount) => num(a[amount]) === num(b[amount]) && a.orderKey === b.orderKey && num(a.originalMinor ?? 0) === num(b.originalMinor ?? 0);

// Writes plain rows, NEW or CHANGED, with one statement per 500 (no
// Sequelize objects: fast): a row whose ID exists is updated in place, so
// allocations pointing at a lot never lose it.
async function putRows(models, transaction, model, rows) {
  if (rows.length === 0) return;
  const sequelize = models[model].sequelize;
  const columns = Object.keys(rows[0]);
  const table = models[model].getTableName();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sequelize.query(
      `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ${chunk.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')}
       AS fresh ON DUPLICATE KEY UPDATE ${columns.filter((c) => c !== 'id').map((c) => `\`${c}\` = fresh.\`${c}\``).join(', ')}`,
      { replacements: chunk.flatMap((r) => columns.map((c) => r[c])), transaction },
    );
  }
}

// Writes plain rows with one INSERT per 1,000 (no Sequelize objects: fast).
async function insertRows(models, transaction, model, rows) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 1000) {
    await models[model].sequelize.getQueryInterface().bulkInsert(models[model].getTableName(), rows.slice(i, i + 1000), { transaction });
  }
}

// The full rebuild of one customer: works out every lot and allocation from
// their permanent records, compares with what's stored, and changes ONLY
// what differs (a late event usually changes a few rows, not thousands):
// rows that no longer exist are deleted (allocations before the lots they
// point at), new rows inserted and changed rows updated IN PLACE.
// Returns { changed, balanceMinor, oldestUnpaidAt }.
async function rebuildFull(models, transaction, { businessId, customerId, timeZone }) {
  const result = rule.rebuild(businessId, await loadEvents(models, transaction, { businessId, customerId, timeZone }));
  const ids = { businessId, customerId };
  const wanted = { DebtLot: result.debtLots, CreditLot: result.creditLots, DebtAllocation: result.allocations };
  const plan = {};
  for (const t of TABLES) {
    const stored = new Map((await models[t.model].findAll({ where: ids, raw: true, transaction })).map((r) => [r.id, r]));
    const rows = wanted[t.model].map((w) => t.toRow(ids, w));
    const wantedIds = new Set(rows.map((r) => r.id));
    plan[t.model] = {
      remove: [...stored.keys()].filter((id) => !wantedIds.has(id)),
      put: rows.filter((r) => !stored.has(r.id) || !sameRow(stored.get(r.id), r, t.amount)),
    };
  }
  for (const model of PROJECTION_MODELS) { // allocations first: they point at lots
    if (plan[model].remove.length) await models[model].destroy({ where: { ...ids, id: plan[model].remove }, transaction });
  }
  for (const model of ['DebtLot', 'CreditLot', 'DebtAllocation']) await putRows(models, transaction, model, plan[model].put);
  const changed = await updateCache(models, transaction, ids, result);
  return { changed, balanceMinor: result.balanceMinor, oldestUnpaidAt: result.oldestUnpaidAt };
}

// The highest order key already processed for this customer (or null), in one query.
async function lastKey(models, transaction, { businessId, customerId }) {
  const [[row]] = await models.DebtLot.sequelize.query(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(orderKey) FROM DebtLot WHERE businessId = :b AND customerId = :c), ''),
       COALESCE((SELECT MAX(orderKey) FROM CreditLot WHERE businessId = :b AND customerId = :c), ''),
       COALESCE((SELECT MAX(orderKey) FROM DebtAllocation WHERE businessId = :b AND customerId = :c), '')) AS k`,
    { replacements: { b: businessId, c: customerId }, transaction },
  );
  return row.k || null;
}

// Applies one NEW event (its record already saved in this transaction). The
// newest event goes on top of the open lots; anything else rebuilds in full.
async function applyNewEvent(models, transaction, { businessId, customerId, timeZone }, event) {
  const ids = { businessId, customerId };
  const last = await lastKey(models, transaction, ids);
  if (last !== null && rule.orderKeyOf(event) <= last) return rebuildFull(models, transaction, { businessId, customerId, timeZone });

  // The open lots are all the newest event can touch (closed ones add 0 to the balance).
  const toLot = (r, amount) => ({ ...r, originalMinor: num(r.originalMinor), [amount]: num(r[amount]) });
  const openDebt = (await models.DebtLot.findAll({ where: { ...ids, outstandingMinor: { [Op.gt]: 0 } }, raw: true, transaction })).map((r) => toLot(r, 'outstandingMinor'));
  const openCredit = (await models.CreditLot.findAll({ where: { ...ids, remainingMinor: { [Op.gt]: 0 } }, raw: true, transaction })).map((r) => toLot(r, 'remainingMinor'));
  const state = rule.withLots(rule.emptyState(businessId), openDebt, openCredit);
  const before = new Map([...openDebt.map((l) => [l.id, l.outstandingMinor]), ...openCredit.map((c) => [c.id, c.remainingMinor])]);

  rule.apply(state, event);

  await insertRows(models, transaction, 'DebtLot', state.debtLots.filter((l) => !before.has(l.id)).map((l) => lotRow(ids, l, 'outstandingMinor')));
  await insertRows(models, transaction, 'CreditLot', state.creditLots.filter((c) => !before.has(c.id)).map((c) => lotRow(ids, c, 'remainingMinor')));
  for (const l of state.debtLots) {
    if (!before.has(l.id)) continue;
    if (before.get(l.id) !== l.outstandingMinor) await models.DebtLot.update({ outstandingMinor: l.outstandingMinor }, { where: { ...ids, id: l.id }, transaction });
  }
  for (const c of state.creditLots) {
    if (!before.has(c.id)) continue;
    if (before.get(c.id) !== c.remainingMinor) await models.CreditLot.update({ remainingMinor: c.remainingMinor }, { where: { ...ids, id: c.id }, transaction });
  }
  await insertRows(models, transaction, 'DebtAllocation', state.allocations.map((a) => allocationRow(ids, a)));

  const totals = rule.summary(state);
  const changed = await updateCache(models, transaction, ids, totals);
  return { changed, ...totals };
}

module.exports = { loadEvents, rebuildFull, applyNewEvent, saleEvent, repaymentEvent, writeOffEvent, openingEvent };
