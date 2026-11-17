// test:concurrency (BE9): debt operations that hit the SAME customer at the
// same moment from different phones, on a real MySQL database (never mocks).
// Each case runs 20 times; `npm run test:concurrency` runs the whole file
// three times in a row. After every case the read-only checks must agree.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { checkBalances, checkReceipts } = require('../../src/checks/moneyChecks');
const { checkSequences } = require('../../src/checks/syncChecks');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const REPEATS = 20;

let ctx;
let owner;
let manager;
let locationId;
let productId;
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp();
  const { agent, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  owner = { phone: agent, businessId, deviceId: device.deviceId, code: device.deviceCode, next: 1 };
  const phoneNumber = signupBody().phone;
  const added = await agent.post('/api/team').set(biz(businessId)).send({ name: 'Manager', phone: phoneNumber, role: 'manager' });
  const signedIn = await signInAgent(ctx.app, ctx.config, phoneNumber, added.body.temporaryPassword);
  await signedIn.agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: 'manager-pass-2026' });
  signedIn.agent.setPassword('manager-pass-2026');
  await signedIn.agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
  const md = await signedIn.agent.registerIn(businessId);
  manager = { phone: signedIn.agent, businessId, deviceId: md.deviceId, code: md.deviceCode, next: 1 };
  locationId = (await db.getModels().Location.findOne({ where: { businessId } })).id;
  productId = randomUUID();
  await push(owner, [op('product.upsert', { productId, baseVersion: null, fields: { name: 'Race sandal', type: 'other', unit: 'pair', retailMinor: 10000, costMinor: 5000 } })]);
}, 180000);
afterAll(() => db.closeDatabase());

function op(type, payload) { return { opId: randomUUID(), type, recordedOnline: false, payload }; }
function push(who, ops) { return who.phone.post('/api/sync/push').set(biz(who.businessId)).send({ deviceId: who.deviceId, operations: ops }); }
const one = async (who, operation) => (await push(who, [operation])).body.results[0];
const receipt = (who) => `${who.code}-${String(who.next++).padStart(5, '0')}`;
const now = () => new Date().toISOString();

// A new customer owing `pairs` × GH₵ 100.00 from one credit sale.
async function owingCustomer(pairs) {
  const customerId = randomUUID();
  await one(owner, op('customer.upsert', { customerId, baseVersion: null, fields: { name: 'Race customer' } }));
  await one(owner, creditSale(owner, customerId, pairs));
  return customerId;
}
function creditSale(who, customerId, pairs) {
  return op('sale.create', {
    saleId: randomUUID(), receiptNumber: receipt(who), locationId, customerId, priceType: 'retail',
    items: [{ itemId: randomUUID(), productId, sizeId: null, quantityUnits: pairs, productVersion: 1, setPriceMinor: 10000, agreedPriceMinor: 10000, lineTotalMinor: pairs * 10000 }],
    payments: [], subtotalMinor: pairs * 10000, paidMinor: 0, creditMinor: pairs * 10000, recordedAt: now(),
  });
}
const repay = (who, customerId, amountMinor) => op('repayment.create', { repaymentId: randomUUID(), receiptNumber: receipt(who), customerId, amountMinor, method: 'cash', recordedAt: now() });
const balanceOf = async (customerId) => Number((await db.getModels().Customer.findByPk(customerId)).balanceMinor);
// The checks that must agree after every race.
async function checksAgree() {
  const sequelize = db.getSequelize();
  expect(await checkBalances(sequelize)).toEqual([]);
  expect(await checkReceipts(sequelize)).toEqual([]);
  expect(await checkSequences(sequelize)).toEqual([]);
}

test(`two repayments for the same customer from two phones at the same moment: both saved, both counted (×${REPEATS})`, async () => {
  for (let i = 0; i < REPEATS; i += 1) {
    const c = await owingCustomer(1);
    const results = await Promise.all([one(owner, repay(owner, c, 7000)), one(manager, repay(manager, c, 7000))]);
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved']);
    expect(await balanceOf(c)).toBe(-4000); // overpaid together: in credit, never refused
    expect(results.filter((r) => r.result.flags.overpaid).length).toBe(1); // the one that arrived second
  }
  await checksAgree();
});

test(`a repayment and a credit sale for the same customer at the same moment (×${REPEATS})`, async () => {
  for (let i = 0; i < REPEATS; i += 1) {
    const c = await owingCustomer(1);
    const results = await Promise.all([one(owner, repay(owner, c, 5000)), one(manager, creditSale(manager, c, 2))]);
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved']);
    expect(await balanceOf(c)).toBe(25000);
  }
  await checksAgree();
});

test(`two reversals of the same repayment at the same moment: one saved, one ALREADY_REVERSED (×${REPEATS})`, async () => {
  for (let i = 0; i < REPEATS; i += 1) {
    const c = await owingCustomer(2);
    const original = await one(owner, repay(owner, c, 5000));
    const reverse = (who) => op('repayment.create', { repaymentId: randomUUID(), receiptNumber: receipt(who), customerId: c, correctsRepaymentId: original.result.repaymentId, correctionReason: 'Wrong amount', recordedAt: now() });
    const results = await Promise.all([one(owner, reverse(owner)), one(manager, reverse(manager))]);
    expect(results.map((r) => r.status === 'saved' ? 'saved' : r.error.code).sort()).toEqual(['ALREADY_REVERSED', 'saved']);
    expect(await balanceOf(c)).toBe(20000);
  }
  await checksAgree();
});
