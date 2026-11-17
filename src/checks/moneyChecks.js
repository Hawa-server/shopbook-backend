// check:receipts and check:balances (BE8), READ-ONLY. They read; they never
// write. Problems are reported by IDs only (never names or phone numbers).
//
// - check:receipts: every receipt registry row points at a record that
//   exists with the same number, and every sale has its registry row. (The
//   registry can't use a foreign key: one table serves sales, corrections
//   and repayments, so this check guards it instead.)
// - check:balances (BE9): every customer rebuilt from scratch with the debt
//   rule and compared with the stored lots, allocations and cached balance.

const { defineModels } = require('../models');
const debtRule = require('../services/debtRule');
const debtLots = require('../services/debtLots');

// Runs a read query and returns its rows.
async function select(sequelize, sql) {
  const [rows] = await sequelize.query(sql);
  return rows;
}

// Registry rows without their sale, and sales without their registry row.
async function checkReceipts(sequelize) {
  const problems = [];
  for (const r of await select(sequelize, `
    SELECT r.businessId, r.receiptNumber, r.recordId FROM ReceiptNumber r
    LEFT JOIN Sale s ON s.businessId = r.businessId AND s.id = r.recordId AND s.receiptNumber = r.receiptNumber
    WHERE r.recordType = 'sale' AND s.id IS NULL`)) {
    problems.push({ problem: 'registry_without_sale', businessId: r.businessId, receiptNumber: r.receiptNumber, recordId: r.recordId });
  }
  for (const r of await select(sequelize, `
    SELECT r.businessId, r.receiptNumber, r.recordId FROM ReceiptNumber r
    LEFT JOIN Repayment p ON p.businessId = r.businessId AND p.id = r.recordId AND p.receiptNumber = r.receiptNumber
    WHERE r.recordType = 'repayment' AND p.id IS NULL`)) {
    problems.push({ problem: 'registry_without_repayment', businessId: r.businessId, receiptNumber: r.receiptNumber, recordId: r.recordId });
  }
  for (const p of await select(sequelize, `
    SELECT p.businessId, p.id, p.receiptNumber FROM Repayment p
    LEFT JOIN ReceiptNumber r ON r.businessId = p.businessId AND r.receiptNumber = p.receiptNumber AND r.recordType = 'repayment' AND r.recordId = p.id
    WHERE r.recordId IS NULL`)) {
    problems.push({ problem: 'repayment_without_registry', businessId: p.businessId, repaymentId: p.id, receiptNumber: p.receiptNumber });
  }
  for (const s of await select(sequelize, `
    SELECT s.businessId, s.id, s.receiptNumber FROM Sale s
    LEFT JOIN ReceiptNumber r ON r.businessId = s.businessId AND r.receiptNumber = s.receiptNumber AND r.recordType = 'sale' AND r.recordId = s.id
    WHERE r.recordId IS NULL`)) {
    problems.push({ problem: 'sale_without_registry', businessId: s.businessId, saleId: s.id, receiptNumber: s.receiptNumber });
  }
  return problems;
}

// Every customer rebuilt FROM SCRATCH with the debt rule (BE9), compared
// with what's stored: the cached balance and oldestUnpaidAt on the customer,
// and every debt lot, credit lot and allocation (so the fast "newest event"
// path is checked against the full rebuild). Reads only.
async function checkBalances(sequelize) {
  const models = sequelize.models.Customer ? sequelize.models : defineModels(sequelize);
  const problems = [];
  const customers = await select(sequelize, 'SELECT c.businessId, c.id, c.balanceMinor, c.oldestUnpaidAt, b.timezone FROM Customer c JOIN Business b ON b.id = c.businessId');
  for (const c of customers) {
    const ids = { businessId: c.businessId, customerId: c.id };
    const expected = debtRule.rebuild(c.businessId, await debtLots.loadEvents(models, undefined, { ...ids, timeZone: c.timezone }));
    const oldest = c.oldestUnpaidAt ? new Date(c.oldestUnpaidAt).getTime() : null;
    const expectedOldest = expected.oldestUnpaidAt ? expected.oldestUnpaidAt.getTime() : null;
    if (Number(c.balanceMinor) !== expected.balanceMinor || oldest !== expectedOldest) {
      problems.push({
        problem: 'balance_mismatch', ...ids, balanceMinor: Number(c.balanceMinor), expectedMinor: expected.balanceMinor,
        oldestUnpaidAt: c.oldestUnpaidAt, expectedOldestUnpaidAt: expected.oldestUnpaidAt,
      });
    }
    // The stored worked-out rows, compared by content.
    const stored = async (model, fields) => (await models[model].findAll({ where: ids, attributes: ['id', ...fields], raw: true }))
      .map((r) => JSON.stringify(['id', ...fields].map((f) => (typeof r[f] === 'string' && /Minor$/.test(f) ? Number(r[f]) : r[f]))))
      .sort();
    const wanted = (rows, fields) => rows.map((r) => JSON.stringify(['id', ...fields].map((f) => r[f]))).sort();
    const sets = [
      ['DebtLot', expected.debtLots, ['sourceType', 'sourceId', 'originalMinor', 'outstandingMinor', 'orderKey']],
      ['CreditLot', expected.creditLots, ['sourceType', 'sourceId', 'originalMinor', 'remainingMinor', 'orderKey']],
      ['DebtAllocation', expected.allocations, ['debtLotId', 'sourceType', 'sourceId', 'amountMinor', 'orderKey']],
    ];
    for (const [model, rows, fields] of sets) {
      if (JSON.stringify(await stored(model, fields)) !== JSON.stringify(wanted(rows, fields))) problems.push({ problem: 'lots_mismatch', ...ids, table: model });
    }
  }
  return problems;
}

module.exports = { checkReceipts, checkBalances };
