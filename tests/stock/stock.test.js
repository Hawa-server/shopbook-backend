// BE7: stock movements and counts (Epic 2) through real pushes on the test
// database: who may do what, the field rules, half yards, never refusing for
// short stock (belowZeroOnArrival), clockSkew, the count rule (the worked
// example: stock 8, difference +1), late records around a count, the BE6
// follow-ups (SIZE_HAS_STOCK, UNIT_LOCKED), low-stock levels, what each role
// pulls, and check:stock. The test clock is controlled, so "when a record
// arrives" is exact.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const rule = require('../../src/services/stockRule');
const { scoped } = require('../../src/services/scoped');
const { checkStock } = require('../../src/checks/stockChecks');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { resetDatabase, dbApp, createClock, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const T0 = Date.UTC(2026, 10, 10, 8, 0, 0); // 10 Nov 2026, 08:00 UTC
const at = (minutes) => new Date(T0 + minutes * 60 * 1000).toISOString(); // minutes after 08:00

let ctx;
let shop;
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp({ clock: createClock(T0) });
  shop = await team();
}, 120000);
afterAll(() => db.closeDatabase());

// An owner, a manager and an associate of one business, each with a phone.
async function team() {
  const { agent, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  const owner = { phone: agent, businessId, userId: res.body.user.id, deviceId: device.deviceId };
  const location = await db.getModels().Location.findOne({ where: { businessId } });
  return { owner, manager: await staff(owner, 'manager'), associate: await staff(owner, 'associate'), businessId, locationId: location.id };
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
  return { phone: agent, businessId: o.businessId, deviceId: device.deviceId, userId: res.body.user.id };
}

const push = (who, ops) => who.phone.post('/api/sync/push').set(biz(who.businessId)).send({ deviceId: who.deviceId, operations: ops });
const pull = (who, since = 0) => who.phone.get(`/api/sync/pull?since=${since}&limit=500`).set(biz(who.businessId));
const op = (type, payload, extra = {}) => ({ opId: randomUUID(), type, recordedOnline: false, payload, ...extra });
const one = async (who, operation) => (await push(who, [operation])).body.results[0];
const s = () => scoped({ business: { id: shop.businessId } }, db.getModels());

// A product (and its sizes) made by the owner; returns { productId, sizes: { label: id } }.
async function product({ unit = 'pair', type = 'shoes', sizes = ['40', '41'] } = {}) {
  const productId = randomUUID();
  const ops = [op('product.upsert', { productId, baseVersion: null, fields: { name: `P ${productId.slice(0, 6)}`, type, unit, retailMinor: 1000, costMinor: 500 } })];
  const ids = {};
  sizes.forEach((label, i) => {
    ids[label] = randomUUID();
    ops.push(op('size.upsert', { sizeId: ids[label], productId, baseVersion: null, fields: { label, sortOrder: i } }));
  });
  const res = await push(shop.owner, ops);
  expect(res.body.results.every((r) => r.status === 'saved')).toBe(true);
  return { productId, sizes: ids };
}

// A stock.create operation.
const move = (p, sizeId, type, quantityUnits, extra = {}) => op('stock.create', {
  movementId: randomUUID(), type, locationId: shop.locationId, productId: p.productId, sizeId, quantityUnits, recordedAt: at(0), ...extra,
});
// A stockCount.create operation.
const count = (p, sizeId, countedUnits, baselineUnits, extra = {}) => op('stockCount.create', {
  countId: randomUUID(), locationId: shop.locationId, productId: p.productId, sizeId, countedUnits, baselineUnits, baselineCursor: 0, recordedAt: at(0), ...extra,
});
// All stock rows of one size, as the rule wants them.
async function rowsOf(productId, sizeId) {
  const where = { productId, sizeId };
  const movements = (await s().StockMovement.findAll({ where })).map((m) => ({ id: m.id, quantityUnits: m.quantityUnits, recordedAt: m.recordedAt, receivedAt: m.receivedAt }));
  const counts = (await s().StockCount.findAll({ where })).map((c) => ({ id: c.id, countedUnits: c.countedUnits, recordedAt: c.recordedAt, receivedAt: c.receivedAt }));
  return { movements, counts };
}

describe('adding and removing stock', () => {
  test('opening and restock per size, by the owner and the manager: saved with signs, names and times; stock = the sum of movements', async () => {
    const p = await product();
    const res = await push(shop.owner, [move(p, p.sizes['40'], 'opening', 6), move(p, p.sizes['41'], 'opening', 2)]);
    expect(res.body.results.map((r) => r.result.stockOnHandUnits)).toEqual([6, 2]);
    const restock = await one(shop.manager, move(p, p.sizes['40'], 'restock', 4, { note: 'From Kumasi supplier' }));
    expect(restock).toMatchObject({ status: 'saved', result: { stockOnHandUnits: 10, flags: { belowZeroOnArrival: false, clockSkew: false } } });

    const rows = await s().StockMovement.findAll({ where: { productId: p.productId }, order: [['quantityUnits', 'ASC']] });
    expect(rows.map((r) => [r.type, r.quantityUnits])).toEqual([['opening', 2], ['restock', 4], ['opening', 6]]);
    expect(rows.find((r) => r.type === 'restock')).toMatchObject({ recordedBy: shop.manager.userId, note: 'From Kumasi supplier' });
    expect(rule.stockOnHand(await rowsOf(p.productId, p.sizes['40']))).toBe(10);
  });

  test('removals need a reason, and "other" needs a note; the quantity is stored negative', async () => {
    const p = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 5));
    expect((await one(shop.owner, move(p, p.sizes['40'], 'removal', 1))).error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { reason: 'Choose a reason.' } });
    expect((await one(shop.owner, move(p, p.sizes['40'], 'removal', 1, { reason: 'other' }))).error.fields).toEqual({ note: 'Write what happened.' });
    expect((await one(shop.owner, move(p, p.sizes['40'], 'restock', 1, { reason: 'damaged' }))).error.fields).toEqual({ reason: 'Only removals have a reason.' });
    const removal = await one(shop.manager, move(p, p.sizes['40'], 'removal', 2, { reason: 'other', note: 'Given to the tailor' }));
    expect(removal.result.stockOnHandUnits).toBe(3);
    expect((await s().StockMovement.findOne({ where: { id: removal.result.movementId } })).quantityUnits).toBe(-2);
  });

  test('an associate\'s stock operation and count are refused FORBIDDEN (F-17)', async () => {
    const p = await product();
    expect((await one(shop.associate, move(p, p.sizes['40'], 'opening', 1))).error.code).toBe('FORBIDDEN');
    expect((await one(shop.associate, count(p, p.sizes['40'], 0, 0))).error.code).toBe('FORBIDDEN');
  });

  test('field rules: quantity 1 to 100,000 (in yards: half yards, 2.5 yards = 5 units); size needed when the product has sizes; no new stock into a removed size', async () => {
    const shoes = await product();
    expect((await one(shop.owner, move(shoes, shoes.sizes['40'], 'restock', 0))).error.code).toBe('INVALID_PAYLOAD');
    expect((await one(shop.owner, move(shoes, shoes.sizes['40'], 'restock', 1.5))).error.code).toBe('INVALID_PAYLOAD');
    expect((await one(shop.owner, move(shoes, shoes.sizes['40'], 'restock', 100001))).error.fields).toEqual({ quantityUnits: 'Use at most 100,000.' });
    expect((await one(shop.owner, move(shoes, null, 'restock', 1))).error.fields).toEqual({ sizeId: 'Choose a size.' });

    const kente = await product({ type: 'fabric', unit: 'yard', sizes: [] });
    const yards = await one(shop.owner, move(kente, null, 'opening', 5)); // 2.5 yards
    expect(yards.result.stockOnHandUnits).toBe(5);
    expect((await one(shop.owner, move(kente, null, 'restock', 200000))).status).toBe('saved'); // 100,000 yards
    expect((await one(shop.owner, move(kente, null, 'restock', 200001))).error.code).toBe('INVALID_PAYLOAD'); // above any product's limit

    await one(shop.owner, op('size.upsert', { sizeId: shoes.sizes['41'], productId: shoes.productId, baseVersion: 1, fields: { isActive: false } }));
    expect((await one(shop.owner, move(shoes, shoes.sizes['41'], 'restock', 1))).error.fields).toEqual({ sizeId: 'This size has been removed.' });
  });

  test('another product\'s size, an unknown product, an unknown shop: refused, nothing saved', async () => {
    const a = await product();
    const b = await product();
    expect((await one(shop.owner, move(a, b.sizes['40'], 'opening', 1))).error.fields).toEqual({ sizeId: 'This size belongs to another product.' });
    expect((await one(shop.owner, move({ productId: randomUUID() }, null, 'opening', 1))).error.code).toBe('NOT_FOUND');
    expect((await one(shop.owner, move(a, a.sizes['40'], 'opening', 1, { locationId: randomUUID() }))).error.code).toBe('NOT_FOUND');
    expect(await s().StockMovement.count({ where: { productId: a.productId } })).toBe(0);
  });
});

describe('below zero and clocks', () => {
  test('a removal that takes stock below zero is SAVED with belowZeroOnArrival; current stock comes from the rule', async () => {
    const p = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 1));
    const res = await one(shop.manager, move(p, p.sizes['40'], 'removal', 3, { reason: 'lost' }));
    expect(res).toMatchObject({ status: 'saved', result: { stockOnHandUnits: -2, flags: { belowZeroOnArrival: true } } });
    const restock = await one(shop.owner, move(p, p.sizes['40'], 'restock', 5));
    expect(restock.result).toMatchObject({ stockOnHandUnits: 3, flags: { belowZeroOnArrival: false } });
  });

  test('two phones remove the last items at the same moment: both saved, stock below zero, the later one flagged, check:stock agrees', async () => {
    const p = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 2));
    const [a, b] = await Promise.all([
      one(shop.owner, move(p, p.sizes['40'], 'removal', 2, { reason: 'damaged' })),
      one(shop.manager, move(p, p.sizes['40'], 'removal', 2, { reason: 'supplier_return' })),
    ]);
    expect([a.status, b.status]).toEqual(['saved', 'saved']);
    expect([a, b].map((r) => r.result.flags.belowZeroOnArrival).sort()).toEqual([false, true]);
    expect([a, b].map((r) => r.result.stockOnHandUnits).sort()).toEqual([-2, 0]);
    expect(rule.stockOnHand(await rowsOf(p.productId, p.sizes['40']))).toBe(-2);
    expect(await checkStock(db.getSequelize())).toEqual([]);
  });

  test('clockSkew: recorded more than 10 minutes in the future, or "online" but 10+ minutes away; saved either way', async () => {
    const p = await product();
    const future = await one(shop.owner, move(p, p.sizes['40'], 'opening', 1, { recordedAt: at(11) }));
    expect(future.result.flags.clockSkew).toBe(true);
    const offlineOld = await one(shop.owner, move(p, p.sizes['40'], 'restock', 1, { recordedAt: at(-120) }));
    expect(offlineOld.result.flags.clockSkew).toBe(false); // made offline two hours ago: normal
    const onlineOld = { ...move(p, p.sizes['40'], 'restock', 1, { recordedAt: at(-120) }), recordedOnline: true };
    expect((await one(shop.owner, onlineOld)).result.flags.clockSkew).toBe(true);
  });
});

describe('counts', () => {
  test('the worked example: A shows 10, B sells 3 at 09:58 offline, A counts 8 at 10:00, B\'s record arrives later: stock 8, difference +1, "check this count"', async () => {
    const p = await product();
    ctx.clock.set(T0);
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 10, { recordedAt: at(0) }));

    ctx.clock.set(T0 + 120 * 60000 + 10000); // 10:00:10: the count arrives
    const counted = await one(shop.owner, count(p, p.sizes['40'], 8, 10, { recordedAt: at(120), reason: 'lost_or_stolen' }));
    expect(counted.result).toMatchObject({ expectedUnits: 10, differenceUnits: -2, stockOnHandUnits: 8 }); // what was known then

    ctx.clock.set(T0 + 210 * 60000); // 11:30: B's "sale" (a removal until BE8 brings sales) recorded at 09:58 arrives
    const late = await one(shop.manager, move(p, p.sizes['40'], 'removal', 3, { reason: 'used', recordedAt: at(118) }));
    expect(late.result.stockOnHandUnits).toBe(8); // recorded before the count: absorbed, stock unchanged

    const rows = await rowsOf(p.productId, p.sizes['40']);
    expect(rule.stockOnHand(rows)).toBe(8);
    const theCount = rows.counts[0];
    expect(rule.countResult(theCount, rows)).toEqual({ expectedUnits: 7, differenceUnits: 1 });
    expect(rule.countNeedsCheck(theCount, rows.movements)).toBe(true);

    ctx.clock.set(T0 + 211 * 60000); // a sale recorded AFTER the count is subtracted
    expect((await one(shop.owner, move(p, p.sizes['40'], 'removal', 1, { reason: 'used', recordedAt: at(130) }))).result.stockOnHandUnits).toBe(7);
    ctx.clock.set(T0);
  });

  test('a reason is needed only when the count differs; "other" needs a note; a matching count with a reason is refused', async () => {
    const p = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 4));
    expect((await one(shop.owner, count(p, p.sizes['40'], 3, 4))).error.fields).toEqual({ reason: 'Choose a reason for the difference.' });
    expect((await one(shop.owner, count(p, p.sizes['40'], 3, 4, { reason: 'other' }))).error.fields).toEqual({ note: 'Write what happened.' });
    expect((await one(shop.owner, count(p, p.sizes['40'], 4, 4, { reason: 'damaged' }))).error.fields).toEqual({ reason: 'No reason is needed when the count matches.' });
    const ok = await one(shop.manager, count(p, p.sizes['40'], 4, 4, { recordedAt: at(1) }));
    expect(ok.result).toMatchObject({ expectedUnits: 4, differenceUnits: 0, stockOnHandUnits: 4 });
    const other = await one(shop.manager, count(p, p.sizes['40'], 6, 4, { reason: 'other', note: 'Found behind the stall', recordedAt: at(2) }));
    expect(other.result).toMatchObject({ differenceUnits: 2, stockOnHandUnits: 6 });
    expect((await one(shop.owner, count(p, p.sizes['40'], -1, 4, { reason: 'damaged' }))).error.code).toBe('INVALID_PAYLOAD');
  });
});

describe('the BE6 follow-ups', () => {
  test('a size with stock can\'t be removed (SIZE_HAS_STOCK "still has X"); at 0 it can; yards say "2.5"', async () => {
    const p = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 3));
    const refused = await one(shop.owner, op('size.upsert', { sizeId: p.sizes['40'], productId: p.productId, baseVersion: 1, fields: { isActive: false } }));
    expect(refused.error).toMatchObject({ code: 'SIZE_HAS_STOCK', message: 'This size still has 3 in stock.' });
    await one(shop.owner, move(p, p.sizes['40'], 'removal', 3, { reason: 'supplier_return' }));
    expect((await one(shop.owner, op('size.upsert', { sizeId: p.sizes['40'], productId: p.productId, baseVersion: 1, fields: { isActive: false } }))).status).toBe('saved');

    const cloth = await product({ type: 'clothing', unit: 'yard', sizes: ['Wide'] });
    await one(shop.owner, move(cloth, cloth.sizes.Wide, 'opening', 5));
    const yards = await one(shop.owner, op('size.upsert', { sizeId: cloth.sizes.Wide, productId: cloth.productId, baseVersion: 1, fields: { isActive: false } }));
    expect(yards.error.message).toBe('This size still has 2.5 in stock.');
  });

  test('switching between yards and other units is refused once there is a stock record (UNIT_LOCKED); allowed before', async () => {
    const before = await product({ type: 'fabric', unit: 'yard', sizes: [] });
    expect((await one(shop.owner, op('product.upsert', { productId: before.productId, baseVersion: 1, fields: { unit: 'piece' } }))).status).toBe('saved');

    const after = await product({ type: 'fabric', unit: 'yard', sizes: [] });
    await one(shop.owner, count(after, null, 0, 0));
    const refused = await one(shop.owner, op('product.upsert', { productId: after.productId, baseVersion: 1, fields: { unit: 'piece' } }));
    expect(refused.error.code).toBe('UNIT_LOCKED');
    const sameScale = await product({ type: 'other', unit: 'pair', sizes: [] });
    await one(shop.owner, move(sameScale, null, 'opening', 2));
    expect((await one(shop.owner, op('product.upsert', { productId: sameScale.productId, baseVersion: 1, fields: { unit: 'set' } }))).status).toBe('saved');
  });

  test('per-product low-stock level and warnings switch (Decision 2-2), set by the owner or manager and pulled by everyone', async () => {
    const p = await product();
    const res = await one(shop.manager, op('product.upsert', { productId: p.productId, baseVersion: 1, fields: { lowStockLevelUnits: 10, lowStockWarnings: false } }));
    expect(res.status).toBe('saved');
    const row = (await pull(shop.associate)).body.rows.filter((r) => r.type === 'product' && r.data.id === p.productId).at(-1);
    expect(row.data).toMatchObject({ lowStockLevelUnits: 10, lowStockWarnings: false });
  });
});

describe('what each role pulls, and the database guards', () => {
  test('owner and manager get full stock rows; an associate gets only what the stock rule needs', async () => {
    const p = await product();
    await push(shop.owner, [move(p, p.sizes['40'], 'opening', 5), move(p, p.sizes['40'], 'removal', 1, { reason: 'other', note: 'Secret note' })]);
    await one(shop.owner, count(p, p.sizes['40'], 3, 4, { reason: 'damaged', recordedAt: at(5) }));

    const of = async (who) => (await pull(who)).body.rows.filter((r) => (r.type === 'stockMovement' || r.type === 'stockCount') && r.data.productId === p.productId);
    for (const who of [shop.owner, shop.manager]) {
      const rows = await of(who);
      expect(rows.find((r) => r.type === 'stockMovement' && r.data.quantityUnits === -1).data).toMatchObject({ type: 'removal', reason: 'other', note: 'Secret note', flags: expect.any(Object), recordedBy: shop.owner.userId });
      expect(rows.find((r) => r.type === 'stockCount').data).toMatchObject({ countedUnits: 3, baselineUnits: 4, reason: 'damaged' });
    }
    const associateRows = await of(shop.associate);
    expect(associateRows).toHaveLength(3);
    for (const r of associateRows) {
      const allowed = r.type === 'stockMovement'
        ? ['id', 'locationId', 'productId', 'sizeId', 'quantityUnits', 'recordedAt', 'receivedAt']
        : ['id', 'locationId', 'productId', 'sizeId', 'countedUnits', 'recordedAt', 'receivedAt'];
      expect(Object.keys(r.data).sort()).toEqual(allowed.sort());
    }
    expect(JSON.stringify(associateRows)).not.toContain('Secret note');
    // The associate can still work out stock with the rule from what they received.
    const asRows = {
      movements: associateRows.filter((r) => r.type === 'stockMovement').map((r) => r.data),
      counts: associateRows.filter((r) => r.type === 'stockCount').map((r) => r.data),
    };
    expect(rule.stockOnHand(asRows)).toBe(3);
  });

  test('stock records are permanent: scoped().update refuses them; MySQL refuses a wrong sign, a removal without a reason and another product\'s size', async () => {
    const p = await product();
    const other = await product();
    await one(shop.owner, move(p, p.sizes['40'], 'opening', 1));
    expect(() => s().StockMovement.update({ quantityUnits: 5 }, { where: { productId: p.productId } })).toThrow(/permanent/);
    expect(() => s().StockCount.update({ countedUnits: 5 }, { where: { productId: p.productId } })).toThrow(/permanent/);
    const base = {
      businessId: shop.businessId, locationId: shop.locationId, productId: p.productId, sizeId: p.sizes['40'], flags: {},
      recordedBy: shop.owner.userId, recordedAt: new Date(), receivedAt: new Date(),
    };
    const { StockMovement } = db.getModels();
    await expect(StockMovement.create({ ...base, id: randomUUID(), type: 'opening', quantityUnits: -1 })).rejects.toThrow();
    await expect(StockMovement.create({ ...base, id: randomUUID(), type: 'removal', quantityUnits: -1 })).rejects.toThrow();
    await expect(StockMovement.create({ ...base, id: randomUUID(), type: 'opening', quantityUnits: 1, sizeId: other.sizes['40'] })).rejects.toThrow();
  });

  test('check:stock, check:sequences and check:operations find nothing wrong', async () => {
    const sequelize = db.getSequelize();
    expect(await checkStock(sequelize)).toEqual([]);
    expect(await checkSequences(sequelize)).toEqual([]);
    expect(await checkOperations(sequelize)).toEqual([]);
  });
});
