// The ChangeLog.seq repair (migration 20261111100000-changelog-seq-order):
// rows numbered in random order (as BE6's migration left the old ones) come
// out numbered in time order, and two changes in the same millisecond keep
// the order they were saved in. Run on the test database only.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const migration = require('../../migrations/20261111100000-changelog-seq-order');
const { resetDatabase, dbApp, signUpOwner } = require('../helpers/dbApp');

beforeAll(() => resetDatabase());
afterAll(() => db.closeDatabase());

test('renumbers by (changedAt, seq): time order, same-millisecond ties kept, contents unchanged', async () => {
  const ctx = dbApp();
  const { res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const sequelize = db.getSequelize();
  await sequelize.query('DELETE FROM ChangeLog WHERE businessId = ?', { replacements: [businessId] }); // test database only

  // Written in this order (label = what happened when); seq given scrambled,
  // except the two same-millisecond rows, whose seq says which came first.
  const rows = [
    { label: 'first', at: '2026-11-03T10:00:00.000Z', seq: 905 },
    { label: 'second', at: '2026-11-03T11:00:00.000Z', seq: 901 },
    { label: 'third, same ms', at: '2026-11-04T09:00:00.000Z', seq: 910 },
    { label: 'fourth, same ms', at: '2026-11-04T09:00:00.000Z', seq: 911 },
    { label: 'fifth', at: '2026-11-05T08:00:00.000Z', seq: 903 },
  ];
  for (const r of rows) {
    await sequelize.query(
      'INSERT INTO ChangeLog (id, businessId, entity, entityId, changedBy, changedAt, `before`, `after`, conflict, seq) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 0, ?)',
      { replacements: [randomUUID(), businessId, 'test', randomUUID(), new Date(r.at), JSON.stringify({ label: r.label }), r.seq] },
    );
  }

  await migration.up(sequelize.getQueryInterface());

  const [after] = await sequelize.query('SELECT seq, JSON_UNQUOTE(JSON_EXTRACT(`after`, "$.label")) AS label FROM ChangeLog WHERE businessId = ? ORDER BY seq', { replacements: [businessId] });
  expect(after.map((r) => r.label)).toEqual(rows.map((r) => r.label));
  const seqs = after.map((r) => Number(r.seq));
  expect(new Set(seqs).size).toBe(seqs.length);

  // A row written afterwards gets a number above all of them.
  await sequelize.query(
    'INSERT INTO ChangeLog (id, businessId, entity, entityId, changedBy, changedAt, conflict) VALUES (?, ?, ?, ?, NULL, ?, 0)',
    { replacements: [randomUUID(), businessId, 'test', randomUUID(), new Date('2026-11-06T00:00:00.000Z')] },
  );
  const [[{ newest }]] = await sequelize.query('SELECT MAX(seq) AS newest FROM ChangeLog WHERE businessId = ?', { replacements: [businessId] });
  expect(Number(newest)).toBeGreaterThan(Math.max(...seqs));
});
