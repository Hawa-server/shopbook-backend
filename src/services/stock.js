// Stock from the database (BE7): loads the rows the stock rule needs for ONE
// product size at ONE location, and hands them to the pure functions in
// stockRule.js, so the server and the phone always use the same rule.
//
// Only what matters is loaded: the latest count (by stock key) and the
// movements after it. The rule gives the same answer as on every row
// (movements before the latest count are already reflected in it), but a
// size with years of history stays fast.
//
// Called inside an operation's transaction with the product row locked
// (runOperation's lock order), so two operations on the same product can't
// work out stock at the same time from the same old rows.

const { Op } = require('sequelize');
const rule = require('./stockRule');

// The where clause for rows strictly after (or before) a stock key.
function afterKey({ recordedAt, id }) {
  return { [Op.or]: [{ recordedAt: { [Op.gt]: recordedAt } }, { recordedAt, id: { [Op.gt]: id } }] };
}
function beforeKey({ recordedAt, id }) {
  return { [Op.or]: [{ recordedAt: { [Op.lt]: recordedAt } }, { recordedAt, id: { [Op.lt]: id } }] };
}

// Plain rows for the rule.
const asMovement = (m) => ({ id: m.id, quantityUnits: m.quantityUnits, recordedAt: m.recordedAt, receivedAt: m.receivedAt });
const asCount = (c) => ({ id: c.id, countedUnits: c.countedUnits, recordedAt: c.recordedAt, receivedAt: c.receivedAt });

// The rows that decide stock at `place` ({ productId, sizeId, locationId }),
// considering only rows before `before` (a stock key) when given: the latest
// such count, and the movements after it.
async function rowsFor(s, transaction, place, { before } = {}) {
  const where = { productId: place.productId, sizeId: place.sizeId ?? null, locationId: place.locationId };
  const limit = before ? beforeKey(before) : {};
  const latest = await s.StockCount.findOne({
    where: { ...where, ...limit }, order: [['recordedAt', 'DESC'], ['id', 'DESC']], transaction,
  });
  const movementWhere = { ...where, [Op.and]: [latest ? afterKey(latest) : {}, before ? beforeKey(before) : {}] };
  const movements = await s.StockMovement.findAll({ where: movementWhere, attributes: ['id', 'quantityUnits', 'recordedAt', 'receivedAt'], transaction });
  return { movements: movements.map(asMovement), counts: latest ? [asCount(latest)] : [] };
}

// Stock on hand at `place` now, optionally with one extra movement not saved yet.
async function stockOnHand(s, transaction, place, { plus } = {}) {
  const rows = await rowsFor(s, transaction, place);
  return rule.stockOnHand({ movements: plus ? [...rows.movements, plus] : rows.movements, counts: rows.counts });
}

// A new count's expected stock and difference (rows before it only).
async function countResult(s, transaction, place, count) {
  const rows = await rowsFor(s, transaction, place, { before: count });
  return rule.countResult(count, rows);
}

// Stock of one size (or a product without sizes) added up over every
// location that has any stock record for it.
async function stockOfSize(s, transaction, { productId, sizeId }) {
  const where = { productId, sizeId: sizeId ?? null };
  const places = new Set();
  for (const model of ['StockMovement', 'StockCount']) {
    const rows = await s[model].findAll({ where, attributes: ['locationId'], group: ['locationId'], transaction });
    rows.forEach((r) => places.add(r.locationId));
  }
  let total = 0;
  for (const locationId of places) total += await stockOnHand(s, transaction, { productId, sizeId, locationId });
  return total;
}

// True if the product has any stock record at all (movement or count).
async function hasStockRecords(s, transaction, productId) {
  return (await s.StockMovement.count({ where: { productId }, transaction })) > 0
    || (await s.StockCount.count({ where: { productId }, transaction })) > 0;
}

// A quantity in units, as people say it: 5 units of a yard product → "2.5".
function unitsInWords(units, unitScale) {
  return unitScale === 2 ? String(units / 2) : String(units);
}

module.exports = { rowsFor, stockOnHand, countResult, stockOfSize, hasStockRecords, unitsInWords };
