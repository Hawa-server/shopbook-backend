// check:stock (BE7), READ-ONLY: works out every size's stock at every
// location TWO independent ways and reports any difference:
//   1. the shared stock rule (src/services/stockRule.js) over ALL its rows;
//   2. one plain SQL query: the latest count (by recordedAt, id) plus the
//      movements after it.
// Stock is never stored, so this is how we know the rule, the queries the
// server uses (which load only the latest count and later movements) and the
// data agree. It reads; it never writes. Problems are reported by IDs only.

const rule = require('../services/stockRule');

const SQL = `
  SELECT g.businessId, g.productId, g.sizeId, g.locationId,
    COALESCE(lc.countedUnits, 0) + COALESCE((
      SELECT SUM(m.quantityUnits) FROM StockMovement m
      WHERE m.businessId = g.businessId AND m.productId = g.productId AND m.sizeId <=> g.sizeId AND m.locationId = g.locationId
        AND (lc.id IS NULL OR m.recordedAt > lc.recordedAt OR (m.recordedAt = lc.recordedAt AND m.id > lc.id))
    ), 0) AS sqlStock
  FROM (
    SELECT businessId, productId, sizeId, locationId FROM StockMovement
    UNION SELECT businessId, productId, sizeId, locationId FROM StockCount
  ) g
  LEFT JOIN (
    SELECT * FROM (
      SELECT c.*, ROW_NUMBER() OVER (PARTITION BY businessId, productId, sizeId, locationId ORDER BY recordedAt DESC, id DESC) AS rn
      FROM StockCount c
    ) ranked WHERE rn = 1
  ) lc ON lc.businessId = g.businessId AND lc.productId = g.productId AND lc.sizeId <=> g.sizeId AND lc.locationId = g.locationId
`;

const keyOf = (r) => `${r.businessId}|${r.productId}|${r.sizeId ?? ''}|${r.locationId}`;

// Returns [{ problem, businessId, productId, sizeId, locationId, ruleStock, sqlStock }].
async function checkStock(sequelize) {
  const select = async (sql) => (await sequelize.query(sql))[0];
  const groups = new Map();
  const group = (r) => {
    const key = keyOf(r);
    if (!groups.has(key)) groups.set(key, { movements: [], counts: [] });
    return groups.get(key);
  };
  for (const m of await select('SELECT id, businessId, productId, sizeId, locationId, quantityUnits, recordedAt, receivedAt FROM StockMovement')) {
    group(m).movements.push({ id: m.id, quantityUnits: m.quantityUnits, recordedAt: m.recordedAt, receivedAt: m.receivedAt });
  }
  for (const c of await select('SELECT id, businessId, productId, sizeId, locationId, countedUnits, recordedAt, receivedAt FROM StockCount')) {
    group(c).counts.push({ id: c.id, countedUnits: c.countedUnits, recordedAt: c.recordedAt, receivedAt: c.receivedAt });
  }

  const problems = [];
  for (const r of await select(SQL)) {
    const rows = groups.get(keyOf(r));
    const ruleStock = rule.stockOnHand(rows);
    const sqlStock = Number(r.sqlStock);
    if (ruleStock !== sqlStock) {
      problems.push({
        problem: 'stock_mismatch', businessId: r.businessId, productId: r.productId, sizeId: r.sizeId ?? null, locationId: r.locationId, ruleStock, sqlStock,
      });
    }
  }
  return problems;
}

module.exports = { checkStock };
