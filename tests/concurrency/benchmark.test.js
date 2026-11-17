// The debt-lot benchmark (BE9 Done when): a customer with 5,000 events.
// The NEWEST event must update in under 20 ms, and a FULL rebuild must take
// under 500 ms. Measured on the LOCAL test database (production's free
// database is measured by the owner in BE14). Each timing is the best of 5
// runs, so one busy moment on the machine doesn't decide it.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const debtLots = require('../../src/services/debtLots');
const { checkBalances } = require('../../src/checks/moneyChecks');
const { resetDatabase, dbApp, signUpOwner } = require('../helpers/dbApp');

let ids;
let models;
beforeAll(async () => {
  await resetDatabase();
  const ctx = dbApp();
  const { agent, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  models = db.getModels();
  const customerId = randomUUID();
  const now = new Date();
  await models.Customer.create({ id: customerId, businessId, name: 'Busy customer', nameNormalized: 'busy customer', language: 'en', createdBy: res.body.user.id, createdAt: now, updatedAt: now });
  // 2,500 debts brought forward and 2,500 repayments that pay them, one after another: 5,000 events.
  const day = (n) => new Date(Date.UTC(2020, 0, 1) + n * 3600000);
  const common = { businessId, customerId, recordedBy: res.body.user.id, receivedAt: now };
  await models.OpeningDebt.bulkCreate(Array.from({ length: 2500 }, (_, n) => ({
    id: randomUUID(), ...common, deviceId: device.deviceId, amountMinor: 1000, owedSince: day(2 * n).toISOString().slice(0, 10), recordedAt: day(2 * n),
  })));
  await models.Repayment.bulkCreate(Array.from({ length: 2500 }, (_, n) => ({
    id: randomUUID(), ...common, deviceId: device.deviceId, receiptNumber: `${device.deviceCode}-${n + 1}`, amountMinor: 1000, method: 'cash', flags: {}, recordedAt: day(2 * n + 1),
  })));
  ids = { businessId, customerId, timeZone: 'Africa/Accra' };
}, 300000);
afterAll(() => db.closeDatabase());

// The best of `runs` timings (milliseconds) of fn(transaction), each in its own transaction.
async function best(runs, fn) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i += 1) {
    await db.getSequelize().transaction(async (transaction) => {
      const start = process.hrtime.bigint();
      await fn(transaction);
      fastest = Math.min(fastest, Number(process.hrtime.bigint() - start) / 1e6);
    });
  }
  return fastest;
}

test('a full rebuild of a customer with 5,000 events takes under 500 ms', async () => {
  const ms = await best(5, (transaction) => debtLots.rebuildFull(models, transaction, ids));
  console.log(`full rebuild, 5,000 events: ${ms.toFixed(1)} ms`); // eslint-disable-line no-console
  expect(ms).toBeLessThan(500);
});

test('the newest event on top of 5,000 takes under 20 ms, and gives the same result as the full rebuild', async () => {
  const device = await models.Device.findOne({ where: { businessId: ids.businessId } });
  const userId = (await models.Membership.findOne({ where: { businessId: ids.businessId, role: 'owner' } })).userId;
  const timings = [];
  for (let i = 0; i < 5; i += 1) {
    const repaymentId = randomUUID();
    const when = new Date(Date.now() + i * 1000); // each one newer than everything before it
    timings.push(await db.getSequelize().transaction(async (transaction) => {
      await models.Repayment.create({
        id: repaymentId, businessId: ids.businessId, customerId: ids.customerId, deviceId: device.id, receiptNumber: `${device.deviceCode}-99990${i}`,
        amountMinor: 1, method: 'cash', flags: {}, recordedBy: userId, recordedAt: when, receivedAt: when,
      }, { transaction });
      const start = process.hrtime.bigint();
      await debtLots.applyNewEvent(models, transaction, ids, { kind: 'repayment', id: repaymentId, effectiveAt: when, recordedAt: when, amountMinor: 1 });
      return Number(process.hrtime.bigint() - start) / 1e6;
    }));
  }
  const fastest = Math.min(...timings);
  console.log(`newest event on top of 5,000: ${fastest.toFixed(1)} ms (all runs: ${timings.map((t) => t.toFixed(1)).join(', ')})`); // eslint-disable-line no-console
  expect(fastest).toBeLessThan(20);
  expect(await checkBalances(db.getSequelize())).toEqual([]); // the fast path agrees with the full rebuild
});
