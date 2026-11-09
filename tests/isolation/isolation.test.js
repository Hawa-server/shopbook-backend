// Business isolation (BE4): two businesses, A and B, each with an owner, an
// active staff member, a pending invitation and a removed member. Every
// business endpoint is tried with the OTHER business's IDs, and must answer
// exactly like a record that doesn't exist (404, same body as a random ID),
// changing nothing. Straight in MySQL, the composite foreign keys must refuse
// a row in A that points at B's people.
//
// Every route marked `business: true` in the registry MUST have a case in
// CASES below: later tasks add theirs, or this file fails.

const request = require('supertest');
const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { routes } = require('../../src/routes');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const RANDOM_ID = '7f1e2d3c-4b5a-4968-8776-655443322110';

let ctx;
let A;
let B;

// Builds one business: an owner, an active staff member, a pending
// invitation (for a separate existing account) and a removed member.
async function buildBusiness(label) {
  const { agent, body, res } = await signUpOwner(ctx.app, ctx.config, { businessName: `Shop ${label}`, name: `Owner ${label}` });
  const businessId = res.body.businesses[0].id;
  const add = (name, phone) => agent.post('/api/team').set(biz(businessId)).send({ name, phone, role: 'associate' });

  const staffPhone = signupBody().phone;
  const staff = await add(`Staff ${label}`, staffPhone);
  const invitee = await signUpOwner(ctx.app, ctx.config, { name: `Invitee ${label}` });
  const invited = await add(`Invited ${label}`, invitee.body.phone);
  const removed = await add(`Removed ${label}`, signupBody().phone);
  await agent.delete(`/api/team/${removed.body.member.membershipId}`).set(biz(businessId));
  const ownerDevice = await agent.registerIn(businessId);
  const productId = randomUUID();
  const sizeId = randomUUID();
  await agent.post('/api/sync/push').set(biz(businessId)).send({
    deviceId: ownerDevice.deviceId,
    operations: [
      { opId: randomUUID(), type: 'product.upsert', payload: { productId, baseVersion: null, fields: { name: `Sandal ${label}`, type: 'shoes', unit: 'pair', retailMinor: 12000, costMinor: 8000 } } },
      { opId: randomUUID(), type: 'size.upsert', payload: { sizeId, productId, baseVersion: null, fields: { label: '40', sortOrder: 0 } } },
    ],
  });
  const locationId = (await db.getModels().Location.findOne({ where: { businessId } })).id;
  const movementId = randomUUID();
  await agent.post('/api/sync/push').set(biz(businessId)).send({
    deviceId: ownerDevice.deviceId,
    operations: [{ opId: randomUUID(), type: 'stock.create', payload: { movementId, type: 'opening', locationId, productId, sizeId, quantityUnits: 5, recordedAt: new Date().toISOString() } }],
  });

  return {
    label, agent, businessId, ownerId: res.body.user.id, ownerPhone: body.phone, ownerPassword: body.password,
    staffId: staff.body.member.membershipId, staffPhone, staffTemp: staff.body.temporaryPassword,
    invitedId: invited.body.member.membershipId, invitee,
    removedId: removed.body.member.membershipId,
    memberIds: [staff.body.member.membershipId, invited.body.member.membershipId, removed.body.member.membershipId],
    deviceId: ownerDevice.deviceId, deviceCode: ownerDevice.deviceCode, productId, sizeId, locationId, movementId,
  };
}

beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp();
  A = await buildBusiness('A');
  B = await buildBusiness('B');
}, 120000);
afterAll(() => db.closeDatabase());

// Sends a request as `who` (an agent) and returns { status, body }.
async function call(agent, method, url, headers, body) {
  const res = await agent[method.toLowerCase()](url).set(headers).send(body ?? undefined);
  return { status: res.status, body: res.body };
}

// Expects B's ID used from A to be answered EXACTLY like an unknown ID.
async function expectSameAsUnknown(method, urlFor, body, bId = B.staffId) {
  const withB = await call(A.agent, method, urlFor(bId), biz(A.businessId), body);
  const withRandom = await call(A.agent, method, urlFor(RANDOM_ID), biz(A.businessId), body);
  expect(withB).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
  expect(withB).toEqual(withRandom);
}

// One case per business route: what A tries against B, and the proof that
// nothing of B's changed.
const CASES = {
  'POST /api/sync/push': async () => {
    // A's settings.update changes A only; B's settings are untouched.
    const bBefore = await db.getModels().BusinessSettings.findByPk(B.businessId);
    const res = await A.agent.post('/api/sync/push').set(biz(A.businessId)).send({
      deviceId: A.deviceId,
      operations: [{ opId: randomUUID(), type: 'settings.update', payload: { baseVersion: 1, changes: { businessName: 'Changed by A' } } }],
    });
    expect(res.body.results[0].status).toBe('saved');
    const bAfter = await db.getModels().BusinessSettings.findByPk(B.businessId);
    expect([bAfter.businessName, bAfter.version]).toEqual([bBefore.businessName, bBefore.version]);

    // A's product and size operations naming B's product or size: B's records never change.
    const productBefore = await db.getModels().Product.findByPk(B.productId);
    const sizeBefore = await db.getModels().ProductSize.findByPk(B.sizeId);
    const tries = await A.agent.post('/api/sync/push').set(biz(A.businessId)).send({
      deviceId: A.deviceId,
      operations: [
        { opId: randomUUID(), type: 'product.upsert', payload: { productId: B.productId, baseVersion: 1, fields: { retailMinor: 1 } } },
        { opId: randomUUID(), type: 'product.upsert', payload: { productId: B.productId, baseVersion: null, fields: { name: 'Taken over', type: 'other', unit: 'piece', retailMinor: 1, costMinor: 1 } } },
        { opId: randomUUID(), type: 'size.upsert', payload: { sizeId: randomUUID(), productId: B.productId, baseVersion: null, fields: { label: 'X', sortOrder: 0 } } },
        { opId: randomUUID(), type: 'size.upsert', payload: { sizeId: B.sizeId, productId: A.productId, baseVersion: 1, fields: { label: 'X' } } },
      ],
    });
    // An edit of B's product answers exactly like an unknown product; a NEW
    // product with B's (random, unguessable) ID is refused without saying more.
    expect(tries.body.results.map((r) => r.error.code)).toEqual(['NOT_FOUND', 'ID_TAKEN', 'NOT_FOUND', 'NOT_FOUND']);
    const productAfter = await db.getModels().Product.findByPk(B.productId);
    const sizeAfter = await db.getModels().ProductSize.findByPk(B.sizeId);
    expect([productAfter.name, productAfter.version, productAfter.businessId]).toEqual([productBefore.name, productBefore.version, B.businessId]);
    expect([sizeAfter.label, sizeAfter.version, sizeAfter.productId]).toEqual([sizeBefore.label, sizeBefore.version, B.productId]);

    // Stock operations naming B's product, size or shop: answered like unknown ones, B's stock untouched.
    const { StockMovement, StockCount } = db.getModels();
    const bMovements = await StockMovement.count({ where: { businessId: B.businessId } });
    const now = new Date().toISOString();
    const stockTries = await A.agent.post('/api/sync/push').set(biz(A.businessId)).send({
      deviceId: A.deviceId,
      operations: [
        { opId: randomUUID(), type: 'stock.create', payload: { movementId: randomUUID(), type: 'removal', reason: 'lost', locationId: A.locationId, productId: B.productId, sizeId: B.sizeId, quantityUnits: 1, recordedAt: now } },
        { opId: randomUUID(), type: 'stock.create', payload: { movementId: randomUUID(), type: 'restock', locationId: B.locationId, productId: A.productId, sizeId: A.sizeId, quantityUnits: 1, recordedAt: now } },
        { opId: randomUUID(), type: 'stockCount.create', payload: { countId: randomUUID(), locationId: A.locationId, productId: B.productId, sizeId: B.sizeId, countedUnits: 0, baselineUnits: 0, baselineCursor: 0, recordedAt: now } },
        { opId: randomUUID(), type: 'stock.create', payload: { movementId: B.movementId, type: 'restock', locationId: A.locationId, productId: A.productId, sizeId: A.sizeId, quantityUnits: 1, recordedAt: now } },
      ],
    });
    expect(stockTries.body.results.map((r) => r.error.code)).toEqual(['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND', 'ID_TAKEN']);
    expect(await StockMovement.count({ where: { businessId: B.businessId } })).toBe(bMovements);
    expect(await StockCount.count({ where: { businessId: B.businessId } })).toBe(0);
    expect((await StockMovement.findByPk(B.movementId)).businessId).toBe(B.businessId);
  },
  'GET /api/products/:productId/history': async () => {
    await expectSameAsUnknown('GET', (id) => `/api/products/${id}/history`, undefined, B.productId);
    const own = await A.agent.get(`/api/products/${A.productId}/history`).set(biz(A.businessId));
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.body)).not.toContain(B.productId);
  },
  'GET /api/sync/pull': async () => {
    const res = await A.agent.get('/api/sync/pull?since=0').set(biz(A.businessId));
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    for (const leak of [B.businessId, B.ownerId, B.deviceId, B.productId, B.sizeId, B.locationId, B.movementId, 'Shop B', 'Owner B', 'Staff B', 'Sandal B', ...B.memberIds]) expect(text).not.toContain(leak);
  },
  'POST /api/devices/challenge': async () => {
    const before = await db.getModels().DeviceChallenge.count({ where: { businessId: B.businessId } });
    expect((await call(A.agent, 'POST', '/api/devices/challenge', biz(B.businessId))).status).toBe(404);
    expect(await db.getModels().DeviceChallenge.count({ where: { businessId: B.businessId } })).toBe(before);
  },
  'POST /api/devices': async () => {
    const before = await db.getModels().Device.count({ where: { businessId: B.businessId } });
    const res = await call(A.agent, 'POST', '/api/devices', biz(B.businessId), { deviceId: randomUUID(), name: 'Sneaky' });
    expect(res.status).toBe(404);
    expect(await db.getModels().Device.count({ where: { businessId: B.businessId } })).toBe(before);
  },
  'GET /api/devices': async () => {
    const own = await A.agent.get('/api/devices').set(biz(A.businessId));
    expect(own.status).toBe(200);
    const text = JSON.stringify(own.body);
    for (const leak of [B.deviceId, B.ownerId, `"${B.deviceCode}"`]) expect(text).not.toContain(leak);
  },
  'DELETE /api/devices/:deviceId': async () => {
    await expectSameAsUnknown('DELETE', (id) => `/api/devices/${id}`, undefined, B.deviceId);
    expect((await db.getModels().Device.findByPk(B.deviceId)).isActive).toBe(true);
  },
  'PATCH /api/business/locale': async () => {
    const before = await db.getModels().Business.findByPk(B.businessId);
    const res = await call(A.agent, 'PATCH', '/api/business/locale', biz(B.businessId), { timezone: 'Africa/Accra' });
    expect(res).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
    const after = await db.getModels().Business.findByPk(B.businessId);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  },
  'GET /api/team': async () => {
    const own = await A.agent.get('/api/team').set(biz(A.businessId));
    const text = JSON.stringify(own.body);
    for (const leak of [B.businessId, B.ownerId, B.ownerPhone, 'Owner B', 'Staff B', 'Invited B', 'Removed B', ...B.memberIds]) {
      expect(text).not.toContain(leak);
    }
  },
  'POST /api/team': async () => {
    const before = await db.getModels().Membership.count({ where: { businessId: B.businessId } });
    const res = await call(A.agent, 'POST', '/api/team', biz(B.businessId), { name: 'Sneaky', phone: signupBody().phone, role: 'manager' });
    expect(res.status).toBe(404);
    expect(await db.getModels().Membership.count({ where: { businessId: B.businessId } })).toBe(before);
  },
  'PATCH /api/team/:membershipId': async () => {
    await expectSameAsUnknown('PATCH', (id) => `/api/team/${id}`, { role: 'manager' });
    expect((await db.getModels().Membership.findByPk(B.staffId)).role).toBe('associate');
  },
  'POST /api/team/:membershipId/reset-password': async () => {
    await expectSameAsUnknown('POST', (id) => `/api/team/${id}/reset-password`);
    // B's staff member still signs in with the same temporary password.
    expect((await signInAgent(ctx.app, ctx.config, B.staffPhone, B.staffTemp)).res.status).toBe(200);
  },
  'DELETE /api/team/:membershipId': async () => {
    await expectSameAsUnknown('DELETE', (id) => `/api/team/${id}`);
    expect((await db.getModels().Membership.findByPk(B.staffId)).isActive).toBe(true);
  },
};

describe('every business route has an isolation case', () => {
  test('no route marked business: true is missing from CASES', () => {
    const businessRoutes = routes.filter((r) => r.business).map((r) => `${r.method} ${r.path}`).sort();
    expect(Object.keys(CASES).sort()).toEqual(businessRoutes);
  });
});

describe("A's people against B's records", () => {
  test.each(Object.keys(CASES))('%s', async (key) => {
    await CASES[key]();
  });

  test("X-Business set to B gives the same 404 as a random business, on every business route", async () => {
    for (const route of routes.filter((r) => r.business)) {
      const url = route.path.replace(':membershipId', B.staffId).replace(':deviceId', B.deviceId).replace(':productId', B.productId);
      const body = route.method === 'GET' || route.method === 'DELETE' ? undefined : { name: 'X', phone: '0201112233', role: 'manager' };
      const withB = await call(A.agent, route.method, url, biz(B.businessId), body);
      const withRandom = await call(A.agent, route.method, url, biz(randomUUID()), body);
      expect(withB).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
      expect(withB).toEqual(withRandom);
    }
  });

  test("B's staff member can't reach A either", async () => {
    const { agent } = await signInAgent(ctx.app, ctx.config, B.staffPhone, B.staffTemp);
    await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: B.staffTemp, newPassword: 'staff-b-pass-2026' });
    agent.setPassword('staff-b-pass-2026');
    await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    expect((await agent.get('/api/team').set(biz(A.businessId))).status).toBe(404);
    B.staffTemp = 'staff-b-pass-2026';
  });

  test("an invitation of B's can't be accepted or declined by A's people", async () => {
    for (const action of ['accept', 'decline']) {
      const res = await A.agent.post(`/api/auth/invitations/${B.invitedId}/${action}`).set(XHR);
      expect(res.status).toBe(404);
    }
    const stillPending = await db.getModels().Membership.findByPk(B.invitedId);
    expect(stillPending).toMatchObject({ isActive: false, removedAt: null });
  });
});

describe('the database itself (composite foreign keys)', () => {
  const now = () => new Date();

  // Tries an insert/update straight in MySQL and returns the error (or null).
  async function attempt(fn) {
    try { await fn(); return null; } catch (err) { return err; }
  }

  test('a ChangeLog row in A "changed by" B\'s owner is refused; A\'s owner and a system change (NULL) are accepted', async () => {
    const { ChangeLog } = db.getModels();
    const row = (changedBy) => ({
      id: randomUUID(), businessId: A.businessId, entity: 'test', entityId: randomUUID(), changedBy, changedAt: now(),
    });
    const refused = await attempt(() => ChangeLog.create(row(B.ownerId)));
    expect(refused?.original?.sqlMessage ?? String(refused)).toMatch(/foreign key constraint fails.*fk_changelog_member/i);
    expect(await attempt(() => ChangeLog.create(row(A.ownerId)))).toBeNull();
    expect(await attempt(() => ChangeLog.create(row(null)))).toBeNull(); // a system change
  });

  test("A's settings can't be marked as edited by B's owner; A's owner or a system change can", async () => {
    const { BusinessSettings } = db.getModels();
    const set = (updatedBy) => attempt(() => BusinessSettings.update({ updatedBy }, { where: { businessId: A.businessId } }));
    const refused = await set(B.ownerId);
    expect(refused?.original?.sqlMessage ?? String(refused)).toMatch(/foreign key constraint fails.*fk_settings_member/i);
    expect(await set(null)).toBeNull();
    expect(await set(A.ownerId)).toBeNull();
  });
});

describe('requests without a session', () => {
  test('are 401 before anything about a business is checked', async () => {
    const res = await request(ctx.app).get('/api/team').set(biz(B.businessId));
    expect(res.status).toBe(401);
  });
});
