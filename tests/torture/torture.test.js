// The server sync torture test (BE5.5): several phones against a real local
// server, running the failure-recovery cases that are possible before sales
// exist (BE8, BE9 and BE10 add theirs). `npm run test:sync` runs this file
// three times in a row; every case must pass every time.
//
// Each test explains the real-world situation it stands for. docs/guide.md
// ("BE5.5: the sync torture test") explains them all in plain words.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { operations: realOperations } = require('../../src/sync/operations');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { checkStock } = require('../../src/checks/stockChecks');
const { checkReceipts, checkBalances } = require('../../src/checks/moneyChecks');
const { resetDatabase, signupBody } = require('../helpers/dbApp');
const { TERMS_VERSION } = require('../../src/legal');
const { startServer, Phone, op, faults } = require('./harness');

jest.setTimeout(180000);

let server;
let owner; // the owner's phone
let business; // the owner's business ID

beforeAll(async () => {
  await resetDatabase();
  server = await startServer();
  owner = new Phone(server);
  business = await owner.signUp(signupBody({ businessName: 'Torture Shop' }));
  await owner.register(business);
});
afterAll(async () => {
  await server.close();
  await db.closeDatabase();
});

const models = () => db.getModels();
const addLocation = (name = `Loc ${randomUUID().slice(0, 8)}`, opId) => op('test.addLocation', { name }, opId);
const statuses = (res) => res.body.results.map((r) => r.status);
const processed = (opId) => models().ProcessedOperation.findOne({ where: { businessId: business, opId } });
const locationCount = () => models().Location.count({ where: { businessId: business } });

// A staff member with their own phone in `businessId` (added by its owner phone).
async function staffPhone(ownerPhone, businessId, role, extra = {}) {
  const number = signupBody().phone;
  const added = await ownerPhone.send({ method: 'POST', path: '/api/team', business: businessId, body: { name: `A ${role}`, phone: number, role } });
  const phone = new Phone(server, extra);
  await phone.signIn(number, added.body.temporaryPassword);
  await phone.send({ method: 'POST', path: '/api/auth/change-password', body: { currentPassword: added.body.temporaryPassword, newPassword: `${role}-pass-2026` } });
  phone.password = `${role}-pass-2026`;
  await phone.send({ method: 'POST', path: '/api/auth/accept-terms', body: { version: TERMS_VERSION } });
  await phone.register(businessId);
  return { phone, membershipId: added.body.member.membershipId };
}

describe('test-only operations exist only in the test harness', () => {
  test('the real registry has no test.* types, and the source never names them', () => {
    expect(Object.keys(realOperations).filter((t) => t.startsWith('test.'))).toEqual([]);
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name))));
    walk(path.join(__dirname, '../../src'));
    const named = files.filter((f) => /test\.(addLocation|failAt|deadlockOnce|saleDeadlockOnce)/.test(fs.readFileSync(f, 'utf8')));
    expect(named).toEqual([]);
  });

  test('a server started like production answers UNKNOWN_OPERATION for them, whatever the request says', async () => {
    const plain = await startServer({ withTestOperations: false });
    try {
      const phone = new Phone(plain);
      const id = await phone.signUp(signupBody());
      await phone.register(id);
      const res = await phone.send({
        method: 'POST', path: '/api/sync/push?testOperations=1', business: id,
        body: { deviceId: phone.devices.get(id).deviceId, operations: ['test.addLocation', 'test.failAt', 'test.deadlockOnce'].map((t) => op(t, { name: 'x' })) },
      });
      expect(res.status).toBe(200);
      expect(res.body.results.map((r) => r.error.code)).toEqual(['UNKNOWN_OPERATION', 'UNKNOWN_OPERATION', 'UNKNOWN_OPERATION']);
    } finally {
      await plain.close();
    }
  });
});

describe('repeats and lost answers', () => {
  test('the same push twice, and the same push while the first is still running: saved once', async () => {
    const before = await locationCount();
    const ops = [addLocation(), addLocation()];
    const [a, b] = await Promise.all([owner.push(business, ops), owner.push(business, ops)]);
    expect([...statuses(a), ...statuses(b)].sort()).toEqual(['duplicate', 'duplicate', 'saved', 'saved']);
    expect(statuses(await owner.push(business, ops))).toEqual(['duplicate', 'duplicate']);
    expect(await locationCount()).toBe(before + 2);
  });

  test('the server saves but the answer is lost: the re-signed retry gets "duplicate"; replaying the exact signed request gets NONCE_REUSED', async () => {
    const before = await locationCount();
    const ops = [addLocation()];
    const lost = await owner.push(business, ops, { loseResponse: true });
    expect(lost.lost).toBe(true);
    await new Promise((r) => setTimeout(r, 300)); // the server finishes its work

    const retry = await owner.push(business, ops); // a new request: new nonce, new signature
    expect(retry.status).toBe(200);
    expect(statuses(retry)).toEqual(['duplicate']);

    const replay = await owner.replay(lost, { method: 'POST', path: '/api/sync/push' }); // the very same bytes and headers
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('NONCE_REUSED');
    expect(await locationCount()).toBe(before + 1);
  });

  test('two copies of one operation at the same moment: exactly one effect', async () => {
    const before = await locationCount();
    const one = addLocation();
    const results = await Promise.all(Array.from({ length: 4 }, () => owner.push(business, [one])));
    expect(results.flatMap(statuses).sort()).toEqual(['duplicate', 'duplicate', 'duplicate', 'saved']);
    expect(await locationCount()).toBe(before + 1);
  });
});

describe('batches', () => {
  test('a batch of 10 where operation 3 is invalid: 9 saved, 1 rejected', async () => {
    const ops = Array.from({ length: 10 }, () => addLocation());
    ops[2] = op('test.addLocation', { name: '' });
    const res = await owner.push(business, ops);
    expect(statuses(res)).toEqual(['saved', 'saved', 'rejected', 'saved', 'saved', 'saved', 'saved', 'saved', 'saved', 'saved']);
    expect(res.body.results[2].error.code).toBe('INVALID_PAYLOAD');
    expect(await processed(ops[2].opId)).toBeNull(); // not reserved: a corrected one may reuse the opId
  });

  test('the database "stops" at operation 5 of 10: 1–4 stay saved, 5 leaves nothing, the retry saves 5–10 once', async () => {
    const before = await locationCount();
    const ops = Array.from({ length: 10 }, (_, i) => (i === 4 ? op('test.failAt', { name: 'Fails once' }) : addLocation()));
    faults.failRemaining = 1;
    const first = await owner.push(business, ops);
    expect(first.status).toBeGreaterThanOrEqual(500); // temporary: the phone keeps the outbox and retries
    for (const o of ops.slice(0, 4)) expect(await processed(o.opId)).toMatchObject({ status: 'saved' });
    for (const o of ops.slice(4)) expect(await processed(o.opId)).toBeNull();
    expect(await models().Location.count({ where: { businessId: business, name: 'Fails once' } })).toBe(0);
    expect(await locationCount()).toBe(before + 4);

    const retry = await owner.push(business, ops);
    expect(statuses(retry)).toEqual([...Array(4).fill('duplicate'), ...Array(6).fill('saved')]);
    expect(await locationCount()).toBe(before + 10);
  });

  test('the same opId with a changed payload or a changed type: OP_ID_CONFLICT, nothing applied', async () => {
    const original = addLocation('Original');
    await owner.push(business, [original]);
    const before = await locationCount();

    const fresh = addLocation(); // in the same batch: still saved
    const changedPayload = await owner.push(business, [{ ...original, payload: { name: 'Changed' } }, fresh]);
    const changedType = await owner.push(business, [{ ...original, type: 'test.deadlockOnce' }]);
    expect(changedPayload.status).toBe(200);
    expect(changedPayload.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'OP_ID_CONFLICT' } });
    expect(changedPayload.body.results[1].status).toBe('saved');
    expect(changedType.body.results[0].error.code).toBe('OP_ID_CONFLICT');
    expect(await locationCount()).toBe(before + 1); // only `fresh`
    expect(await models().Location.count({ where: { businessId: business, name: 'Changed' } })).toBe(0);
  });

  test('the same opId sent by another of the owner\'s phones is a conflict too', async () => {
    const original = addLocation('From phone one');
    await owner.push(business, [original]);
    const ownerRow = await models().Membership.findOne({ where: { businessId: business, role: 'owner' }, include: [{ model: models().User, as: 'user' }] });
    const phoneTwo = new Phone(server);
    await phoneTwo.signIn(ownerRow.user.phone, owner.password);
    await phoneTwo.register(business);
    const before = await locationCount();
    const res = await phoneTwo.push(business, [original]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'OP_ID_CONFLICT' } });
    expect(await locationCount()).toBe(before);
  });

  test('a deadlock during an operation is retried: one ProcessedOperation row, one effect', async () => {
    const before = await locationCount();
    faults.deadlocksRemaining = 1;
    const one = op('test.deadlockOnce', { name: 'After a deadlock' });
    expect(statuses(await owner.push(business, [one]))).toEqual(['saved']);
    expect(faults.deadlocksRemaining).toBe(0);
    expect(await models().ProcessedOperation.count({ where: { businessId: business, opId: one.opId } })).toBe(1);
    expect(await locationCount()).toBe(before + 1);
  });

  test('a phone whose clock is 10 minutes off is told so, corrects itself from X-Server-Time, and its retry is saved once', async () => {
    const { phone } = await staffPhone(owner, business, 'manager', { clockSkewMs: -10 * 60 * 1000 });
    phone.offset = 0; // as after a restart: the phone forgot the server's time
    const one = addLocation('From a wrong clock');
    const refused = await phone.push(business, [one]);
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe('CLOCK_OUT_OF_RANGE');
    expect(Math.abs(phone.offset - 10 * 60 * 1000)).toBeLessThan(60 * 1000); // learned from X-Server-Time

    const retry = await phone.push(business, [one]);
    expect(statuses(retry)).toEqual(['saved']);
    expect(statuses(await phone.push(business, [one]))).toEqual(['duplicate']);
    expect(await models().ProcessedOperation.count({ where: { businessId: business, opId: one.opId } })).toBe(1);
  });
});

describe('many phones at once', () => {
  test('five phones push 50 operations at the same moment: every one saved once, sequence numbers unique', async () => {
    const phones = [owner];
    for (const role of ['manager', 'associate', 'associate', 'manager']) phones.push((await staffPhone(owner, business, role)).phone);
    const before = await locationCount();
    const batches = phones.map(() => Array.from({ length: 10 }, () => addLocation()));
    const results = await Promise.all(phones.map((p, i) => p.push(business, batches[i])));
    expect(results.flatMap(statuses)).toEqual(Array(50).fill('saved'));
    expect(await locationCount()).toBe(before + 50);

    const seqs = (await models().Location.findAll({ where: { businessId: business }, attributes: ['serverSeq'] })).map((l) => Number(l.serverSeq));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(await checkSequences(db.getSequelize())).toEqual([]);
  });

  test('two phones edit the same product at the same moment: both in ChangeLog, versions up by one each, a PriceVersion row each, the last received wins', async () => {
    const productId = randomUUID();
    await owner.push(business, [op('product.upsert', { productId, baseVersion: null, fields: { name: 'Contested sandal', type: 'shoes', unit: 'pair', retailMinor: 10000, costMinor: 7000 } })]);
    const { phone: manager } = await staffPhone(owner, business, 'manager');
    const edit = (retailMinor) => op('product.upsert', { productId, baseVersion: 1, fields: { retailMinor } });
    const [a, b] = await Promise.all([owner.push(business, [edit(11000)]), manager.push(business, [edit(12000)])]);
    const versions = [a, b].map((r) => r.body.results[0].result.version).sort();
    expect(versions).toEqual([2, 3]);

    const winner = [[a, 11000], [b, 12000]].find(([r]) => r.body.results[0].result.version === 3)[1];
    const product = await models().Product.findByPk(productId);
    expect([product.version, Number(product.retailMinor)]).toEqual([3, winner]);
    const prices = await models().PriceVersion.findAll({ where: { businessId: business, productId }, order: [['version', 'ASC']] });
    expect(prices.map((p) => p.version)).toEqual([1, 2, 3]);
    expect(Number(prices[2].retailMinor)).toBe(winner);
    expect(Number(prices[2].costMinor)).toBe(7000); // the manager's edit kept the owner's cost
    const history = await models().ChangeLog.findAll({ where: { businessId: business, entity: 'product', entityId: productId } });
    expect(history).toHaveLength(3);
    expect(history.filter((h) => h.conflict)).toHaveLength(1); // the later one had edited version 1 too
  });

  test('two phones remove the last items of a size at the same moment: both saved, stock below zero, one flagged belowZeroOnArrival', async () => {
    const productId = randomUUID();
    const locationId = (await models().Location.findOne({ where: { businessId: business } })).id;
    const stockOp = (type, quantityUnits, extra = {}) => op('stock.create', {
      movementId: randomUUID(), type, locationId, productId, sizeId: null, quantityUnits, recordedAt: new Date().toISOString(), ...extra,
    });
    await owner.push(business, [
      op('product.upsert', { productId, baseVersion: null, fields: { name: 'Last pair', type: 'other', unit: 'pair', retailMinor: 5000, costMinor: 3000 } }),
      stockOp('opening', 1),
    ]);
    const { phone: manager } = await staffPhone(owner, business, 'manager');
    const [a, b] = await Promise.all([
      owner.push(business, [stockOp('removal', 1, { reason: 'damaged' })]),
      manager.push(business, [stockOp('removal', 1, { reason: 'lost' })]),
    ]);
    const results = [a, b].map((r) => r.body.results[0]);
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved']);
    expect(results.map((r) => r.result.flags.belowZeroOnArrival).sort()).toEqual([false, true]);
    expect(results.map((r) => r.result.stockOnHandUnits).sort()).toEqual([-1, 0]);
    expect(await checkStock(db.getSequelize())).toEqual([]);
  });

  test('two owner phones edit the settings offline: the last received wins, both are in the history, one marked conflict', async () => {
    const ownerRow = await models().Membership.findOne({ where: { businessId: business, role: 'owner' }, include: [{ model: models().User, as: 'user' }] });
    const other = new Phone(server);
    await other.signIn(ownerRow.user.phone, owner.password);
    await other.register(business);
    const { version } = await models().BusinessSettings.findByPk(business);

    const a = await owner.push(business, [op('settings.update', { baseVersion: version, changes: { receiptNote: 'From phone A' } })]);
    const b = await other.push(business, [op('settings.update', { baseVersion: version, changes: { receiptNote: 'From phone B' } })]);
    expect(a.body.results[0].result.version).toBe(version + 1);
    expect(b.body.results[0].result.version).toBe(version + 2);
    expect((await models().BusinessSettings.findByPk(business)).receiptNote).toBe('From phone B');
    const history = await models().ChangeLog.findAll({ where: { businessId: business, entity: 'settings' }, order: [['changedAt', 'ASC']] });
    expect(history.slice(-2).map((h) => h.conflict).sort()).toEqual([false, true]);
  });
});

describe('sales (BE8)', () => {
  let locationId;
  let counter = 0;
  // A product with `stock` pairs, made by the owner.
  async function sandal(stock) {
    locationId ??= (await models().Location.findOne({ where: { businessId: business } })).id;
    const productId = randomUUID();
    await owner.push(business, [
      op('product.upsert', { productId, baseVersion: null, fields: { name: `Torture sandal ${productId.slice(0, 6)}`, type: 'other', unit: 'pair', retailMinor: 5000, costMinor: 3000 } }),
      ...(stock ? [op('stock.create', { movementId: randomUUID(), type: 'opening', locationId, productId, sizeId: null, quantityUnits: stock, recordedAt: new Date(Date.now() - 3600000).toISOString() })] : []),
    ]);
    return productId;
  }
  // A one-line cash sale of `productId` by `phone` (its own receipt code).
  function saleOp(phone, productId, extra = {}, type = 'sale.create') {
    counter += 1;
    const code = phone.devices.get(business).deviceCode;
    return op(type, {
      saleId: randomUUID(), receiptNumber: `${code}-${String(counter).padStart(5, '0')}`, locationId, customerId: null, priceType: 'retail',
      items: [{ itemId: randomUUID(), productId, sizeId: null, quantityUnits: 1, productVersion: 1, setPriceMinor: 5000, agreedPriceMinor: 5000, lineTotalMinor: 5000 }],
      payments: [{ paymentId: randomUUID(), method: 'cash', amountMinor: 5000 }],
      subtotalMinor: 5000, paidMinor: 5000, creditMinor: 0, recordedAt: new Date().toISOString(), ...extra,
    });
  }

  test('two phones sell the last item at the same moment: both saved, stock below zero, one flagged belowZeroOnArrival', async () => {
    const productId = await sandal(1);
    const { phone: manager } = await staffPhone(owner, business, 'manager');
    const [a, b] = await Promise.all([owner.push(business, [saleOp(owner, productId)]), manager.push(business, [saleOp(manager, productId)])]);
    const results = [a, b].map((r) => r.body.results[0]);
    expect(results.map((r) => r.status)).toEqual(['saved', 'saved']);
    expect(results.map((r) => r.result.flags.belowZeroOnArrival).sort()).toEqual([false, true]);
    expect(await checkStock(db.getSequelize())).toEqual([]);
  });

  test('two sales with the same receipt number at the same moment (a forced clash): one saved, one RECEIPT_NUMBER_TAKEN', async () => {
    const productId = await sandal(5);
    const first = saleOp(owner, productId);
    const second = saleOp(owner, productId, { receiptNumber: first.payload.receiptNumber });
    const [a, b] = await Promise.all([owner.push(business, [first]), owner.push(business, [second])]);
    const outcomes = [a, b].map((r) => r.body.results[0].status === 'saved' ? 'saved' : r.body.results[0].error.code).sort();
    expect(outcomes).toEqual(['RECEIPT_NUMBER_TAKEN', 'saved']);
    expect(await models().ReceiptNumber.count({ where: { businessId: business, receiptNumber: first.payload.receiptNumber } })).toBe(1);
  });

  test('a deadlock forced during a sale is retried: the sale exists once, with one registry row and one set of movements', async () => {
    const productId = await sandal(5);
    faults.saleDeadlocksRemaining = 1;
    const sale = saleOp(owner, productId, {}, 'test.saleDeadlockOnce');
    expect((await owner.push(business, [sale])).body.results[0].status).toBe('saved');
    expect(faults.saleDeadlocksRemaining).toBe(0);
    expect(await models().Sale.count({ where: { businessId: business, id: sale.payload.saleId } })).toBe(1);
    expect(await models().ReceiptNumber.count({ where: { businessId: business, recordId: sale.payload.saleId } })).toBe(1);
    expect(await models().StockMovement.count({ where: { businessId: business, saleId: sale.payload.saleId } })).toBe(1);
  });

  test('a sale whose answer is lost: the retry gets "duplicate" and the sale exists once', async () => {
    const productId = await sandal(5);
    const sale = saleOp(owner, productId);
    expect((await owner.push(business, [sale], { loseResponse: true })).lost).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await owner.push(business, [sale])).body.results[0].status).toBe('duplicate');
    expect(await models().Sale.count({ where: { businessId: business, id: sale.payload.saleId } })).toBe(1);
  });

  test('a sale recorded before a count but arriving after it doesn\'t change stock on hand', async () => {
    const productId = await sandal(10);
    const countedAt = new Date(Date.now() - 60000).toISOString();
    const counted = await owner.push(business, [op('stockCount.create', {
      countId: randomUUID(), locationId, productId, sizeId: null, countedUnits: 9, baselineUnits: 10, baselineCursor: 0, reason: 'lost_or_stolen', recordedAt: countedAt,
    })]);
    expect(counted.body.results[0].result.stockOnHandUnits).toBe(9);
    const late = await owner.push(business, [saleOp(owner, productId, { recordedAt: new Date(Date.now() - 120000).toISOString() })]);
    expect(late.body.results[0].status).toBe('saved');
    const movements = await models().StockMovement.findAll({ where: { businessId: business, productId } });
    const counts = await models().StockCount.findAll({ where: { businessId: business, productId } });
    expect(require('../../src/services/stockRule').stockOnHand({ movements, counts })).toBe(9);
  });

  test('two price edits racing a sale on the older version: all saved; the sale keeps the price it was shown', async () => {
    const productId = await sandal(5);
    const { phone: manager } = await staffPhone(owner, business, 'manager');
    const edit = (retailMinor) => op('product.upsert', { productId, baseVersion: 1, fields: { retailMinor } });
    const sale = saleOp(owner, productId);
    const [a, b, c] = await Promise.all([owner.push(business, [edit(5500)]), manager.push(business, [edit(6000)]), owner.push(business, [sale])]);
    expect([a, b, c].map((r) => r.body.results[0].status)).toEqual(['saved', 'saved', 'saved']);
    const item = await models().SaleItem.findOne({ where: { businessId: business, saleId: sale.payload.saleId } });
    expect([item.productVersion, Number(item.setPriceMinor)]).toEqual([1, 5000]);
    const stored = await models().Sale.findByPk(sale.payload.saleId);
    expect(typeof stored.flags.olderPrice).toBe('boolean'); // true when an edit committed first
    expect(await models().PriceVersion.count({ where: { businessId: business, productId } })).toBe(3);
  });
});

describe('pulls', () => {
  test('an associate\'s page of only hidden rows still moves the cursor: no endless asking', async () => {
    const { phone } = await staffPhone(owner, business, 'associate');
    const start = (await phone.pull(business)).body.watermark;
    await staffPhone(owner, business, 'manager'); // a membership and a device: hidden from associates
    const page = await phone.pull(business, start);
    expect(page.body.rows).toEqual([]);
    expect(page.body.nextCursor).toBeGreaterThan(start);
    expect(page.body.hasMore).toBe(false);
  });

  test('rows committed while a phone is paging come in the next pull, never skipped', async () => {
    const start = (await owner.pull(business)).body.watermark;
    await owner.push(business, Array.from({ length: 6 }, () => addLocation()));
    const firstPage = await owner.pull(business, start, 2);
    const latecomer = addLocation('Saved during the pull');
    await owner.push(business, [latecomer]);

    let cursor = firstPage.body.nextCursor;
    const seen = [...firstPage.body.rows];
    let hasMore = firstPage.body.hasMore;
    const watermark = firstPage.body.watermark;
    while (hasMore) {
      const page = await owner.pull(business, cursor, 2);
      expect(page.body.watermark).toBeGreaterThanOrEqual(watermark);
      seen.push(...page.body.rows);
      cursor = page.body.nextCursor;
      hasMore = page.body.hasMore;
    }
    expect(seen.filter((r) => r.type === 'location' && r.data.name === 'Saved during the pull')).toHaveLength(1);
    const again = await owner.pull(business, cursor);
    expect(again.body.rows.filter((r) => r.data.name === 'Saved during the pull')).toHaveLength(0); // already seen, not repeated
  });

  test('2,000 rows paged with limit 500: each exactly once, with steady server memory', async () => {
    const start = (await owner.pull(business)).body.watermark;
    for (let i = 0; i < 10; i += 1) {
      const res = await owner.push(business, Array.from({ length: 200 }, (_, j) => addLocation(`Bulk ${i}-${j}`)));
      expect(statuses(res).every((s) => s === 'saved')).toBe(true);
    }

    // Pages through everything after `start`, collecting location names.
    async function pageAll() {
      const names = [];
      let cursor = start;
      for (let guard = 0; guard < 100; guard += 1) {
        const page = await owner.pull(business, cursor, 500);
        names.push(...page.body.rows.filter((r) => r.type === 'location').map((r) => r.data.name));
        cursor = page.body.nextCursor;
        if (!page.body.hasMore) break;
      }
      return names;
    }

    const names = await pageAll();
    expect(names.filter((n) => n.startsWith('Bulk '))).toHaveLength(2000);
    expect(new Set(names).size).toBe(names.length);

    // Memory: page through all 2,000 rows 5 more times; after a forced garbage
    // collection the heap must not keep growing. The margin is generous (64 MB):
    // see docs/guide.md, "BE5.5", for why.
    if (typeof global.gc !== 'function') throw new Error('Run with node --expose-gc (npm run test:sync does)');
    global.gc();
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    for (let round = 0; round < 5; round += 1) {
      await pageAll();
      global.gc();
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    expect(peak - baseline).toBeLessThan(64 * 1024 * 1024);
  });

  test('role filtering for every row type that exists: owner everything with cost, manager and associate no team, no phones, no cost; associates only the stock-rule fields', async () => {
    const manager = (await staffPhone(owner, business, 'manager')).phone;
    const associate = (await staffPhone(owner, business, 'associate')).phone;
    // Pulls everything from 0, page by page.
    async function allRows(phone) {
      const rows = [];
      let cursor = 0;
      for (let guard = 0; guard < 100; guard += 1) {
        const page = await phone.pull(business, cursor, 500);
        rows.push(...page.body.rows);
        cursor = page.body.nextCursor;
        if (!page.body.hasMore) break;
      }
      return rows;
    }
    const productId = randomUUID();
    await owner.push(business, [
      op('product.upsert', { productId, baseVersion: null, fields: { name: 'Filtered shirt', type: 'clothing', unit: 'piece', retailMinor: 9000, costMinor: 5555 } }),
      op('size.upsert', { sizeId: randomUUID(), productId, baseVersion: null, fields: { label: 'L', sortOrder: 0, costMinor: 5566 } }),
    ]);
    const types = (rows) => new Set(rows.map((r) => r.type));
    const ownerRows = await allRows(owner);
    expect(types(ownerRows)).toEqual(new Set(['settings', 'location', 'membership', 'device', 'product', 'size', 'stockMovement', 'stockCount', 'sale']));
    expect(ownerRows.filter((r) => r.type === 'product' || r.type === 'size').every((r) => 'costMinor' in r.data)).toBe(true);
    for (const phone of [manager, associate]) {
      const rows = await allRows(phone);
      // Associates see no one else's sales (this one made none); managers see them all.
      expect(types(rows)).toEqual(new Set(['settings', 'location', 'product', 'size', 'stockMovement', 'stockCount', ...(phone === manager ? ['sale'] : [])]));
      if (phone === manager) rows.filter((r) => r.type === 'sale').forEach((r) => r.data.items.forEach((i) => expect(i).not.toHaveProperty('unitCostMinor')));
      expect(rows.some((r) => 'costMinor' in r.data)).toBe(false);
      const stockFields = rows.filter((r) => r.type === 'stockMovement').flatMap((r) => Object.keys(r.data));
      if (phone === associate) expect(stockFields.some((k) => ['type', 'reason', 'note', 'flags', 'recordedBy'].includes(k))).toBe(false);
      else expect(stockFields).toContain('reason');
      const values = rows.flatMap((r) => Object.values(r.data));
      expect(values).not.toContain(5555); // the owner's costs appear nowhere, under any field name
      expect(values).not.toContain(5566);
    }
  });
});

describe('people and phones that lost access', () => {
  test('a removed member and a revoked phone get 403 with the right code; the removed person still works in their own business', async () => {
    // Someone who owns their own shop is invited into this one, accepts, then is removed.
    const theirs = new Phone(server);
    const body = signupBody({ businessName: 'Their own shop' });
    const theirBusiness = await theirs.signUp(body);
    await theirs.register(theirBusiness);
    const invite = await owner.send({ method: 'POST', path: '/api/team', business, body: { name: 'Invited', phone: body.phone, role: 'manager' } });
    await theirs.send({ method: 'POST', path: `/api/auth/invitations/${invite.body.member.membershipId}/accept` });
    await theirs.register(business);
    expect((await theirs.pull(business)).status).toBe(200);

    await owner.send({ method: 'DELETE', path: `/api/team/${invite.body.member.membershipId}`, business });
    expect((await theirs.pull(business)).body.error.code).toBe('ACCESS_REMOVED');
    expect((await theirs.push(business, [])).body.error.code).toBe('ACCESS_REMOVED');
    expect((await theirs.pull(theirBusiness)).status).toBe(200); // still signed in, own business fine

    const { phone } = await staffPhone(owner, business, 'associate');
    await owner.send({ method: 'DELETE', path: `/api/devices/${phone.devices.get(business).deviceId}`, business });
    expect((await phone.pull(business)).body.error.code).toBe('DEVICE_REVOKED');
    expect((await phone.push(business, [])).body.error.code).toBe('DEVICE_REVOKED');
  });
});

describe('afterwards', () => {
  test('check:sequences, check:operations and check:stock find nothing wrong', async () => {
    const sequelize = db.getSequelize();
    expect(await checkStock(sequelize)).toEqual([]);
    expect(await checkReceipts(sequelize)).toEqual([]);
    expect(await checkBalances(sequelize)).toEqual([]);
    expect(await checkSequences(sequelize)).toEqual([]);
    expect(await checkOperations(sequelize)).toEqual([]);
  });
});
