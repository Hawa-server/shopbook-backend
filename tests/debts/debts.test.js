// BE9: customers, credit and repayments (Epic 4) through real pushes on the
// test database: editing customers (who may do what, hiding, limits, the
// duplicate-phone warning), repayments (overpaid, switched-off method,
// receipts), write-offs, debts brought forward, reversals (once only, never
// of a reversal), the debt lots behind every balance, the history endpoint,
// what each role pulls, the migration's data step, and the read-only checks.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { scoped } = require('../../src/services/scoped');
const { checkReceipts, checkBalances } = require('../../src/checks/moneyChecks');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { buildExistingLots } = require('../../migrations/20261114100000-debts');
const { resetDatabase, dbApp, createClock, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const T0 = Date.UTC(2026, 10, 20, 9, 0, 0); // 20 Nov 2026, 09:00 UTC
const at = (minutes = 0) => new Date(T0 + minutes * 60000).toISOString();

let ctx;
let shop;
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp({ clock: createClock(T0) });
  shop = await team();
}, 180000);
afterAll(() => db.closeDatabase());

// An owner, a manager and two associates of one business, each with a phone.
async function team() {
  const { agent, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  const owner = { phone: agent, businessId, userId: res.body.user.id, deviceId: device.deviceId, code: device.deviceCode, next: 1 };
  const location = await db.getModels().Location.findOne({ where: { businessId } });
  const productId = randomUUID();
  await push(owner, [op('product.upsert', { productId, baseVersion: null, fields: { name: 'Debt sandal', type: 'other', unit: 'pair', retailMinor: 10000, costMinor: 6000 } })]);
  return {
    owner, manager: await staff(owner, 'manager'), associate: await staff(owner, 'associate'), associateB: await staff(owner, 'associate'),
    businessId, locationId: location.id, productId,
  };
}

// A staff member with their own phone.
async function staff(o, role) {
  const phoneNumber = signupBody().phone;
  const added = await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: `A ${role}`, phone: phoneNumber, role });
  const { agent, res } = await signInAgent(ctx.app, ctx.config, phoneNumber, added.body.temporaryPassword);
  await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: `${role}-pass-2026` });
  agent.setPassword(`${role}-pass-2026`);
  await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
  const device = await agent.registerIn(o.businessId);
  return { phone: agent, businessId: o.businessId, deviceId: device.deviceId, code: device.deviceCode, userId: res.body.user.id, next: 1 };
}

function push(who, ops) { return who.phone.post('/api/sync/push').set(biz(who.businessId)).send({ deviceId: who.deviceId, operations: ops }); }
function op(type, payload) { return { opId: randomUUID(), type, recordedOnline: false, payload }; }
const pull = (who) => who.phone.get('/api/sync/pull?since=0&limit=500').set(biz(who.businessId));
const one = async (who, operation) => (await push(who, [operation])).body.results[0];
const s = () => scoped({ business: { id: shop.businessId } }, db.getModels());
const receipt = (who) => `${who.code}-${String(who.next++).padStart(4, '0')}`;
const customerRow = (id) => s().Customer.findOne({ where: { id } });
const balanceOf = async (id) => Number((await customerRow(id)).balanceMinor);

// A new customer added by `who`.
async function customer(who = shop.owner, fields = {}) {
  const customerId = randomUUID();
  expect((await one(who, op('customer.upsert', { customerId, baseVersion: null, fields: { name: `Customer ${customerId.slice(0, 5)}`, ...fields } }))).status).toBe('saved');
  return customerId;
}
// A credit sale of `amount` (whole pairs at GH₵ 100.00) to a customer.
function creditSale(who, customerId, pairs = 1, recordedAt = at()) {
  const total = pairs * 10000;
  return op('sale.create', {
    saleId: randomUUID(), receiptNumber: receipt(who), locationId: shop.locationId, customerId, priceType: 'retail',
    items: [{ itemId: randomUUID(), productId: shop.productId, sizeId: null, quantityUnits: pairs, productVersion: 1, setPriceMinor: 10000, agreedPriceMinor: 10000, lineTotalMinor: total }],
    payments: [], subtotalMinor: total, paidMinor: 0, creditMinor: total, recordedAt,
  });
}
const repay = (who, customerId, amountMinor, extra = {}) => op('repayment.create', {
  repaymentId: randomUUID(), receiptNumber: receipt(who), customerId, amountMinor, method: 'cash', recordedAt: at(), ...extra,
});
const reverseRepayment = (who, customerId, originalId, extra = {}) => op('repayment.create', {
  repaymentId: randomUUID(), receiptNumber: receipt(who), customerId, correctsRepaymentId: originalId, correctionReason: 'Typed 500 instead of 50', recordedAt: at(1), ...extra,
});

describe('editing customers (AC5–AC9)', () => {
  test('owner and manager edit; an associate is refused; only the owner sets a credit limit; history kept', async () => {
    const c = await customer(shop.associate);
    expect((await one(shop.associate, op('customer.upsert', { customerId: c, baseVersion: 1, fields: { name: 'Changed' } }))).error.code).toBe('FORBIDDEN');
    expect((await one(shop.manager, op('customer.upsert', { customerId: c, baseVersion: 1, fields: { name: 'Ama Owusu', language: 'tw' } }))).result.version).toBe(2);
    expect((await one(shop.manager, op('customer.upsert', { customerId: c, baseVersion: 2, fields: { creditLimitMinor: 50000 } }))).error)
      .toMatchObject({ code: 'FORBIDDEN', fields: { creditLimitMinor: 'Only the owner can set credit limits.' } });
    expect((await one(shop.owner, op('customer.upsert', { customerId: c, baseVersion: 2, fields: { creditLimitMinor: 50000 } }))).status).toBe('saved');
    expect(await customerRow(c)).toMatchObject({ name: 'Ama Owusu', language: 'tw', version: 3 });
    expect(await s().ChangeLog.count({ where: { entity: 'customer', entityId: c } })).toBe(3);
  });

  test('names up to 80 characters (AC1); 81 is refused', async () => {
    const long = 'A'.repeat(80);
    const c = await customer(shop.owner, { name: long });
    expect((await customerRow(c)).name).toBe(long);
    expect((await one(shop.owner, op('customer.upsert', { customerId: randomUUID(), baseVersion: null, fields: { name: 'B'.repeat(81) } }))).error.code).toBe('INVALID_PAYLOAD');
  });

  test('the same phone number as another customer is a warning, never an error (AC3)', async () => {
    const first = await customer(shop.owner, { phone: '024 777 0001' });
    const res = await one(shop.associate, op('customer.upsert', { customerId: randomUUID(), baseVersion: null, fields: { name: 'Her sister', phone: '0247770001' } }));
    expect(res).toMatchObject({ status: 'saved', result: { warnings: [{ code: 'CUSTOMER_PHONE_DUPLICATE', customerId: first }] } });
  });

  test('a customer who owes, or is owed, can\'t be hidden (AC6); at zero they can', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 1));
    const refused = await one(shop.manager, op('customer.upsert', { customerId: c, baseVersion: 1, fields: { isHidden: true } }));
    expect(refused.error).toMatchObject({ code: 'CUSTOMER_OWES', message: expect.stringMatching(/still owes GH₵ 100\.00\.$/) });
    await one(shop.owner, repay(shop.owner, c, 12000));
    expect((await one(shop.manager, op('customer.upsert', { customerId: c, baseVersion: 1, fields: { isHidden: true } }))).error.message).toMatch(/^The shop still owes/);
    const z = await customer();
    expect((await one(shop.manager, op('customer.upsert', { customerId: z, baseVersion: 1, fields: { isHidden: true } }))).status).toBe('saved');
  });
});

describe('repayments (AC11–AC16, AC24, AC25)', () => {
  test('an associate records a repayment: saved under their name with a receipt; the balance goes down', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 2));
    const res = await one(shop.associate, repay(shop.associate, c, 5000));
    expect(res).toMatchObject({ status: 'saved', result: { balanceMinor: 15000 } });
    expect(await s().Repayment.findOne({ where: { id: res.result.repaymentId } })).toMatchObject({ recordedBy: shop.associate.userId, method: 'cash' });
    expect(await s().ReceiptNumber.count({ where: { recordId: res.result.repaymentId, recordType: 'repayment' } })).toBe(1);
    expect(await balanceOf(c)).toBe(15000);
  });

  test('more than owed is SAVED and flagged overpaid (for the owner and manager): the customer is in credit, and their next credit sale uses it', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 1));
    const res = await one(shop.associate, repay(shop.associate, c, 12000));
    expect(res.status).toBe('saved');
    expect(res.result.flags).not.toHaveProperty('overpaid'); // an associate isn't told
    expect((await s().Repayment.findOne({ where: { id: res.result.repaymentId } })).flags.overpaid).toBe(true);
    expect(await balanceOf(c)).toBe(-2000); // "Shop owes Ama GH₵ 20.00"
    await one(shop.owner, creditSale(shop.owner, c, 1, at(5))); // her next purchase, later
    expect(await balanceOf(c)).toBe(8000);
    expect(await s().DebtAllocation.count({ where: { customerId: c, sourceType: 'credit_lot' } })).toBe(1);
  });

  test('a switched-off method is saved and flagged methodDisabled; an unknown method is refused', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 1));
    expect((await one(shop.owner, repay(shop.owner, c, 1000, { method: 'bitcoin' }))).error.code).toBe('PAYMENT_METHOD_UNKNOWN');
    const { version } = await s().BusinessSettings.findOne({ where: {} });
    await one(shop.owner, op('settings.update', { baseVersion: version, changes: { paymentMethods: ['cash'] } }));
    const res = await one(shop.manager, repay(shop.manager, c, 1000, { method: 'mobile_money' }));
    expect(res).toMatchObject({ status: 'saved', result: { flags: { methodDisabled: true } } });
    await one(shop.owner, op('settings.update', { baseVersion: version + 1, changes: { paymentMethods: ['cash', 'mobile_money'] } }));
  });

  test('a reversal (owner or manager) cancels it in full, with its own receipt; once only; never of a reversal; an associate can\'t', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 6));
    const wrong = await one(shop.associate, repay(shop.associate, c, 50000));
    expect(await balanceOf(c)).toBe(10000);
    expect((await one(shop.associate, reverseRepayment(shop.associate, c, wrong.result.repaymentId))).error.code).toBe('FORBIDDEN');

    const reversal = await one(shop.manager, reverseRepayment(shop.manager, c, wrong.result.repaymentId));
    expect(reversal).toMatchObject({ status: 'saved', result: { balanceMinor: 60000, reversesReceiptNumber: wrong.result.receiptNumber } });
    expect(await s().Repayment.findOne({ where: { id: reversal.result.repaymentId } })).toMatchObject({ customerId: c, method: 'cash', correctsRepaymentId: wrong.result.repaymentId });
    expect(Number((await s().Repayment.findOne({ where: { id: reversal.result.repaymentId } })).amountMinor)).toBe(50000);
    expect((await one(shop.owner, reverseRepayment(shop.owner, c, wrong.result.repaymentId))).error.code).toBe('ALREADY_REVERSED');
    expect((await one(shop.owner, reverseRepayment(shop.owner, c, reversal.result.repaymentId))).error.code).toBe('CANNOT_REVERSE_A_REVERSAL');
    await one(shop.associate, repay(shop.associate, c, 5000)); // the right amount, as a new record
    expect(await balanceOf(c)).toBe(55000);
  });

  test('a late offline credit sale dated before a repayment gives the same balance and oldestUnpaidAt as if they had come in date order', async () => {
    const inOrder = await customer();
    const late = await customer();
    // In date order: sale (day 1), sale (day 3), repayment (day 4).
    await push(shop.owner, [creditSale(shop.owner, inOrder, 1, at(-3 * 1440)), creditSale(shop.owner, inOrder, 2, at(-1440)), repay(shop.owner, inOrder, 15000)]);
    // The day-1 sale arrives LAST (its phone was offline).
    await push(shop.owner, [creditSale(shop.owner, late, 2, at(-1440)), repay(shop.owner, late, 15000)]);
    await one(shop.owner, creditSale(shop.owner, late, 1, at(-3 * 1440)));
    const [a, b] = [await customerRow(inOrder), await customerRow(late)];
    expect(Number(b.balanceMinor)).toBe(Number(a.balanceMinor));
    expect(b.oldestUnpaidAt.toISOString()).toBe(a.oldestUnpaidAt.toISOString());
    expect(b.oldestUnpaidAt.toISOString()).toBe(at(-1440)); // the day-1 sale was paid first (oldest first)
  });
});

describe('write-offs and debts brought forward (AC22–AC23b, AC27–AC30)', () => {
  test('write-offs: owner only; GH₵ 500 reversed and replaced by GH₵ 50 leaves the right balance, both in the history', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 6)); // 600.00
    const writeOff = (amountMinor) => op('debtWriteOff.create', { writeOffId: randomUUID(), customerId: c, amountMinor, reason: 'moved', recordedAt: at(2) });
    expect((await one(shop.manager, writeOff(5000))).error.code).toBe('FORBIDDEN');
    const wrong = await one(shop.owner, writeOff(50000));
    expect(wrong.result.balanceMinor).toBe(10000);
    const reversal = await one(shop.owner, op('debtWriteOff.create', { writeOffId: randomUUID(), customerId: c, correctsDebtWriteOffId: wrong.result.writeOffId, correctionReason: 'Wrong amount', recordedAt: at(3) }));
    expect(reversal.result.balanceMinor).toBe(60000);
    expect((await one(shop.owner, writeOff(5000))).result.balanceMinor).toBe(55000);
    expect(await s().DebtWriteOff.count({ where: { customerId: c } })).toBe(3);
    expect((await one(shop.owner, op('debtWriteOff.create', { writeOffId: randomUUID(), customerId: c, amountMinor: 100, reason: 'other', recordedAt: at(4) }))).error.fields).toEqual({ note: 'Write what happened.' });
  });

  test('a debt brought forward from 40 days ago: in the balance, owed since that day (start of the day, business time zone); not in the future; not by an associate; a reversal brings the balance back', async () => {
    const c = await customer();
    const fortyDaysAgo = new Date(T0 - 40 * 86400000).toISOString().slice(0, 10);
    const add = (owedSince, who = shop.manager) => op('openingDebt.create', { openingDebtId: randomUUID(), customerId: c, amountMinor: 30000, owedSince, note: 'From the notebook', recordedAt: at() });
    expect((await one(shop.associate, add(fortyDaysAgo, shop.associate))).error.code).toBe('FORBIDDEN');
    expect((await one(shop.manager, add('2026-11-21'))).error.fields).toEqual({ owedSince: "The date can't be in the future." });
    const res = await one(shop.manager, add(fortyDaysAgo));
    expect(res.result.balanceMinor).toBe(30000);
    const row = await customerRow(c);
    expect(row.oldestUnpaidAt.toISOString()).toBe(`${fortyDaysAgo}T00:00:00.000Z`); // Africa/Accra is UTC+0
    expect(Math.round((T0 - row.oldestUnpaidAt.getTime()) / 86400000)).toBe(40);
    const back = await one(shop.owner, op('openingDebt.create', { openingDebtId: randomUUID(), customerId: c, correctsOpeningDebtId: res.result.openingDebtId, correctionReason: 'Typed twice', recordedAt: at(1) }));
    expect(back.result.balanceMinor).toBe(0);
    expect((await customerRow(c)).oldestUnpaidAt).toBeNull();
  });
});

describe('history and what each role pulls', () => {
  test('GET /api/customers/:id/history: newest first, the balance after each, ending at the customer\'s balance; owner and manager only', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 3, at(-60)));
    const r = await one(shop.associate, repay(shop.associate, c, 5000, { recordedAt: at(-30) }));
    await one(shop.manager, reverseRepayment(shop.manager, c, r.result.repaymentId, { recordedAt: at(-20) }));
    await one(shop.associate, repay(shop.associate, c, 2000, { recordedAt: at(-10) }));

    const res = await shop.manager.phone.get(`/api/customers/${c}/history`).set(biz(shop.businessId));
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => [e.type, e.balanceAfterMinor])).toEqual([
      ['repayment', 28000], ['repayment_reversal', 30000], ['repayment', 25000], ['sale', 30000],
    ]);
    expect(res.body.entries[0].balanceAfterMinor).toBe(res.body.balanceMinor);
    expect(res.body.entries[1]).toMatchObject({ reversesReceiptNumber: r.result.receiptNumber, reason: 'Typed 500 instead of 50' });
    expect((await shop.associate.phone.get(`/api/customers/${c}/history`).set(biz(shop.businessId))).body.error.code).toBe('FORBIDDEN');
    expect((await shop.owner.phone.get(`/api/customers/${randomUUID()}/history`).set(biz(shop.businessId))).status).toBe(404);
  });

  test('associates pull only their own repayments and no reversals, write-offs or debts brought forward; owner and manager get them all', async () => {
    const c = await customer();
    await one(shop.owner, creditSale(shop.owner, c, 5));
    const mine = await one(shop.associate, repay(shop.associate, c, 1000));
    const theirs = await one(shop.associateB, repay(shop.associateB, c, 1000));
    await one(shop.manager, reverseRepayment(shop.manager, c, mine.result.repaymentId));
    await one(shop.owner, op('debtWriteOff.create', { writeOffId: randomUUID(), customerId: c, amountMinor: 100, reason: 'disputed', recordedAt: at() }));
    await one(shop.owner, op('openingDebt.create', { openingDebtId: randomUUID(), customerId: c, amountMinor: 100, owedSince: '2026-11-01', recordedAt: at() }));

    const typesOf = async (who) => (await pull(who)).body.rows.filter((row) => ['repayment', 'debtWriteOff', 'openingDebt'].includes(row.type));
    const assoc = await typesOf(shop.associate);
    expect(assoc.every((row) => row.type === 'repayment' && row.data.recordedBy === shop.associate.userId && row.data.correctsRepaymentId === null)).toBe(true);
    expect(assoc.map((row) => row.data.id)).not.toContain(theirs.result.repaymentId);
    for (const who of [shop.owner, shop.manager]) {
      expect(new Set((await typesOf(who)).map((row) => row.type))).toEqual(new Set(['repayment', 'debtWriteOff', 'openingDebt']));
    }
  });
});

describe('permanent, the migration\'s data step, and the checks', () => {
  test('repayments, write-offs and debts brought forward are permanent: scoped().update refuses them', () => {
    for (const model of ['Repayment', 'DebtWriteOff', 'OpeningDebt']) expect(() => s()[model].update({ note: 'x' }, { where: { id: 'x' } })).toThrow(/permanent/);
  });

  test('BE8 credit sales get their lots from the migration\'s data step (the same rebuild code), and check:balances then passes', async () => {
    const c = await customer();
    await push(shop.owner, [creditSale(shop.owner, c, 2), creditSale(shop.owner, c, 1)]);
    const { DebtAllocation, CreditLot, DebtLot } = db.getModels();
    for (const model of [DebtAllocation, CreditLot, DebtLot]) await model.destroy({ where: { businessId: shop.businessId, customerId: c } }); // as before BE9
    expect(await checkBalances(db.getSequelize())).toEqual([expect.objectContaining({ problem: 'lots_mismatch', customerId: c, table: 'DebtLot' })]);
    const { corrected } = await buildExistingLots(db.getSequelize());
    expect(corrected).toBe(0); // balances were already right (BE8's cache), only the lots were missing
    expect(await s().DebtLot.count({ where: { customerId: c } })).toBe(2);
    expect(await checkBalances(db.getSequelize())).toEqual([]);
  });

  test('check:balances, check:receipts, check:sequences and check:operations find nothing wrong', async () => {
    const sequelize = db.getSequelize();
    expect(await checkBalances(sequelize)).toEqual([]);
    expect(await checkReceipts(sequelize)).toEqual([]);
    expect(await checkSequences(sequelize)).toEqual([]);
    expect(await checkOperations(sequelize)).toEqual([]);
  });
});
