// BE5 Part B: push (idempotent, per-operation results, OP_ID_CONFLICT,
// stored rejections, temporary failures never stored), settings.update
// (last change wins, conflicts in ChangeLog), pull (watermark, cursor = last
// number scanned, role filtering), and the read-only consistency checks.

const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { operations } = require('../../src/sync/operations');
const { checkSequences, checkOperations } = require('../../src/checks/syncChecks');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });

// Test-only operations (never in the real registry), to force failures.
let deadlockOnce = true;
const testOperations = {
  ...operations,
  // Writes a ChangeLog row, then fails as if the database went away.
  'test.fail': {
    roles: ['owner'],
    schema: require('zod').z.object({}),
    async handler(ctx) {
      await ctx.s.ChangeLog.create({ id: randomUUID(), entity: 'test', entityId: randomUUID(), changedBy: ctx.user.id, changedAt: ctx.now }, { transaction: ctx.transaction });
      throw Object.assign(new Error('connect ECONNREFUSED (simulated)'), { name: 'SequelizeConnectionRefusedError' });
    },
  },
  // Fails with a deadlock the first time it runs, then succeeds.
  'test.deadlock': {
    roles: ['owner'],
    schema: require('zod').z.object({}),
    async handler(ctx) {
      if (deadlockOnce) {
        deadlockOnce = false;
        throw Object.assign(new Error('Deadlock found (simulated)'), { original: { errno: 1213, code: 'ER_LOCK_DEADLOCK' } });
      }
      ctx.stamp('BusinessSettings', {});
      return { ok: true };
    },
  },
  // Takes locks against the global order (a bug the guard must catch).
  'test.badLockOrder': {
    roles: ['owner'],
    schema: require('zod').z.object({}),
    async handler(ctx) {
      await ctx.lock('settings', 'BusinessSettings', {});
      await ctx.lock('customer', 'BusinessSettings', {});
      return {};
    },
  },
};

let ctx;
beforeAll(() => resetDatabase());
beforeEach(() => { ctx = dbApp({ operations: testOperations }); });
afterAll(() => db.closeDatabase());

// An owner whose phone is registered; helpers to push and pull.
async function owner() {
  const { agent, body, res } = await signUpOwner(ctx.app, ctx.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  return { phone: agent, body, businessId, userId: res.body.user.id, deviceId: device.deviceId };
}
const push = (o, ops) => o.phone.post('/api/sync/push').set(biz(o.businessId)).send({ deviceId: o.deviceId, operations: ops });
const pull = (o, since = 0, limit = 500) => o.phone.get(`/api/sync/pull?since=${since}&limit=${limit}`).set(biz(o.businessId));
const settingsOp = (changes, baseVersion = 1, opId = randomUUID()) => ({ opId, type: 'settings.update', recordedOnline: true, payload: { baseVersion, changes } });

// A staff member of `o` with their own phone, ready to sync.
async function staff(o, role) {
  const phoneNumber = signupBody().phone;
  const added = await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: `A ${role}`, phone: phoneNumber, role });
  const { agent } = await signInAgent(ctx.app, ctx.config, phoneNumber, added.body.temporaryPassword);
  await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: `${role}-pass-2026` });
  agent.setPassword(`${role}-pass-2026`);
  await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
  const device = await agent.registerIn(o.businessId);
  return { phone: agent, businessId: o.businessId, deviceId: device.deviceId, membershipId: added.body.member.membershipId };
}

const settingsRow = (businessId) => db.getModels().BusinessSettings.findByPk(businessId);

describe('push: settings.update', () => {
  test('is saved: version goes up, the change is recorded, and phones pull it', async () => {
    const o = await owner();
    const res = await push(o, [settingsOp({ businessName: 'Ama Shoes', receiptNote: 'Returns within 7 days' })]);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([{ opId: expect.any(String), status: 'saved', result: { version: 2 } }]);
    expect(await settingsRow(o.businessId)).toMatchObject({ businessName: 'Ama Shoes', receiptNote: 'Returns within 7 days', version: 2, updatedBy: o.userId });
    const log = await db.getModels().ChangeLog.findOne({ where: { businessId: o.businessId, entity: 'settings' } });
    expect(log).toMatchObject({ conflict: false, before: { businessName: 'Ama Fabrics', receiptNote: null, version: 1 } });

    const rows = (await pull(o)).body.rows.filter((r) => r.type === 'settings');
    expect(rows).toHaveLength(1);
    expect(rows[0].data).toMatchObject({ businessName: 'Ama Shoes', version: 2 });
  });

  test('the same push twice is applied once; the second answer is "duplicate" with the same result', async () => {
    const o = await owner();
    const op = settingsOp({ lowStockThreshold: 5 });
    const first = await push(o, [op]);
    const second = await push(o, [op]);
    expect(first.body.results[0]).toMatchObject({ status: 'saved', result: { version: 2 } });
    expect(second.body.results[0]).toEqual({ opId: op.opId, status: 'duplicate', result: { version: 2 } });
    expect((await settingsRow(o.businessId)).version).toBe(2);
    expect(await db.getModels().ProcessedOperation.count({ where: { businessId: o.businessId } })).toBe(1);
  });

  test('two copies pushed at the same moment have exactly one effect', async () => {
    const o = await owner();
    const op = settingsOp({ returnPeriodDays: 14 });
    const [a, b] = await Promise.all([push(o, [op]), push(o, [op])]);
    expect([a.body.results[0].status, b.body.results[0].status].sort()).toEqual(['duplicate', 'saved']);
    expect((await settingsRow(o.businessId)).version).toBe(2);
  });

  test('the same opId with a different payload is rejected OP_ID_CONFLICT, and the rest of the batch is saved', async () => {
    const o = await owner();
    const opId = randomUUID();
    await push(o, [settingsOp({ lowStockThreshold: 4 }, 1, opId)]);
    const res = await push(o, [settingsOp({ lowStockThreshold: 9 }, 1, opId), settingsOp({ returnPeriodDays: 3 }, 2)]);
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ opId, status: 'rejected', error: { code: 'OP_ID_CONFLICT' } });
    expect(res.body.results[1]).toMatchObject({ status: 'saved', result: { version: 3 } });
    expect(await settingsRow(o.businessId)).toMatchObject({ lowStockThreshold: 4, returnPeriodDays: 3 });
  });

  test("a payload that fails validation is rejected WITHOUT reserving the opId; an unknown type too", async () => {
    const o = await owner();
    const opId = randomUUID();
    const bad = await push(o, [
      { opId, type: 'settings.update', payload: { baseVersion: 1, changes: { colour: 'red' } } },
      { opId: randomUUID(), type: 'nothing.real', payload: {} },
      { type: 'settings.update', payload: {} },
    ]);
    expect(bad.body.results.map((r) => r.error.code)).toEqual(['INVALID_PAYLOAD', 'UNKNOWN_OPERATION', 'INVALID_PAYLOAD']);
    expect(await db.getModels().ProcessedOperation.count({ where: { businessId: o.businessId } })).toBe(0);
    // The same opId with a valid payload is then accepted normally.
    expect((await push(o, [settingsOp({ lowStockThreshold: 2 }, 1, opId)])).body.results[0].status).toBe('saved');
  });

  test("a business-rule rejection is stored (same answer every time) and undoes the operation's partial writes", async () => {
    const o = await owner();
    const op = settingsOp({ paymentMethods: ['cash', 'card'], businessName: 'Should not stick' });
    const first = await push(o, [op]);
    expect(first.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED', fields: { paymentMethods: expect.stringMatching(/card/) } } });
    expect(await settingsRow(o.businessId)).toMatchObject({ businessName: 'Ama Fabrics', version: 1 });
    expect((await push(o, [op])).body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_FAILED' } });
    expect(await db.getModels().ProcessedOperation.findOne({ where: { businessId: o.businessId, opId: op.opId } })).toMatchObject({ status: 'rejected', errorCode: 'VALIDATION_FAILED' });
  });

  test('a manager or associate is rejected FORBIDDEN (stored); the owner\'s role is re-read every time', async () => {
    const o = await owner();
    for (const role of ['manager', 'associate']) {
      const s = await staff(o, role);
      const res = await push(s, [settingsOp({ lowStockThreshold: 99 })]);
      expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
    }
    expect((await settingsRow(o.businessId)).lowStockThreshold).toBe(3);
  });

  test('an edit based on an older version still wins (last received), and ChangeLog marks the conflict', async () => {
    const o = await owner();
    await push(o, [settingsOp({ businessName: 'First edit' }, 1)]);
    const res = await push(o, [settingsOp({ businessName: 'Second phone, offline' }, 1)]);
    expect(res.body.results[0]).toMatchObject({ status: 'saved', result: { version: 3 } });
    const logs = await db.getModels().ChangeLog.findAll({ where: { businessId: o.businessId, entity: 'settings' } });
    expect(logs.map((l) => l.conflict).sort()).toEqual([false, true]);
    expect((await settingsRow(o.businessId)).businessName).toBe('Second phone, offline');
  });

  test('refuses a deviceId that isn\'t the signing phone, and more than 200 operations', async () => {
    const o = await owner();
    const wrong = await o.phone.post('/api/sync/push').set(biz(o.businessId)).send({ deviceId: randomUUID(), operations: [] });
    expect(wrong.body.error.fields.deviceId).toBeDefined();
    const tooMany = await push(o, Array.from({ length: 201 }, () => settingsOp({ lowStockThreshold: 1 })));
    expect(tooMany.status).toBe(400);
  });
});

describe('push: temporary failures and the lock order', () => {
  test('a forced database error leaves no ProcessedOperation row and no partial change; earlier operations stay saved', async () => {
    const o = await owner();
    const saved = settingsOp({ lowStockThreshold: 6 });
    const failing = { opId: randomUUID(), type: 'test.fail', payload: {} };
    const res = await push(o, [saved, failing]);
    expect(res.status).toBe(500); // temporary: the phone keeps the operation and retries
    const models = db.getModels();
    expect(await models.ProcessedOperation.findOne({ where: { businessId: o.businessId, opId: failing.opId } })).toBeNull();
    expect(await models.ChangeLog.count({ where: { businessId: o.businessId, entity: 'test' } })).toBe(0);
    expect(await models.ProcessedOperation.findOne({ where: { businessId: o.businessId, opId: saved.opId } })).toMatchObject({ status: 'saved' });
  });

  test('a deadlock is retried and the operation is saved once', async () => {
    deadlockOnce = true;
    const o = await owner();
    const res = await push(o, [{ opId: randomUUID(), type: 'test.deadlock', payload: {} }]);
    expect(res.body.results[0]).toMatchObject({ status: 'saved', result: { ok: true } });
    expect(await db.getModels().ProcessedOperation.count({ where: { businessId: o.businessId } })).toBe(1);
  });

  test('locks taken against the global order are refused (and nothing is stored)', async () => {
    const o = await owner();
    const op = { opId: randomUUID(), type: 'test.badLockOrder', payload: {} };
    expect((await push(o, [op])).status).toBe(500);
    expect(await db.getModels().ProcessedOperation.findOne({ where: { businessId: o.businessId, opId: op.opId } })).toBeNull();
  });
});

describe('pull', () => {
  test('the owner gets settings, the shop, memberships and phones; a cursor returns only newer rows', async () => {
    const o = await owner();
    const first = await pull(o);
    expect(first.status).toBe(200);
    expect(new Set(first.body.rows.map((r) => r.type))).toEqual(new Set(['settings', 'location', 'membership', 'device']));
    expect(first.body).toMatchObject({ hasMore: false, nextCursor: first.body.watermark });
    const seqs = first.body.rows.map((r) => r.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(JSON.stringify(first.body)).not.toMatch(/publicKey|passwordHash|tokenHash/);

    await push(o, [settingsOp({ businessName: 'Newer' })]);
    const next = await pull(o, first.body.nextCursor);
    expect(next.body.rows).toEqual([expect.objectContaining({ type: 'settings', data: expect.objectContaining({ businessName: 'Newer' }) })]);
  });

  test("an associate gets settings and the shop only; the cursor still moves past the rows they can't see", async () => {
    const o = await owner();
    const a = await staff(o, 'associate');
    const res = await pull(a);
    expect(new Set(res.body.rows.map((r) => r.type))).toEqual(new Set(['settings', 'location']));
    expect(res.body.nextCursor).toBe(res.body.watermark);
    expect(res.body.hasMore).toBe(false);

    // A page holding only hidden rows (memberships, devices) still moves the cursor.
    const watermarkBefore = res.body.watermark;
    await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: 'Another', phone: signupBody().phone, role: 'associate' });
    const hiddenOnly = await pull(a, watermarkBefore);
    expect(hiddenOnly.body.rows).toEqual([]);
    expect(hiddenOnly.body.nextCursor).toBeGreaterThan(watermarkBefore);
  });

  test('paging with a small limit returns every row exactly once', async () => {
    const o = await owner();
    for (let i = 0; i < 3; i += 1) await staff(o, 'associate');
    const all = (await pull(o)).body.rows.map((r) => r.serverSeq);
    const paged = [];
    let cursor = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      const page = await pull(o, cursor, 2);
      paged.push(...page.body.rows.map((r) => r.serverSeq));
      cursor = page.body.nextCursor;
      if (!page.body.hasMore) break;
    }
    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(paged.length);
  });

  test('a removed member gets ACCESS_REMOVED and a revoked phone DEVICE_REVOKED, on push and pull', async () => {
    const o = await owner();
    const m = await staff(o, 'manager');
    await o.phone.delete(`/api/team/${m.membershipId}`).set(biz(o.businessId));
    expect((await pull(m)).body.error.code).toBe('ACCESS_REMOVED');
    expect((await push(m, [])).body.error.code).toBe('ACCESS_REMOVED');

    const second = await staff(o, 'associate');
    await o.phone.delete(`/api/devices/${second.deviceId}`).set(biz(o.businessId));
    expect((await pull(second)).body.error.code).toBe('DEVICE_REVOKED');
    expect((await push(second, [])).body.error.code).toBe('DEVICE_REVOKED');
  });
});

describe('the consistency checks', () => {
  test('check:sequences and check:operations find nothing wrong after all of the above', async () => {
    const sequelize = db.getSequelize();
    expect(await checkSequences(sequelize)).toEqual([]);
    expect(await checkOperations(sequelize)).toEqual([]);
  });
});
