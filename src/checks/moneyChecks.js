// check:receipts and check:balances (BE8), READ-ONLY. They read; they never
// write. Problems are reported by IDs only (never names or phone numbers).
//
// - check:receipts: every receipt registry row points at a record that
//   exists with the same number, and every sale has its registry row. (The
//   registry can't use a foreign key: one table serves sales, corrections
//   and repayments, so this check guards it instead.)
// - check:balances: every customer's cached balance and oldestUnpaidAt equal
//   what the permanent records say. In BE8 the only debts are credit sales,
//   so balance = the sum of their credit parts and oldestUnpaidAt = the
//   oldest of them. BE9 replaces this with the full debt-lot rebuild.

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
  for (const s of await select(sequelize, `
    SELECT s.businessId, s.id, s.receiptNumber FROM Sale s
    LEFT JOIN ReceiptNumber r ON r.businessId = s.businessId AND r.receiptNumber = s.receiptNumber AND r.recordType = 'sale' AND r.recordId = s.id
    WHERE r.recordId IS NULL`)) {
    problems.push({ problem: 'sale_without_registry', businessId: s.businessId, saleId: s.id, receiptNumber: s.receiptNumber });
  }
  return problems;
}

// Customers whose cached balance or oldestUnpaidAt differs from their sales.
async function checkBalances(sequelize) {
  const problems = [];
  for (const c of await select(sequelize, `
    SELECT c.businessId, c.id, c.balanceMinor, c.oldestUnpaidAt,
      COALESCE((SELECT SUM(s.creditMinor) FROM Sale s WHERE s.businessId = c.businessId AND s.customerId = c.id), 0) AS expectedBalance,
      (SELECT MIN(s.recordedAt) FROM Sale s WHERE s.businessId = c.businessId AND s.customerId = c.id AND s.creditMinor > 0) AS expectedOldest
    FROM Customer c`)) {
    const balance = Number(c.balanceMinor);
    const expected = Number(c.expectedBalance);
    const oldest = c.oldestUnpaidAt ? new Date(c.oldestUnpaidAt).getTime() : null;
    const expectedOldest = c.expectedOldest ? new Date(c.expectedOldest).getTime() : null;
    if (balance !== expected || oldest !== expectedOldest) {
      problems.push({
        problem: 'balance_mismatch', businessId: c.businessId, customerId: c.id,
        balanceMinor: balance, expectedMinor: expected, oldestUnpaidAt: c.oldestUnpaidAt, expectedOldestUnpaidAt: c.expectedOldest,
      });
    }
  }
  return problems;
}

module.exports = { checkReceipts, checkBalances };
