// BE6: products, sizes and prices (Epic 1) through real pushes and pulls on
// the test database: who may do what, the field rules, units, warnings
// (duplicate names are WARNINGS, never rejections), versions with their
// PriceVersion rows, ChangeLog history, and cost never reaching anyone but
// the owner (pull rows, push results, warnings and history).

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { scoped } = require('../../src/services/scoped');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });

let ctx;
let shop; // an owner, a manager and an associate of one business, each with a phone
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp();
  shop = await team();
}, 120000);
afterAll(() => db.closeDatabase());

// An owner with a registered phone, plus a manager and an associate.
async function team() {
  const { agent, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  const owner = { phone: agent, businessId, userId: res.body.user.id, deviceId: device.deviceId };
  return { owner, manager: await staff(owner, 'manager'), associate: await staff(owner, 'associate'), businessId };
}

// A staff member of `o` with their own phone, ready to sync.
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
const pull = (who, since = 0, limit = 500) => who.phone.get(`/api/sync/pull?since=${since}&limit=${limit}`).set(biz(who.businessId));
const op = (type, payload, opId = randomUUID()) => ({ opId, type, recordedOnline: true, payload });
const newProduct = (fields, productId = randomUUID()) => op('product.upsert', { productId, baseVersion: null, fields });
const editProduct = (productId, baseVersion, fields) => op('product.upsert', { productId, baseVersion, fields });
const newSize = (productId, fields, sizeId = randomUUID()) => op('size.upsert', { sizeId, productId, baseVersion: null, fields });
const editSize = (sizeId, productId, baseVersion, fields) => op('size.upsert', { sizeId, productId, baseVersion, fields });
const sandal = (extra = {}) => ({ name: `Sandal ${randomUUID().slice(0, 6)}`, type: 'shoes', unit: 'pair', retailMinor: 12000, wholesaleMinor: 10000, costMinor: 8000, ...extra });
const one = async (who, operation) => (await push(who, [operation])).body.results[0];
const models = () => db.getModels();
const s = () => scoped({ business: { id: shop.businessId } }, models());

// Every pulled row of `who`, all pages.
async function allRows(who) {
  const rows = [];
  let cursor = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const page = await pull(who, cursor);
    rows.push(...page.body.rows);
    cursor = page.body.nextCursor;
    if (!page.body.hasMore) break;
  }
  return rows;
}

// Every value anywhere inside `body` (to prove a cost appears under no field name).
function allValues(body) {
  if (Array.isArray(body)) return body.flatMap(allValues);
  if (body && typeof body === 'object') return Object.values(body).flatMap(allValues);
  return [body];
}

describe('adding products', () => {
  test('the owner adds a product: saved as version 1 with its PriceVersion row and history, and everyone pulls it', async () => {
    const add = newProduct(sandal({ name: '  Black   sandal ' }));
    const res = await one(shop.owner, add);
    expect(res).toMatchObject({ status: 'saved', result: { productId: add.payload.productId, version: 1, warnings: [] } });

    const row = await s().Product.findOne({ where: { id: add.payload.productId } });
    expect(row).toMatchObject({ name: 'Black sandal', nameNormalized: 'black sandal', unitScale: 1, version: 1, createdBy: shop.owner.userId });
    const prices = await s().PriceVersion.findAll({ where: { productId: add.payload.productId } });
    expect(prices.map((p) => [p.sizeId, p.version, Number(p.retailMinor), Number(p.wholesaleMinor), Number(p.costMinor), p.createdByOpId]))
      .toEqual([[null, 1, 12000, 10000, 8000, add.opId]]);
    expect(await s().ChangeLog.count({ where: { entity: 'product', entityId: add.payload.productId } })).toBe(1);

    for (const who of [shop.owner, shop.manager, shop.associate]) {
      const found = (await allRows(who)).find((r) => r.type === 'product' && r.data.id === add.payload.productId);
      expect(found.data).toMatchObject({ name: 'Black sandal', retailMinor: 12000, wholesaleMinor: 10000, version: 1 });
    }
  });

  test('the owner must give a cost price; a manager adds without one (the "Cost price needed" list)', async () => {
    const { costMinor, ...noCost } = sandal(); // eslint-disable-line no-unused-vars
    const byOwner = await one(shop.owner, newProduct(noCost));
    expect(byOwner).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED', fields: { costMinor: 'Enter the cost price.' } } });

    const add = newProduct(noCost);
    expect((await one(shop.manager, add)).status).toBe('saved');
    expect((await s().Product.findOne({ where: { id: add.payload.productId } })).costMinor).toBeNull();
  });

  test('a manager sending a cost price is refused FORBIDDEN; an associate can\'t add or edit products at all', async () => {
    const byManager = await one(shop.manager, newProduct(sandal()));
    expect(byManager).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN', fields: { costMinor: 'Only the owner can set cost prices.' } } });
    const { costMinor, ...noCost } = sandal();
    expect(costMinor).toBe(8000);
    expect((await one(shop.associate, newProduct(noCost))).error.code).toBe('FORBIDDEN');
  });

  test('field rules: name required and at most 80 characters, prices whole and above zero, at most 1,000,000 in the currency', async () => {
    const invalid = async (fields) => (await one(shop.owner, newProduct(fields))).error;
    expect(await invalid(sandal({ name: '   ' }))).toMatchObject({ code: 'INVALID_PAYLOAD', fields: { 'fields.name': 'Enter a product name.' } });
    expect((await invalid(sandal({ name: 'x'.repeat(81) }))).fields['fields.name']).toBe('Use a shorter name (up to 80 characters).');
    expect((await invalid(sandal({ retailMinor: 0 }))).code).toBe('INVALID_PAYLOAD');
    expect((await invalid(sandal({ retailMinor: 12.5 }))).code).toBe('INVALID_PAYLOAD');
    expect((await invalid(sandal({ extra: 1 }))).code).toBe('INVALID_PAYLOAD');
    expect(await invalid(sandal({ retailMinor: 100_000_001 }))).toMatchObject({ code: 'VALIDATION_FAILED', fields: { retailMinor: expect.any(String) } });
    expect((await one(shop.owner, newProduct(sandal({ retailMinor: 100_000_000, costMinor: 1 })))).status).toBe('saved'); // GH₵ 1,000,000.00
  });

  test('units: fabric by the piece or the yard only; yards get unitScale 2; the shop\'s own unit needs its name', async () => {
    const fabric = (unit) => sandal({ type: 'fabric', unit, name: `Kente ${randomUUID().slice(0, 6)}` });
    expect(await one(shop.owner, newProduct(fabric('pair')))).toMatchObject({ error: { code: 'VALIDATION_FAILED', fields: { unit: 'Fabric is sold by the piece or by the yard.' } } });
    const yard = newProduct(fabric('yard'));
    await one(shop.owner, yard);
    expect((await s().Product.findOne({ where: { id: yard.payload.productId } })).unitScale).toBe(2);

    expect((await one(shop.owner, newProduct(sandal({ type: 'other', unit: 'custom' })))).error.fields).toEqual({ unitLabel: "Enter the unit's name." });
    const bag = newProduct(sandal({ type: 'other', unit: 'custom', unitLabel: 'bag' }));
    await one(shop.owner, bag);
    expect((await one(shop.owner, editProduct(bag.payload.productId, 1, { unit: 'piece' }))).status).toBe('saved');
    expect(await s().Product.findOne({ where: { id: bag.payload.productId } })).toMatchObject({ unit: 'piece', unitLabel: null, unitScale: 1 });
  });
});

describe('warnings, never errors', () => {
  test('wholesale above retail is a warning; below cost is a warning for the owner only', async () => {
    const res = await one(shop.owner, newProduct(sandal({ retailMinor: 7000, wholesaleMinor: 9000, costMinor: 8000 })));
    expect(res.status).toBe('saved');
    expect(res.result.warnings).toEqual([{ code: 'WHOLESALE_ABOVE_RETAIL' }, { code: 'BELOW_COST' }]);
  });

  test("a manager pricing below the owner's cost is saved WITHOUT a below-cost warning, and the cost is kept", async () => {
    const add = newProduct(sandal({ costMinor: 8000 }));
    await one(shop.owner, add);
    const edit = editProduct(add.payload.productId, 1, { retailMinor: 5000, wholesaleMinor: 4000 });
    const res = await one(shop.manager, edit);
    expect(res).toMatchObject({ status: 'saved', result: { version: 2, warnings: [] } });
    const v2 = await s().PriceVersion.findOne({ where: { productId: add.payload.productId, version: 2 } });
    expect([Number(v2.retailMinor), Number(v2.costMinor)]).toEqual([5000, 8000]);
  });

  test('two phones add the same name offline: BOTH saved, the later one warned with the other\'s id, each ready for sales', async () => {
    const first = newProduct(sandal({ name: 'Brown slipper' }));
    const second = newProduct(sandal({ name: '  brown   SLIPPER' }));
    delete second.payload.fields.costMinor; // the manager adds it without cost
    const a = await one(shop.owner, first);
    const b = await one(shop.manager, second);
    expect(a).toMatchObject({ status: 'saved', result: { warnings: [] } });
    expect(b).toMatchObject({ status: 'saved', result: { warnings: [{ code: 'PRODUCT_NAME_DUPLICATE', productId: first.payload.productId }] } });

    // Arriving the other way round, the warning goes to the other one.
    const third = newProduct(sandal({ name: 'Red slipper' }));
    const fourth = newProduct(sandal({ name: 'red slipper' }));
    expect((await one(shop.owner, fourth)).result.warnings).toEqual([]);
    expect((await one(shop.owner, third)).result.warnings).toEqual([{ code: 'PRODUCT_NAME_DUPLICATE', productId: fourth.payload.productId }]);

    // Each has its own id and its version-1 price row: what a sale (BE8) checks against.
    for (const p of [first, second]) {
      expect(await s().PriceVersion.count({ where: { productId: p.payload.productId, version: 1 } })).toBe(1);
    }
    expect(await s().Product.count({ where: { nameNormalized: 'brown slipper' } })).toBe(2);
  });

  test('renaming to an existing name warns too; an edit that leaves the name alone doesn\'t', async () => {
    const a = newProduct(sandal({ name: 'Blue heel' }));
    const b = newProduct(sandal({ name: 'Green heel' }));
    await push(shop.owner, [a, b]);
    expect((await one(shop.owner, editProduct(b.payload.productId, 1, { name: 'BLUE heel' }))).result.warnings)
      .toEqual([{ code: 'PRODUCT_NAME_DUPLICATE', productId: a.payload.productId }]);
    expect((await one(shop.owner, editProduct(b.payload.productId, 2, { retailMinor: 13000 }))).result.warnings).toEqual([]);
  });
});

describe('editing, versions and history', () => {
  test('each accepted edit: version + 1, its own PriceVersion row, a ChangeLog row; an older baseVersion still wins and is marked conflict', async () => {
    const add = newProduct(sandal());
    const id = add.payload.productId;
    await one(shop.owner, add);
    expect((await one(shop.owner, editProduct(id, 1, { retailMinor: 13000 }))).result.version).toBe(2);
    expect((await one(shop.manager, editProduct(id, 1, { retailMinor: 14000 }))).result.version).toBe(3); // edited version 1 too

    expect(Number((await s().Product.findOne({ where: { id } })).retailMinor)).toBe(14000);
    const versions = await s().PriceVersion.findAll({ where: { productId: id }, order: [['version', 'ASC']] });
    expect(versions.map((v) => [v.version, Number(v.retailMinor)])).toEqual([[1, 12000], [2, 13000], [3, 14000]]);
    const history = await s().ChangeLog.findAll({ where: { entity: 'product', entityId: id } });
    expect(history.map((h) => h.conflict).sort()).toEqual([false, false, true]);
  });

  test('the stored result keeps the new version, so a later sale can name the edit by its opId', async () => {
    const add = newProduct(sandal());
    await one(shop.owner, add);
    const edit = editProduct(add.payload.productId, 1, { retailMinor: 15000 });
    await one(shop.owner, edit);
    const stored = await models().ProcessedOperation.findOne({ where: { businessId: shop.businessId, opId: edit.opId } });
    expect(stored.resultJson.result).toMatchObject({ productId: add.payload.productId, version: 2 });
    expect((await s().PriceVersion.findOne({ where: { createdByOpId: edit.opId } })).version).toBe(2);
  });

  test('an edit of an unknown product is NOT_FOUND; a "new" product with an existing id is refused', async () => {
    expect((await one(shop.owner, editProduct(randomUUID(), 1, { retailMinor: 100 }))).error.code).toBe('NOT_FOUND');
    const add = newProduct(sandal());
    await one(shop.owner, add);
    const again = await one(shop.owner, newProduct(sandal(), add.payload.productId));
    expect(again.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { baseVersion: 'Send the version you edited.' } });
  });

  test('hiding and un-hiding: the product stays (nothing is deleted), with history', async () => {
    const add = newProduct(sandal());
    const id = add.payload.productId;
    await one(shop.owner, add);
    await one(shop.manager, editProduct(id, 1, { isHidden: true }));
    expect((await s().Product.findOne({ where: { id } })).isHidden).toBe(true);
    expect((await allRows(shop.associate)).filter((r) => r.data.id === id).at(-1).data.isHidden).toBe(true);
    await one(shop.owner, editProduct(id, 2, { isHidden: false }));
    expect((await s().Product.findOne({ where: { id } })).isHidden).toBe(false);
  });
});

describe('sizes', () => {
  test('sizes are added with their order and own prices; their versions have their own PriceVersion rows', async () => {
    const add = newProduct(sandal());
    const productId = add.payload.productId;
    const sizes = ['40', '41', '42'].map((label, i) => newSize(productId, { label, sortOrder: i, ...(label === '42' ? { retailMinor: 14000 } : {}) }));
    const res = await push(shop.owner, [add, ...sizes]);
    expect(res.body.results.map((r) => r.status)).toEqual(['saved', 'saved', 'saved', 'saved']);

    const big = sizes[2].payload.sizeId;
    const priceRow = await s().PriceVersion.findOne({ where: { sizeId: big } });
    expect([priceRow.version, Number(priceRow.retailMinor), priceRow.wholesaleMinor]).toEqual([1, 14000, null]);
    expect((await one(shop.owner, editSize(big, productId, 1, { retailMinor: 15000 }))).result.version).toBe(2);
    expect(await s().PriceVersion.count({ where: { sizeId: big } })).toBe(2);

    const pulled = (await allRows(shop.associate)).filter((r) => r.type === 'size' && r.data.productId === productId);
    // Each size once, at its latest version (the edit gave 42 a new sequence number).
    expect(pulled.map((r) => [r.data.label, r.data.retailMinor, r.data.version])).toEqual([['40', null, 1], ['41', null, 1], ['42', 15000, 2]]);
  });

  test('fabric has no sizes; a product with sizes can\'t become fabric', async () => {
    const fabric = newProduct(sandal({ type: 'fabric', unit: 'yard' }));
    await one(shop.owner, fabric);
    expect((await one(shop.owner, newSize(fabric.payload.productId, { label: 'S', sortOrder: 0 }))).error.code).toBe('SIZES_NOT_ALLOWED');

    const shirt = newProduct(sandal({ type: 'clothing', unit: 'piece' }));
    await push(shop.owner, [shirt, newSize(shirt.payload.productId, { label: 'M', sortOrder: 0 })]);
    expect((await one(shop.owner, editProduct(shirt.payload.productId, 1, { type: 'fabric' }))).error.code).toBe('SIZES_NOT_ALLOWED');
  });

  test('a removed size is kept, inactive; a duplicate label is a warning; at most 60 sizes', async () => {
    const add = newProduct(sandal());
    const productId = add.payload.productId;
    const m = newSize(productId, { label: 'M', sortOrder: 0 });
    await push(shop.owner, [add, m]);
    expect((await one(shop.owner, newSize(productId, { label: ' m ', sortOrder: 1 }))).result.warnings)
      .toEqual([{ code: 'SIZE_LABEL_DUPLICATE', sizeId: m.payload.sizeId }]);
    expect((await one(shop.owner, editSize(m.payload.sizeId, productId, 1, { isActive: false }))).status).toBe('saved');
    expect((await s().ProductSize.findOne({ where: { id: m.payload.sizeId } })).isActive).toBe(false);

    const more = Array.from({ length: 58 }, (_, i) => newSize(productId, { label: `L${i}`, sortOrder: i + 2 }));
    expect((await push(shop.owner, more)).body.results.every((r) => r.status === 'saved')).toBe(true);
    expect((await one(shop.owner, newSize(productId, { label: 'too many', sortOrder: 99 }))).error.fields.label).toBe('A product can have at most 60 sizes.');
  });

  test("a size's warnings use the prices it really sells at; a size of an unknown product is NOT_FOUND; a size can't move to another product", async () => {
    const add = newProduct(sandal({ costMinor: 8000, wholesaleMinor: 6000 }));
    const productId = add.payload.productId;
    const xl = newSize(productId, { label: 'XL', sortOrder: 0, retailMinor: 7000 });
    const res = await push(shop.owner, [add, xl]);
    expect(res.body.results[1].result.warnings).toEqual([{ code: 'BELOW_COST' }]);
    expect((await one(shop.manager, editSize(xl.payload.sizeId, productId, 1, { retailMinor: 6000 }))).result.warnings).toEqual([]);
    expect((await one(shop.owner, newSize(randomUUID(), { label: 'S', sortOrder: 0 }))).error.code).toBe('NOT_FOUND');

    const other = newProduct(sandal());
    await one(shop.owner, other);
    expect((await one(shop.owner, editSize(xl.payload.sizeId, other.payload.productId, 2, { label: 'XXL' }))).error.fields)
      .toEqual({ productId: 'This size belongs to another product.' });
  });
});

describe('cost prices never reach anyone but the owner', () => {
  test('pull rows: the owner\'s products and sizes have costMinor; a manager\'s and an associate\'s have NO cost field at all', async () => {
    const add = newProduct(sandal({ costMinor: 7777 }));
    await push(shop.owner, [add, newSize(add.payload.productId, { label: '39', sortOrder: 0, costMinor: 7788 })]);

    const ownerRows = (await allRows(shop.owner)).filter((r) => r.data.id === add.payload.productId || r.data.productId === add.payload.productId);
    expect(ownerRows.map((r) => r.data.costMinor)).toEqual([7777, 7788]);
    for (const who of [shop.manager, shop.associate]) {
      const rows = (await allRows(who)).filter((r) => r.type === 'product' || r.type === 'size');
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(Object.keys(r.data)).not.toContain('costMinor');
      expect(JSON.stringify(rows)).not.toMatch(/cost/i);
      expect(allValues(rows)).not.toContain(7777);
      expect(allValues(rows)).not.toContain(7788);
    }
  });

  test("a manager's push results and the history they can read contain no cost", async () => {
    const add = newProduct(sandal({ costMinor: 6543 }));
    await one(shop.owner, add);
    const id = add.payload.productId;
    await one(shop.owner, editProduct(id, 1, { costMinor: 6600 })); // a cost-only change
    const managerEdit = await push(shop.manager, [editProduct(id, 2, { retailMinor: 6000 })]);
    expect(JSON.stringify(managerEdit.body)).not.toMatch(/cost/i);
    expect(allValues(managerEdit.body)).not.toContain(6543);

    const managerHistory = await shop.manager.phone.get(`/api/products/${id}/history`).set(biz(shop.businessId));
    expect(managerHistory.status).toBe(200);
    expect(JSON.stringify(managerHistory.body)).not.toMatch(/cost/i);
    for (const cost of [6543, 6600]) expect(allValues(managerHistory.body)).not.toContain(cost);
    expect(managerHistory.body.changes).toHaveLength(2); // added, and the manager's price change; the cost-only change is left out

    const ownerHistory = await shop.owner.phone.get(`/api/products/${id}/history`).set(biz(shop.businessId));
    expect(ownerHistory.body.changes).toHaveLength(3);
    expect(ownerHistory.body.changes[1]).toMatchObject({
      entity: 'product', entityId: id, before: { costMinor: 6543, version: 1 }, after: { costMinor: 6600, version: 2 }, conflict: false,
      changedBy: { userId: shop.owner.userId, name: expect.any(String) },
    });
  });

  test('history: associates get FORBIDDEN; an unknown product is 404; it includes the sizes\' changes', async () => {
    const add = newProduct(sandal());
    const id = add.payload.productId;
    await push(shop.owner, [add, newSize(id, { label: '38', sortOrder: 0 })]);
    expect((await shop.associate.phone.get(`/api/products/${id}/history`).set(biz(shop.businessId))).body.error.code).toBe('FORBIDDEN');
    expect((await shop.owner.phone.get(`/api/products/${randomUUID()}/history`).set(biz(shop.businessId))).status).toBe(404);
    expect((await shop.owner.phone.get('/api/products/not-an-id/history').set(biz(shop.businessId))).status).toBe(404);
    const res = await shop.owner.phone.get(`/api/products/${id}/history`).set(biz(shop.businessId));
    expect(res.body.changes.map((c) => c.entity)).toEqual(['product', 'size']);
  });
});

describe('the database guards', () => {
  test('PriceVersion is permanent: scoped().update refuses it, and the same version twice is refused by MySQL', async () => {
    const add = newProduct(sandal());
    await one(shop.owner, add);
    expect(() => s().PriceVersion.update({ retailMinor: 1 }, { where: { productId: add.payload.productId } })).toThrow(/permanent/);
    await expect(models().PriceVersion.create({
      id: randomUUID(), businessId: shop.businessId, productId: add.payload.productId, sizeId: null, version: 1,
      retailMinor: 1, createdByOpId: randomUUID(), createdAt: new Date(),
    })).rejects.toThrow();
  });

  test('CHECK constraints refuse a zero price and a wrong unitScale straight in MySQL', async () => {
    const base = {
      businessId: shop.businessId, name: 'Raw', nameNormalized: 'raw', type: 'other', unit: 'piece', unitScale: 1,
      retailMinor: 100, createdBy: shop.owner.userId,
    };
    await expect(models().Product.create({ ...base, id: randomUUID(), retailMinor: 0 })).rejects.toThrow();
    await expect(models().Product.create({ ...base, id: randomUUID(), unit: 'yard', unitScale: 1 })).rejects.toThrow();
    await expect(models().Product.create({ ...base, id: randomUUID(), type: 'fabric', unit: 'pair' })).rejects.toThrow();
  });

  test('check:sequences and check:operations find nothing wrong', async () => {
    expect(await checkSequences(db.getSequelize())).toEqual([]);
    expect(await checkOperations(db.getSequelize())).toEqual([]);
  });
});

describe('ready-made size ranges', () => {
  test('GET /api/reference lists them as data, in natural order', async () => {
    const res = await shop.owner.phone.get('/api/reference');
    const shoes = res.body.sizeRanges.find((r) => r.code === 'shoes_eu');
    expect(shoes.sizes.slice(0, 3)).toEqual(['30', '31', '32']);
    expect(res.body.sizeRanges.find((r) => r.code === 'clothing_letters').sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
  });
});
