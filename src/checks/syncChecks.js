// Consistency checks for sync (BE5 Part B). READ-ONLY: they only run SELECTs
// and report what they find; repairs are separate support scripts, run only
// after a backup. Run after tests, after a restore, and weekly in production.
//
// - checkSequences: every synced row has a sequence number; no number is used
//   twice in a business (across all synced tables); none is above the
//   business's counter; every business has a counter. (Gaps are normal: a
//   changed row takes a NEW number, leaving its old one unused.)
// - checkOperations: no operation was left 'pending' (that would mean a
//   result was committed without its outcome); saved ones have a result,
//   rejected ones a code; each was recorded under a phone of the same person.

const { SYNCED_MODELS } = require('../models');

// Runs one SELECT and returns its rows.
async function select(sequelize, sql, replacements = []) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

// Checks the sequence numbers. Returns a list of problems (empty = all good).
async function checkSequences(sequelize) {
  const problems = [];
  const tables = Object.keys(SYNCED_MODELS);
  const union = tables
    .map((t) => `SELECT '${t}' AS tbl, businessId, serverSeq FROM \`${t}\``)
    .join(' UNION ALL ');

  for (const row of await select(sequelize, `SELECT tbl, businessId, COUNT(*) AS n FROM (${union}) x WHERE serverSeq IS NULL GROUP BY tbl, businessId`)) {
    problems.push({ check: 'sequences', problem: 'row without a sequence number', table: row.tbl, businessId: row.businessId, count: Number(row.n) });
  }
  for (const row of await select(sequelize, `SELECT businessId, serverSeq, COUNT(*) AS n FROM (${union}) x WHERE serverSeq IS NOT NULL GROUP BY businessId, serverSeq HAVING COUNT(*) > 1`)) {
    problems.push({ check: 'sequences', problem: 'sequence number used twice', businessId: row.businessId, serverSeq: Number(row.serverSeq), count: Number(row.n) });
  }
  for (const row of await select(sequelize, `SELECT x.businessId, MAX(x.serverSeq) AS maxSeq, q.lastSeq FROM (${union}) x LEFT JOIN SyncSequence q ON q.businessId = x.businessId GROUP BY x.businessId, q.lastSeq HAVING q.lastSeq IS NULL OR MAX(x.serverSeq) > q.lastSeq`)) {
    problems.push({ check: 'sequences', problem: 'number above the business counter (or no counter)', businessId: row.businessId, maxSeq: Number(row.maxSeq), lastSeq: row.lastSeq === null ? null : Number(row.lastSeq) });
  }
  for (const row of await select(sequelize, 'SELECT b.id FROM Business b LEFT JOIN SyncSequence q ON q.businessId = b.id WHERE q.businessId IS NULL')) {
    problems.push({ check: 'sequences', problem: 'business without a SyncSequence row', businessId: row.id });
  }
  return problems;
}

// Checks the processed operations. Returns a list of problems.
async function checkOperations(sequelize) {
  const problems = [];
  for (const row of await select(sequelize, "SELECT businessId, opId FROM ProcessedOperation WHERE status = 'pending'")) {
    problems.push({ check: 'operations', problem: "operation left 'pending'", businessId: row.businessId, opId: row.opId });
  }
  for (const row of await select(sequelize, "SELECT businessId, opId FROM ProcessedOperation WHERE status = 'saved' AND (resultJson IS NULL OR JSON_EXTRACT(resultJson, '$.result') IS NULL)")) {
    problems.push({ check: 'operations', problem: 'saved operation without a result', businessId: row.businessId, opId: row.opId });
  }
  for (const row of await select(sequelize, "SELECT businessId, opId FROM ProcessedOperation WHERE status = 'rejected' AND (resultJson IS NULL OR JSON_EXTRACT(resultJson, '$.error.code') IS NULL)")) {
    problems.push({ check: 'operations', problem: 'rejected operation without an error code', businessId: row.businessId, opId: row.opId });
  }
  for (const row of await select(sequelize, 'SELECT p.businessId, p.opId FROM ProcessedOperation p JOIN Device d ON d.businessId = p.businessId AND d.id = p.deviceId WHERE d.userId <> p.userId')) {
    problems.push({ check: 'operations', problem: "operation recorded under another person's phone", businessId: row.businessId, opId: row.opId });
  }
  return problems;
}

module.exports = { checkSequences, checkOperations };
