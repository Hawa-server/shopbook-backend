// BE5 Part A: registering phones (password + proof of key) and signed
// requests (signature, server-corrected time, one-time nonce), the
// plan's "Device signing" tests, plus the lock-out after failed signatures.

const { randomUUID, randomBytes } = require('node:crypto');
const db = require('../../src/db');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');
const { makeKey, sign, signingHeaders } = require('../helpers/testPhone');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const CODE = /^[A-HJKMNP-Z2-46-79]{3}$/;

let ctx;
beforeAll(() => resetDatabase());
beforeEach(() => { ctx = dbApp(); });
afterAll(() => db.closeDatabase());

// An owner and their business; `phone` signs automatically.
async function owner(overrides) {
  const { agent, body, res } = await signUpOwner(ctx.app, ctx.config, overrides);
  return { phone: agent, raw: agent.agent, body, businessId: res.body.businesses[0].id, userId: res.body.user.id };
}

// Asks for a challenge and builds a registration body (signed by `key`).
async function registrationBody(o, key, overrides = {}) {
  const challenge = (await o.raw.post('/api/devices/challenge').set(biz(o.businessId))).body.challenge;
  return {
    deviceId: randomUUID(), name: "Ama's phone", publicKey: key.publicJwk, challenge,
    challengeSignature: await sign(key.privateKey, challenge), currentPassword: o.body.password, ...overrides,
  };
}
const register = (o, body) => o.raw.post('/api/devices').set(biz(o.businessId)).send(body);

// Sends a request signed with explicit pieces (for tampering tests).
async function signedRaw(o, device, { method = 'GET', url = '/api/devices', body, signAs = {} }) {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const headers = await signingHeaders({
    key: device.key, deviceId: device.deviceId, businessId: signAs.businessId ?? o.businessId,
    method: signAs.method ?? method, pathWithQuery: signAs.url ?? url, bodyText: signAs.bodyText ?? bodyText,
    signedAt: signAs.signedAt ?? ctx.clock.now(), nonce: signAs.nonce,
  });
  let req = o.raw[method.toLowerCase()](url).set({ ...biz(o.businessId), ...headers, ...(signAs.headers ?? {}) });
  if (bodyText) req = req.set('Content-Type', 'application/json').send(bodyText);
  return req;
}

describe('registering a phone', () => {
  test('works with the password and a signed challenge; gets a code; recorded; the owner is emailed', async () => {
    const o = await owner();
    const key = await makeKey();
    const body = await registrationBody(o, key);
    const res = await register(o, body);
    expect(res.status).toBe(201);
    expect(res.body.device).toMatchObject({ deviceId: body.deviceId, name: "Ama's phone" });
    expect(res.body.device.deviceCode).toMatch(CODE);

    const stored = await db.getModels().Device.findByPk(body.deviceId);
    expect(stored.publicKey).toEqual(key.publicJwk);
    expect(await db.getModels().ChangeLog.count({ where: { entity: 'device', entityId: body.deviceId } })).toBe(1);
    expect(ctx.outbox.at(-1)).toMatchObject({ template: 'device_added', to: o.body.email });
  });

  test('is refused without the right password (a stolen cookie alone can\'t add a key)', async () => {
    const o = await owner();
    const res = await register(o, await registrationBody(o, await makeKey(), { currentPassword: 'not-the-password' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
  });

  test('is refused with a made-up, reused or expired challenge', async () => {
    const o = await owner();
    const key = await makeKey();
    const madeUp = randomBytes(32).toString('base64url');
    expect((await register(o, await registrationBody(o, key, { challenge: madeUp, challengeSignature: await sign(key.privateKey, madeUp) }))).body.error.code)
      .toBe('CHALLENGE_INVALID');

    const once = await registrationBody(o, key);
    expect((await register(o, once)).status).toBe(201);
    expect((await register(o, { ...once, deviceId: randomUUID() })).body.error.code).toBe('CHALLENGE_INVALID'); // reused

    const late = await registrationBody(o, key, { deviceId: randomUUID() });
    ctx.clock.advance(5 * 60 * 1000 + 1000);
    expect((await register(o, late)).body.error.code).toBe('CHALLENGE_INVALID'); // expired
  });

  test('is refused when the challenge signature doesn\'t match the key, or the key is not P-256', async () => {
    const o = await owner();
    const key = await makeKey();
    const other = await makeKey();
    const body = await registrationBody(o, key);
    expect((await register(o, { ...body, challengeSignature: await sign(other.privateKey, body.challenge) })).body.error.code).toBe('DEVICE_KEY_INVALID');
    const offCurve = { ...key.publicJwk, y: Buffer.alloc(32, 1).toString('base64url') };
    expect((await register(o, { ...(await registrationBody(o, key)), publicKey: offCurve })).body.error.code).toBe('DEVICE_KEY_INVALID');
  });

  test('an existing device ID can\'t be registered again with another key (409 DEVICE_ID_TAKEN)', async () => {
    const o = await owner();
    const first = await registrationBody(o, await makeKey());
    expect((await register(o, first)).status).toBe(201);
    const again = await registrationBody(o, await makeKey(), { deviceId: first.deviceId });
    const res = await register(o, again);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DEVICE_ID_TAKEN');
  });

  test('device codes are never reused, even after a phone is revoked', async () => {
    const o = await owner();
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      const body = await registrationBody(o, await makeKey());
      const res = await register(o, body);
      codes.push(res.body.device.deviceCode);
      await o.phone.delete(`/api/devices/${body.deviceId}`).set(biz(o.businessId));
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('signed requests', () => {
  test('a valid signature passes; every response carries X-Server-Time', async () => {
    const o = await owner();
    const res = await o.phone.get('/api/devices').set(biz(o.businessId));
    expect(res.status).toBe(200);
    expect(res.headers['x-server-time']).toBe(String(ctx.clock.now()));
  });

  test('a request copied with a valid cookie but no key is refused', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const noHeaders = await o.raw.get('/api/devices').set(biz(o.businessId));
    expect(noHeaders.status).toBe(403);
    expect(noHeaders.body.error.code).toBe('DEVICE_NOT_REGISTERED');
    // The victim's device ID, signed with the attacker's own key:
    const attackerKey = await makeKey();
    const forged = await signedRaw(o, { ...device, key: attackerKey }, {});
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('DEVICE_SIGNATURE_INVALID');
  });

  test.each([
    ['the body', { method: 'PATCH', url: '/api/business/locale', body: { timezone: 'Africa/Accra' }, signAs: { bodyText: '{"timezone":"Europe/London"}' } }],
    ['the path', { signAs: { url: '/api/team' } }],
    ['the query string', { url: '/api/devices?x=1', signAs: { url: '/api/devices?x=2' } }],
    ['the method', { signAs: { method: 'POST' } }],
    ['the business', { signAs: { businessId: randomUUID() } }],
  ])('changing %s after signing fails', async (_label, options) => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const res = await signedRaw(o, device, options);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('DEVICE_SIGNATURE_INVALID');
  });

  test('a timestamp more than 5 minutes off is refused; after correcting from X-Server-Time it passes', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const phoneClock = ctx.clock.now() - 2 * 24 * 60 * 60 * 1000; // a phone set two days wrong
    const wrong = await signedRaw(o, device, { signAs: { signedAt: phoneClock } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('CLOCK_OUT_OF_RANGE');
    const offset = Number(wrong.headers['x-server-time']) - phoneClock; // what the app keeps
    expect((await signedRaw(o, device, { signAs: { signedAt: phoneClock + offset } })).status).toBe(200);
  });

  test('a reused nonce is refused, also when two copies race', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const nonce = randomBytes(16).toString('base64url');
    expect((await signedRaw(o, device, { signAs: { nonce } })).status).toBe(200);
    expect((await signedRaw(o, device, { signAs: { nonce } })).body.error.code).toBe('NONCE_REUSED');

    const raceNonce = randomBytes(16).toString('base64url');
    const results = await Promise.all([1, 2].map(() => signedRaw(o, device, { signAs: { nonce: raceNonce } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  test('a revoked phone is refused with 403 DEVICE_REVOKED', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const second = await registrationBody(o, await makeKey());
    await register(o, second);
    expect((await o.phone.delete(`/api/devices/${second.deviceId}`).set(biz(o.businessId))).status).toBe(200);
    const revokedDevice = { deviceId: second.deviceId, key: null };
    const res = await o.raw.get('/api/devices').set({ ...biz(o.businessId), 'X-Device-Id': revokedDevice.deviceId, 'X-Signed-At': '1', 'X-Nonce': 'x', 'X-Signature': 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEVICE_REVOKED');
    expect(device).toBeDefined();
  });

  test('a valid signature without a valid session is refused (401 NOT_SIGNED_IN)', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    await o.raw.post('/api/auth/signout').set(XHR);
    const res = await signedRaw(o, device, {});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_SIGNED_IN');
  });
});

describe('lock-out after failed signatures', () => {
  test('after 20 failures in 15 minutes the phone is refused for 15 minutes, and the owner sees it', async () => {
    const limited = dbApp({ limiters: createAuthLimiters() });
    ctx = limited;
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const wrongKey = await makeKey();
    for (let i = 0; i < 20; i += 1) {
      expect((await signedRaw(o, { ...device, key: wrongKey }, {})).body.error.code).toBe('DEVICE_SIGNATURE_INVALID');
    }
    await signedRaw(o, { ...device, key: wrongKey }, {}); // the 21st locks it
    const locked = await signedRaw(o, device, {}); // even a valid signature now
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    expect((await db.getModels().Device.findByPk(device.deviceId)).signatureLockedUntil).not.toBeNull();

    ctx.clock.advance(15 * 60 * 1000 + 1000);
    expect((await signedRaw(o, device, {})).status).toBe(200);
  });

  test("one member can't lock out another member's phone (their attempts count as an unknown device)", async () => {
    const limited = dbApp({ limiters: createAuthLimiters() });
    ctx = limited;
    const o = await owner();
    const ownerDevice = await o.phone.registerIn(o.businessId);
    const staffPhone = signupBody().phone;
    const added = await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: 'Staff', phone: staffPhone, role: 'manager' });
    const { agent: staff } = await signInAgent(ctx.app, ctx.config, staffPhone, added.body.temporaryPassword);
    await staff.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: 'manager-pass-2026' });
    await staff.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });

    const staffKey = await makeKey();
    for (let i = 0; i < 25; i += 1) {
      const headers = await signingHeaders({
        key: staffKey, deviceId: ownerDevice.deviceId, businessId: o.businessId, method: 'GET', pathWithQuery: '/api/devices', bodyText: '', signedAt: ctx.clock.now(),
      });
      const res = await staff.agent.get('/api/devices').set({ ...biz(o.businessId), ...headers });
      expect(res.body.error.code).toBe('DEVICE_NOT_REGISTERED');
    }
    expect((await db.getModels().Device.findByPk(ownerDevice.deviceId)).signatureLockedUntil).toBeNull();
    expect((await signedRaw(o, ownerDevice, {})).status).toBe(200);
  });
});

describe('the owner\'s phone list and removing members', () => {
  test('lists phones, revokes one (once), and staff can\'t do either', async () => {
    const o = await owner();
    const device = await o.phone.registerIn(o.businessId);
    const list = await o.phone.get('/api/devices').set(biz(o.businessId));
    expect(list.body.devices).toEqual([expect.objectContaining({
      deviceId: device.deviceId, deviceCode: device.deviceCode, isActive: true, person: { userId: o.userId, name: 'Ama Mensah' },
    })]);

    const extra = await registrationBody(o, await makeKey());
    await register(o, extra);
    expect((await o.phone.delete(`/api/devices/${extra.deviceId}`).set(biz(o.businessId))).body.device.isActive).toBe(false);
    expect((await o.phone.delete(`/api/devices/${extra.deviceId}`).set(biz(o.businessId))).body.error.code).toBe('DEVICE_ALREADY_REVOKED');

    const staffPhone = signupBody().phone;
    const added = await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: 'Staff', phone: staffPhone, role: 'manager' });
    const { agent: staff } = await signInAgent(ctx.app, ctx.config, staffPhone, added.body.temporaryPassword);
    await staff.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: 'manager-pass-2026' });
    staff.setPassword('manager-pass-2026');
    await staff.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    expect((await staff.get('/api/devices').set(biz(o.businessId))).body.error.code).toBe('FORBIDDEN');
    expect((await staff.delete(`/api/devices/${device.deviceId}`).set(biz(o.businessId))).body.error.code).toBe('FORBIDDEN');
  });

  test("removing a member revokes their phones for this business, in the same step", async () => {
    const o = await owner();
    const staffPhone = signupBody().phone;
    const added = await o.phone.post('/api/team').set(biz(o.businessId)).send({ name: 'Staff', phone: staffPhone, role: 'manager' });
    const { agent: staff } = await signInAgent(ctx.app, ctx.config, staffPhone, added.body.temporaryPassword);
    await staff.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: 'manager-pass-2026' });
    staff.setPassword('manager-pass-2026');
    await staff.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    const staffDevice = await staff.registerIn(o.businessId);
    expect(staffDevice).not.toBeNull();

    await o.phone.delete(`/api/team/${added.body.member.membershipId}`).set(biz(o.businessId));
    const after = await db.getModels().Device.findByPk(staffDevice.deviceId);
    expect(after).toMatchObject({ isActive: false, revokedBy: o.userId });
  });
});
