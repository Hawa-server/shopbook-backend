// Phones (devices), BE5 Part A:
// - POST /api/devices/challenge and POST /api/devices: registering THIS phone
//   for a business (the two "device bootstrap" endpoints: a phone can't sign
//   before it has a registered key, so these are the only business endpoints
//   that aren't signed; they're protected by the password and proof of key);
// - GET /api/devices and DELETE /api/devices/:deviceId: the owner's phone
//   list, and revoking a lost or stolen phone (signed, owner only).

const { z } = require('zod');
const { AppError } = require('../lib/errors');
const { parseBody, fieldRules } = require('../lib/validation');
const { verifyPassword } = require('../lib/passwords');
const { publicKeyFromJwk, verifySignature } = require('../lib/deviceSigning');
const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { requireDevice } = require('../middleware/requireDevice');
const { scoped } = require('../services/scoped');
const devices = require('../services/devices');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Counts one hit on each listed limiter and throws 429 when one is over.
function limitAll(pairs, res) {
  for (const [limiter, key] of pairs) {
    const { allowed, retryAfterSeconds } = limiter.consume(key);
    if (!allowed) {
      res.set('Retry-After', String(retryAfterSeconds));
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
    }
  }
}

// How a phone looks in the owner's list.
function deviceView(d) {
  return {
    deviceId: d.id,
    deviceCode: d.deviceCode,
    name: d.name,
    person: { userId: d.userId, name: d.user?.name ?? null },
    isActive: d.isActive,
    lastSeenAt: d.lastSeenAt ?? null,
    lastSyncAt: d.lastSyncAt ?? null,
    lockedUntil: d.signatureLockedUntil ?? null,
    registeredAt: d.createdAt,
    revokedAt: d.revokedAt ?? null,
  };
}

// POST /api/devices/challenge: a one-time challenge (32 random bytes,
// valid 5 minutes) for this person to sign with their phone's new key.
function challenge(deps) {
  return async function handleChallenge(req, res) {
    limitAll([[deps.limiters.deviceChallengeByUser, `user:${req.user.id}`]], res);
    const models = deps.getModels();
    const now = new Date(deps.now());
    const issued = await deps.runTransaction((transaction) => devices.issueChallenge(models, transaction, {
      businessId: req.business.id, userId: req.user.id, now,
    }));
    res.json({ challenge: issued.challenge, expiresAt: issued.expiresAt });
  };
}

// POST /api/devices: registers this phone. Needs the current password, the
// public key, and the challenge signed with the matching private key (proof
// the phone really holds it). A stolen cookie alone can't add a key.
function register(deps) {
  const schema = z.object({
    deviceId: z.string({ error: 'Missing device ID.' }).trim().toLowerCase().regex(UUID, 'The device ID must be a UUID.'),
    name: fieldRules.name("this phone's name"),
    publicKey: z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string() }).passthrough(),
    challenge: z.string({ error: 'Missing challenge.' }).min(1).max(100),
    challengeSignature: z.string({ error: 'Missing signature.' }).min(1).max(200),
    currentPassword: fieldRules.password(),
  });

  return async function handleRegister(req, res) {
    limitAll([
      [deps.limiters.deviceRegisterByUser, `user:${req.user.id}`],
      [deps.limiters.deviceRegisterByIp, `ip:${req.ip}`],
    ], res);
    const body = parseBody(schema, req.body);

    // A wrong password counts towards the sign-in limit for this person.
    limitAll([[deps.limiters.signinByLogin, `login:${req.user.phone}`]], res);
    if (!(await verifyPassword(req.user.passwordHash, body.currentPassword))) {
      throw new AppError(400, 'WRONG_PASSWORD', "That's not your current password.", { currentPassword: "That's not your current password." });
    }
    if (!publicKeyFromJwk(body.publicKey)) {
      throw new AppError(400, 'DEVICE_KEY_INVALID', "This phone's key isn't a valid P-256 public key.");
    }
    if (!verifySignature(body.publicKey, body.challenge, body.challengeSignature)) {
      throw new AppError(400, 'DEVICE_KEY_INVALID', "The challenge wasn't signed by this phone's key.");
    }

    const models = deps.getModels();
    const now = new Date(deps.now());
    const device = await deps.runTransaction((transaction) => devices.registerDevice(models, transaction, {
      businessId: req.business.id, userId: req.user.id, deviceId: body.deviceId, name: body.name,
      publicKey: body.publicKey, challenge: body.challenge, now,
    }));

    // Tell the owner (after the commit). The answer doesn't depend on it.
    const s = scoped(req, models);
    const owner = await s.Membership.findOne({ where: { role: 'owner', isActive: true }, include: [{ model: models.User, as: 'user' }] });
    const settings = await s.BusinessSettings.findOne();
    if (owner?.user?.email) {
      await deps.email.sendEmail({
        to: owner.user.email, template: 'device_added', language: owner.user.language, userId: owner.user.id,
        data: { name: owner.user.name, deviceName: device.name, personName: req.user.name, businessName: settings?.businessName ?? '' },
      });
    }
    res.status(201).json({ device: { deviceId: device.id, deviceCode: device.deviceCode, name: device.name } });
  };
}

// GET /api/devices: every phone of this business, active and revoked.
function listDevices(deps) {
  return async function handleList(req, res) {
    const models = deps.getModels();
    const rows = await scoped(req, models).Device.findAll({
      include: [{ model: models.User, as: 'user' }],
      order: [['createdAt', 'ASC']],
    });
    res.json({ devices: rows.map(deviceView) });
  };
}

// DELETE /api/devices/:deviceId: revokes one phone of this business (lost
// or stolen). Its next request gets 403 DEVICE_REVOKED and the phone wipes
// this business's data. The person can register a new phone.
function revokeDevice(deps) {
  return async function handleRevoke(req, res) {
    const deviceId = String(req.params.deviceId).toLowerCase();
    if (!UUID.test(deviceId)) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const models = deps.getModels();
    const s = scoped(req, models);
    const existing = await s.Device.findOne({ where: { id: deviceId } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Not found');
    if (!existing.isActive) throw new AppError(409, 'DEVICE_ALREADY_REVOKED', 'This phone has already been removed.');
    const now = new Date(deps.now());
    await deps.runTransaction((transaction) => devices.revokeDevices(models, transaction, {
      businessId: req.business.id, where: { id: deviceId }, revokedBy: req.user.id, now,
    }));
    const device = await s.Device.findOne({ where: { id: deviceId }, include: [{ model: models.User, as: 'user' }] });
    res.json({ device: deviceView(device) });
  };
}

// The device bootstrap endpoints are the only business endpoints that are
// NOT signed (listed in tests/codeRules.test.js); the others are.
const deviceRoutes = [
  { method: 'POST', path: '/api/devices/challenge', business: true, signed: false, build: (d) => [requireSession(d), requireAuth(d), challenge(d)] },
  { method: 'POST', path: '/api/devices', business: true, signed: false, build: (d) => [requireSession(d), requireAuth(d), register(d)] },
  { method: 'GET', path: '/api/devices', business: true, signed: true, build: (d) => [requireSession(d), requireAuth(d), requireDevice(d), requireRole('owner'), listDevices(d)] },
  { method: 'DELETE', path: '/api/devices/:deviceId', business: true, signed: true, build: (d) => [requireSession(d), requireAuth(d), requireDevice(d), requireRole('owner'), revokeDevice(d)] },
];

module.exports = { deviceRoutes, deviceView };
