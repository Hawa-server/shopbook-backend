// BE8: sales (Epic 3A) through real pushes on the test database: the sale
// invariants, prices by version (and editOpId), the cost set by the server,
// half-yard rounding (saved and flagged roundedLine), payments (unknown
// method refused, switched-off method saved and flagged methodDisabled),
// receipt numbers (the registry, this phone's code), flags (below zero,
// over credit limit, below cost, older price, clock), customers and their
// cached balance, what each role pulls, the database guards, and the
// read-only checks.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const rule = require('../../src/services/stockRule');
const { scoped } = require('../../src/services/scoped');
const { checkReceipts, checkBalances } = require('../../src/checks/moneyChecks');
const { checkStock } = require('../../src/checks/stockChecks');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { routes } = require('../../src/routes');
const { resetDatabase, dbApp, createClock, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
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
  return {
    owner, manager: await staff(owner, 'manager'), associate: await staff(owner, 'associate'), associateB: await staff(owner, 'associate'),
    businessId, locationId: location.id,
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

const push = (who, ops) => who.phone.post('/api/sync/push').set(biz(who.businessId)).send({ deviceId: who.deviceId, operations: ops });
const pull = (who, since = 0) => who.phone.get(`/api/sync/pull?since=${since}&limit=500`).set(biz(who.businessId));
const op = (type, payload, extra = {}) => ({ opId: randomUUID(), type, recordedOnline: false, payload, ...extra });
const one = async (who, operation) => (await push(who, [operation])).body.results[0];
const s = () => scoped({ business: { id: shop.businessId } }, db.getModels());
const receipt = (who) => `${who.code}-${String(who.next++).padStart(4, '0')}`;

// A product made by the owner (version 1), optionally with sizes and stock.
async function product({ unit = 'pair', type = 'shoes', retailMinor = 12000, wholesaleMinor = 10000, costMinor = 8000, sizes = [], stock = 0 } = {}) {
  const productId = randomUUID();
  const ops = [op('product.upsert', { productId, baseVersion: null, fields: { name: `P ${productId.slice(0, 6)}`, type, unit, retailMinor, wholesaleMinor, costMinor } })];
  const ids = {};
  sizes.forEach((sz, i) => {
    ids[sz.label] = randomUUID();
    ops.push(op('size.upsert', { sizeId: ids[sz.label], productId, baseVersion: null, fields: { sortOrder: i, ...sz } }));
  });
  for (const sizeId of sizes.length ? Object.values(ids) : [null]) {
    if (stock) ops.push(op('stock.create', { movementId: randomUUID(), type: 'opening', locationId: shop.locationId, productId, sizeId, quantityUnits: stock, recordedAt: at(-60) }));
  }
  const res = await push(shop.owner, ops);
  expect(res.body.results.every((r) => r.status === 'saved')).toBe(true);
  return { productId, sizes: ids };
}

// A customer (made by `who`); returns its ID.
async function customer(who = shop.owner, fields = {}) {
  const customerId = randomUUID();
  const res = await one(who, op('customer.upsert', { customerId, baseVersion: null, fields: { name: 'Ama Owusu', ...fields } }));
  expect(res.status).toBe('saved');
  return customerId;
}

// A sale line; the line total comes from the shared rule unless overridden.
function line(p, { sizeId = null, quantityUnits = 1, setPriceMinor = 12000, agreedPriceMinor, unitScale = 1, productVersion = 1, sizeVersion, ...rest } = {}) {
  const agreed = agreedPriceMinor ?? setPriceMinor;
  const total = Math.floor((2 * quantityUnits * agreed + unitScale) / (2 * unitScale));
  return {
    itemId: randomUUID(), productId: p.productId, sizeId, quantityUnits, productVersion,
    ...(sizeId ? { sizeVersion: sizeVersion ?? 1 } : {}),
    setPriceMinor, agreedPriceMinor: agreed, lineTotalMinor: total, ...rest,
  };
}

// A sale.create operation by `who`, with totals worked out from the lines.
function sale(who, items, { payments, customerId = null, priceType = 'retail', recordedAt = at(), ...rest } = {}) {
  const subtotal = items.reduce((a, i) => a + i.lineTotalMinor, 0);
  const pays = payments ?? [{ method: 'cash', amountMinor: subtotal }];
  const paid = pays.reduce((a, x) => a + x.amountMinor, 0);
  return op('sale.create', {
    saleId: randomUUID(), receiptNumber: receipt(who), locationId: shop.locationId, customerId, priceType, items,
    payments: pays.map((x) => ({ paymentId: randomUUID(), ...x })),
    subtotalMinor: subtotal, paidMinor: paid, creditMinor: subtotal - paid, recordedAt, ...rest,
  });
}

describe('saving a sale', () => {
  test('a cash sale by an associate: saved with its lines, payment, stock movement and receipt registry row; stock goes down', async () => {
    const p = await product({ stock: 5 });
    const res = await one(shop.associate, sale(shop.associate, [line(p, { quantityUnits: 2 })]));
    expect(res).toMatchObject({ status: 'saved', result: { subtotalMinor: 24000, paidMinor: 24000, creditMinor: 0 } });
    const saleId = res.result.saleId;

    const row = await s().Sale.findOne({ where: { id: saleId } });
    expect(row).toMatchObject({ recordedBy: shop.associate.userId, deviceId: shop.associate.deviceId, priceType: 'retail' });
    const item = await s().SaleItem.findOne({ where: { saleId } });
    expect(item).toMatchObject({ productName: expect.stringMatching(/^P /), unit: 'pair', unitScale: 1, quantityUnits: 2, productVersion: 1 });
    expect(Number(item.unitCostMinor)).toBe(8000); // set by the server from version 1
    const movement = await s().StockMovement.findOne({ where: { saleId } });
    expect(movement).toMatchObject({ id: item.id, type: 'sale', quantityUnits: -2 });
    expect(await s().ReceiptNumber.count({ where: { recordId: saleId, recordType: 'sale' } })).toBe(1);
    const rows = { movements: (await s().StockMovement.findAll({ where: { productId: p.productId } })).map((m) => m.get({ plain: true })), counts: [] };
    expect(rule.stockOnHand(rows)).toBe(3);
  });

  test('split cash and MoMo, part-paid on credit with a customer; the customer\'s cached balance and oldestUnpaidAt follow', async () => {
    const p = await product({ stock: 10 });
    const c = await customer(shop.associate);
    const items = [line(p, { quantityUnits: 2 })]; // 24,000
    const split = await one(shop.owner, sale(shop.owner, items, { payments: [{ method: 'cash', amountMinor: 14000 }, { method: 'mobile_money', amountMinor: 10000 }] }));
    expect(split.status).toBe('saved');
    expect(await s().SalePayment.count({ where: { saleId: split.result.saleId } })).toBe(2);

    const credit = await one(shop.associate, sale(shop.associate, [line(p, { quantityUnits: 1 })], { customerId: c, payments: [{ method: 'cash', amountMinor: 2000 }], recordedAt: at(5) }));
    expect(credit.result).toMatchObject({ paidMinor: 2000, creditMinor: 10000 });
    const cust = await s().Customer.findOne({ where: { id: c } });
    expect(Number(cust.balanceMinor)).toBe(10000);
    expect(cust.oldestUnpaidAt.toISOString()).toBe(at(5));
    const allCredit = await one(shop.associate, sale(shop.associate, [line(p)], { customerId: c, payments: [], recordedAt: at(-30) }));
    expect(allCredit.result.creditMinor).toBe(12000);
    const after = await s().Customer.findOne({ where: { id: c } });
    expect([Number(after.balanceMinor), after.oldestUnpaidAt.toISOString()]).toEqual([22000, at(-30)]);
  });

  test('wholesale uses the size\'s own wholesale, else the product\'s, else retail; a size\'s own retail price is used', async () => {
    const p = await product({ wholesaleMinor: null, sizes: [{ label: '40' }, { label: '45', retailMinor: 14000 }], stock: 3 });
    const res = await one(shop.owner, sale(shop.owner, [
      line(p, { sizeId: p.sizes['40'], setPriceMinor: 12000 }),
      line(p, { sizeId: p.sizes['45'], setPriceMinor: 14000 }),
    ], { priceType: 'wholesale' }));
    expect(res.status).toBe('saved');
    expect((await one(shop.owner, sale(shop.owner, [line(p, { sizeId: p.sizes['45'], setPriceMinor: 12000 })], { priceType: 'wholesale' }))).error.code).toBe('PRICE_VERSION_MISMATCH');
  });
});

describe('the sale invariants', () => {
  test('totals that don\'t add up, a missing price note, credit without a customer: rejected with clear codes; nothing saved', async () => {
    const p = await product({ stock: 10 });
    const bad = sale(shop.owner, [line(p)]);
    bad.payload.subtotalMinor += 1;
    expect((await one(shop.owner, bad)).error).toMatchObject({ code: 'SALE_TOTALS_MISMATCH', fields: { subtotalMinor: expect.any(String) } });
    const wrongLine = sale(shop.owner, [{ ...line(p), lineTotalMinor: 11999 }]);
    wrongLine.payload.subtotalMinor = 11999; wrongLine.payload.paidMinor = 11999; wrongLine.payload.payments[0].amountMinor = 11999;
    expect((await one(shop.owner, wrongLine)).error.code).toBe('SALE_TOTALS_MISMATCH');
    expect((await one(shop.owner, sale(shop.owner, [line(p, { agreedPriceMinor: 11000 })]))).error.fields).toEqual({ 'items.0.priceNote': 'Add a note for the changed price.' });
    expect((await one(shop.owner, sale(shop.owner, [line(p)], { payments: [{ method: 'cash', amountMinor: 1000 }] }))).error.fields).toEqual({ customerId: 'Choose a customer for the part on credit.' });
    const overpaid = sale(shop.owner, [line(p)], { payments: [{ method: 'cash', amountMinor: 13000 }] });
    expect((await one(shop.owner, overpaid)).error.code).toBe('INVALID_PAYLOAD'); // a negative credit is malformed
    expect(await s().SaleItem.count({ where: { productId: p.productId } })).toBe(0);
    expect(await s().StockMovement.count({ where: { productId: p.productId, type: 'sale' } })).toBe(0);
  });

  test('a changed price with a note is saved; a free item (price 0) with a note too', async () => {
    const p = await product({ stock: 10 });
    expect((await one(shop.associate, sale(shop.associate, [line(p, { agreedPriceMinor: 11000, priceNote: 'Bargained' })]))).status).toBe('saved');
    const free = sale(shop.associate, [line(p, { agreedPriceMinor: 0, priceNote: 'Given to a regular customer' })], { payments: [] });
    expect((await one(shop.associate, free)).status).toBe('saved');
  });
});

describe('prices by version', () => {
  test('an older version is saved and flagged olderPrice (owner and manager see it); the same price in a newer version isn\'t flagged', async () => {
    const p = await product({ stock: 10 });
    await one(shop.owner, op('product.upsert', { productId: p.productId, baseVersion: 1, fields: { retailMinor: 13000 } }));
    const old = await one(shop.associate, sale(shop.associate, [line(p, { productVersion: 1, setPriceMinor: 12000 })]));
    expect(old.status).toBe('saved');
    expect(old.result.flags.olderPrice).toBeUndefined(); // an associate isn't told
    const row = await s().Sale.findOne({ where: { id: old.result.saleId } });
    expect(row.flags.olderPrice).toBe(true);
    await one(shop.owner, op('product.upsert', { productId: p.productId, baseVersion: 2, fields: { name: `Renamed ${randomUUID().slice(0, 4)}` } }));
    const samePrice = await one(shop.manager, sale(shop.manager, [line(p, { productVersion: 2, setPriceMinor: 13000 })]));
    expect(samePrice.result.flags.olderPrice).toBe(false); // v2 is older than v3, but the price is the same
  });

  test('a set price that isn\'t the version\'s is PRICE_VERSION_MISMATCH; a version never issued is UNKNOWN_PRICE_VERSION', async () => {
    const p = await product({ stock: 10 });
    expect((await one(shop.owner, sale(shop.owner, [line(p, { setPriceMinor: 11000 })]))).error.code).toBe('PRICE_VERSION_MISMATCH');
    expect((await one(shop.owner, sale(shop.owner, [line(p, { productVersion: 9 })]))).error.code).toBe('UNKNOWN_PRICE_VERSION');
  });

  test('a sale made right after an offline price edit names it by editOpId, in the same push', async () => {
    const p = await product({ stock: 10 });
    const edit = op('product.upsert', { productId: p.productId, baseVersion: 1, fields: { retailMinor: 15000 } });
    const item = line(p, { setPriceMinor: 15000 });
    delete item.productVersion;
    item.productEditOpId = edit.opId;
    const res = await push(shop.manager, [edit, sale(shop.manager, [item])]);
    expect(res.body.results.map((r) => r.status)).toEqual(['saved', 'saved']);
    expect((await s().SaleItem.findOne({ where: { productId: p.productId } })).productVersion).toBe(2);
    const unknown = { ...line(p, { setPriceMinor: 15000 }), productEditOpId: randomUUID() };
    delete unknown.productVersion;
    expect((await one(shop.manager, sale(shop.manager, [unknown]))).error.code).toBe('UNKNOWN_PRICE_VERSION');
  });

  test('a sale of each of two same-name products (added by two phones offline) is accepted', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await push(shop.owner, [
      op('product.upsert', { productId: a, baseVersion: null, fields: { name: 'Twin sandal', type: 'shoes', unit: 'pair', retailMinor: 5000, costMinor: 3000 } }),
      op('product.upsert', { productId: b, baseVersion: null, fields: { name: 'twin  SANDAL', type: 'shoes', unit: 'pair', retailMinor: 5200, costMinor: 3000 } }),
    ]);
    const res = await push(shop.associate, [
      sale(shop.associate, [line({ productId: a }, { setPriceMinor: 5000 })]),
      sale(shop.associate, [line({ productId: b }, { setPriceMinor: 5200 })]),
    ]);
    expect(res.body.results.map((r) => r.status)).toEqual(['saved', 'saved']);
  });
});

describe('half yards and payments', () => {
  test('half a yard at GH₵ 15.05 is rounded to 753 (halves up), saved and flagged roundedLine', async () => {
    const p = await product({ type: 'fabric', unit: 'yard', retailMinor: 1505, wholesaleMinor: null, costMinor: 1000, stock: 10 });
    const res = await one(shop.owner, sale(shop.owner, [line(p, { quantityUnits: 1, setPriceMinor: 1505, unitScale: 2 })]));
    expect(res).toMatchObject({ status: 'saved', result: { subtotalMinor: 753, flags: { roundedLine: true } } });
    const exact = await one(shop.owner, sale(shop.owner, [line(p, { quantityUnits: 2, setPriceMinor: 1505, unitScale: 2 })]));
    expect(exact.result.flags.roundedLine).toBe(false);
    const truncated = sale(shop.owner, [{ ...line(p, { quantityUnits: 1, setPriceMinor: 1505, unitScale: 2 }), lineTotalMinor: 752 }]);
    truncated.payload.subtotalMinor = 752; truncated.payload.paidMinor = 752; truncated.payload.payments[0].amountMinor = 752;
    expect((await one(shop.owner, truncated)).error.code).toBe('SALE_TOTALS_MISMATCH'); // rounding down is wrong
  });

  test('an unknown payment method is rejected; a known one the business switched off is saved and flagged methodDisabled', async () => {
    const p = await product({ stock: 10 });
    expect((await one(shop.owner, sale(shop.owner, [line(p)], { payments: [{ method: 'bitcoin', amountMinor: 12000 }] }))).error.code).toBe('PAYMENT_METHOD_UNKNOWN');
    const { version } = await s().BusinessSettings.findOne({ where: {} });
    await one(shop.owner, op('settings.update', { baseVersion: version, changes: { paymentMethods: ['cash'] } }));
    const momo = await one(shop.manager, sale(shop.manager, [line(p)], { payments: [{ method: 'mobile_money', amountMinor: 12000 }] }));
    expect(momo).toMatchObject({ status: 'saved', result: { flags: { methodDisabled: true } } });
    await one(shop.owner, op('settings.update', { baseVersion: version + 1, changes: { paymentMethods: ['cash', 'mobile_money'] } }));
  });
});

describe('receipt numbers', () => {
  test('a number already used is RECEIPT_NUMBER_TAKEN; another phone\'s code is RECEIPT_NUMBER_INVALID', async () => {
    const p = await product({ stock: 10 });
    const first = sale(shop.associate, [line(p)]);
    expect((await one(shop.associate, first)).status).toBe('saved');
    const again = sale(shop.associate, [line(p)]);
    again.payload.receiptNumber = first.payload.receiptNumber;
    expect((await one(shop.associate, again)).error.code).toBe('RECEIPT_NUMBER_TAKEN');
    const foreign = sale(shop.associate, [line(p)]);
    foreign.payload.receiptNumber = `${shop.owner.code}-9999`;
    expect((await one(shop.associate, foreign)).error.code).toBe('RECEIPT_NUMBER_INVALID');
  });
});

describe('saved and flagged, never refused', () => {
  test('stock below zero: saved, belowZeroOnArrival on the sale and its movement', async () => {
    const p = await product({ stock: 1 });
    const res = await one(shop.associate, sale(shop.associate, [line(p, { quantityUnits: 3 })]));
    expect(res).toMatchObject({ status: 'saved', result: { flags: { belowZeroOnArrival: true } } });
    expect((await s().StockMovement.findOne({ where: { saleId: res.result.saleId } })).flags.belowZeroOnArrival).toBe(true);
  });

  test('over the credit limit: saved even from an associate (the phone stops them), flagged for the owner and manager', async () => {
    const { version } = await s().BusinessSettings.findOne({ where: {} });
    await one(shop.owner, op('settings.update', { baseVersion: version, changes: { defaultCreditLimitMinor: 20000 } }));
    const c = await customer(shop.associate, { name: 'Kofi Limit' });
    expect(Number((await s().Customer.findOne({ where: { id: c } })).creditLimitMinor)).toBe(20000);
    const p = await product({ stock: 10 });
    const res = await one(shop.associate, sale(shop.associate, [line(p, { quantityUnits: 2 })], { customerId: c, payments: [] }));
    expect(res.status).toBe('saved');
    expect((await s().Sale.findOne({ where: { id: res.result.saleId } })).flags.overCreditLimit).toBe(true);
    await one(shop.owner, op('settings.update', { baseVersion: version + 1, changes: { defaultCreditLimitMinor: null } }));
  });

  test('below cost: saved, flagged belowCost for the OWNER only (never in a manager\'s or associate\'s result or pull)', async () => {
    const p = await product({ costMinor: 8000, stock: 10 });
    const res = await one(shop.manager, sale(shop.manager, [line(p, { agreedPriceMinor: 7000, priceNote: 'Old stock' })]));
    expect(res.status).toBe('saved');
    expect(res.result.flags).not.toHaveProperty('belowCost');
    expect((await s().Sale.findOne({ where: { id: res.result.saleId } })).flags.belowCost).toBe(true);
    const ownerRow = (await pull(shop.owner)).body.rows.find((r) => r.type === 'sale' && r.data.id === res.result.saleId);
    expect(ownerRow.data.flags.belowCost).toBe(true);
    const managerRow = (await pull(shop.manager)).body.rows.find((r) => r.type === 'sale' && r.data.id === res.result.saleId);
    expect(managerRow.data.flags).not.toHaveProperty('belowCost');
  });

  test('a hidden product and a removed size are still sold (the goods have gone)', async () => {
    const p = await product({ sizes: [{ label: 'M' }, { label: 'L' }] });
    await one(shop.owner, op('product.upsert', { productId: p.productId, baseVersion: 1, fields: { isHidden: true } }));
    await one(shop.owner, op('size.upsert', { sizeId: p.sizes.L, productId: p.productId, baseVersion: 1, fields: { isActive: false } }));
    const res = await one(shop.associate, sale(shop.associate, [line(p, { sizeId: p.sizes.L })]));
    expect(res.status).toBe('saved');
  });

  test('clockSkew: recorded 20 minutes in the future', async () => {
    const p = await product({ stock: 10 });
    const res = await one(shop.associate, sale(shop.associate, [line(p)], { recordedAt: at(20) }));
    expect(res.result.flags.clockSkew).toBe(true);
  });
});

describe('customers (BE8: created only)', () => {
  test('any role adds a customer with the business\'s default language; a bad phone number is refused; editing waits for BE9', async () => {
    const c = await customer(shop.associate, { name: '  Efua   Mensah ', phone: '024 555 1234' });
    expect(await s().Customer.findOne({ where: { id: c } })).toMatchObject({ name: 'Efua Mensah', phone: '+233245551234', language: 'en', version: 1 });
    expect((await one(shop.owner, op('customer.upsert', { customerId: randomUUID(), baseVersion: null, fields: { name: 'X', phone: '12' } }))).error.fields).toEqual({ phone: 'Enter a valid mobile number, for example 024 123 4567.' });
    expect((await one(shop.owner, op('customer.upsert', { customerId: c, baseVersion: 1, fields: { name: 'New' } }))).error.code).toBe('INVALID_PAYLOAD');
  });
});

describe('what each role pulls', () => {
  test('associates get only their OWN sales; no one but the owner gets unitCostMinor; everyone\'s cursor moves on', async () => {
    const p = await product({ stock: 10 });
    const mine = await one(shop.associate, sale(shop.associate, [line(p)]));
    const theirs = await one(shop.associateB, sale(shop.associateB, [line(p)]));

    const salesOf = async (who) => {
      const page = await pull(who);
      expect(page.body.nextCursor).toBe(page.body.watermark);
      return page.body.rows.filter((r) => r.type === 'sale');
    };
    const a = await salesOf(shop.associate);
    expect(a.every((r) => r.data.recordedBy === shop.associate.userId)).toBe(true);
    expect(a.map((r) => r.data.id)).toContain(mine.result.saleId);
    expect(a.map((r) => r.data.id)).not.toContain(theirs.result.saleId);

    for (const who of [shop.manager, shop.associate]) {
      for (const r of await salesOf(who)) r.data.items.forEach((i) => expect(i).not.toHaveProperty('unitCostMinor'));
    }
    const ownerSale = (await salesOf(shop.owner)).find((r) => r.data.id === mine.result.saleId);
    expect(ownerSale.data.items[0].unitCostMinor).toBe(8000);
    expect(ownerSale.data.payments).toEqual([{ id: expect.any(String), method: 'cash', amountMinor: 12000 }]);
  });

  test('stock movements of a sale carry saleId for the owner and manager; associates still get only the stock-rule fields', async () => {
    const p = await product({ stock: 10 });
    const res = await one(shop.associate, sale(shop.associate, [line(p)]));
    const find = async (who) => (await pull(who)).body.rows.find((r) => r.type === 'stockMovement' && r.data.saleId === res.result.saleId);
    expect(await find(shop.manager)).toBeDefined();
    const assocRow = (await pull(shop.associateB)).body.rows.find((r) => r.type === 'stockMovement' && r.data.productId === p.productId && r.data.quantityUnits === -1);
    expect(Object.keys(assocRow.data).sort()).toEqual(['id', 'locationId', 'productId', 'quantityUnits', 'receivedAt', 'recordedAt', 'sizeId']);
  });
});

describe('permanent, and the database guards', () => {
  test('no route changes or removes a sale, and scoped().update refuses sales, lines and payments', async () => {
    expect(routes.filter((r) => /sale/i.test(r.path))).toEqual([]);
    for (const model of ['Sale', 'SaleItem', 'SalePayment']) {
      expect(() => s()[model].update({ id: 'x' }, { where: { id: 'x' } })).toThrow(/permanent/);
    }
  });

  test('MySQL refuses credit without a customer and credit that doesn\'t add up', async () => {
    const base = {
      businessId: shop.businessId, locationId: shop.locationId, deviceId: shop.owner.deviceId, priceType: 'retail', flags: {},
      recordedBy: shop.owner.userId, recordedAt: new Date(), receivedAt: new Date(),
    };
    const { Sale } = db.getModels();
    await expect(Sale.create({ ...base, id: randomUUID(), receiptNumber: `${shop.owner.code}-8001`, subtotalMinor: 100, paidMinor: 50, creditMinor: 50 })).rejects.toThrow();
    await expect(Sale.create({ ...base, id: randomUUID(), receiptNumber: `${shop.owner.code}-8002`, subtotalMinor: 100, paidMinor: 50, creditMinor: 10 })).rejects.toThrow();
  });

  test('the first sale locks the business\'s country, currency and time zone', async () => {
    const business = await db.getModels().Business.findByPk(shop.businessId);
    expect(business.moneyRecordedAt).not.toBeNull();
    const me = await shop.owner.phone.get('/api/auth/me').set(XHR);
    expect(me.body.businesses.find((b) => b.id === shop.businessId).localeLocked).toBe(true);
  });

  test('check:receipts, check:balances, check:stock, check:sequences and check:operations find nothing wrong', async () => {
    const sequelize = db.getSequelize();
    expect(await checkReceipts(sequelize)).toEqual([]);
    expect(await checkBalances(sequelize)).toEqual([]);
    expect(await checkStock(sequelize)).toEqual([]);
    expect(await checkSequences(sequelize)).toEqual([]);
    expect(await checkOperations(sequelize)).toEqual([]);
  });
});
