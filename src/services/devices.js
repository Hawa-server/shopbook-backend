// Phones (devices) and their signed requests (BE5 Part A).
//
// Registering a phone (enrolment) is the one moment a stolen cookie could be
// turned into a trusted device, so it needs more than a sign-in: the current
// password, plus proof that the phone holds its new private key (it signs a
// one-time challenge). After that, every business request is signed by that
// key, and checkSignedRequest() verifies it before anything else happens.

const { randomUUID, randomBytes, randomInt } = require('node:crypto');
const { Op } = require('sequelize');
const { AppError } = require('../lib/errors');
const { hashToken, sameHash } = require('../lib/tokens');
const { sha256Hex, signingText, verifySignature } = require('../lib/deviceSigning');
const { deleteExpiredNonces } = require('./housekeeping');
const { recordChange } = require('./changeLog');
const { stampSequence } = require('../sync/runOperation');

const MINUTE = 60 * 1000;
const CHALLENGE_LIFETIME_MS = 5 * MINUTE;
const CLOCK_TOLERANCE_MS = 5 * MINUTE;
const NONCE_LIFETIME_MS = 10 * MINUTE;
const LAST_SEEN_EVERY_MS = 5 * MINUTE;
const LOCKOUT_MS = 15 * MINUTE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 29 letters and digits that can't be mistaken for each other (no 0/O, 1/I/L,
// 5/S, 8/B): 29 × 29 × 29 = 24,389 three-character codes per business.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ234679';
const THREE_CHARACTER_CODES = CODE_ALPHABET.length ** 3;

// The errors a signed request can get (see api.md for what the app does).
const errors = {
  notRegistered: () => new AppError(403, 'DEVICE_NOT_REGISTERED', "This phone isn't registered for this business."),
  revoked: () => new AppError(403, 'DEVICE_REVOKED', 'This phone has been removed from this business.'),
  invalid: () => new AppError(401, 'DEVICE_SIGNATURE_INVALID', "This phone couldn't prove who it is."),
  clock: () => new AppError(401, 'CLOCK_OUT_OF_RANGE', "This phone's clock is too far from the server's. Use the time in X-Server-Time."),
  nonce: () => new AppError(401, 'NONCE_REUSED', 'This request was already used.'),
};

// ---- Registration --------------------------------------------------------

// Makes a one-time challenge for this person in this business, inside
// `transaction`: 32 random bytes the phone must sign with its new key. Only
// the SHA-256 is stored; it lasts 5 minutes and works once.
async function issueChallenge(models, transaction, { businessId, userId, now }) {
  const challenge = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + CHALLENGE_LIFETIME_MS);
  await models.DeviceChallenge.create({
    id: randomUUID(), businessId, userId, challengeHash: hashToken(challenge), expiresAt, createdAt: now,
  }, { transaction });
  return { challenge, expiresAt };
}

// Uses up a challenge, inside `transaction`: it must be this person's, in
// this business, unused and not expired. One conditional UPDATE makes it work
// exactly once, even if two registrations race. Returns true if claimed.
async function claimChallenge(models, transaction, { businessId, userId, challenge, now }) {
  const challengeHash = hashToken(challenge);
  const row = await models.DeviceChallenge.findOne({
    where: { challengeHash, businessId, userId, usedAt: null, expiresAt: { [Op.gt]: now } },
    transaction,
  });
  if (!row || !sameHash(row.challengeHash, challengeHash)) return false;
  const [changed] = await models.DeviceChallenge.update({ usedAt: now }, { where: { id: row.id, usedAt: null }, transaction });
  return changed === 1;
}

// Picks a device code not used before in this business (revoked phones keep
// theirs, so codes are never reused). Random, then checked; the unique key
// (businessId, deviceCode) is the final guard. 4 characters once half of the
// 3-character codes are taken.
async function pickDeviceCode(models, transaction, businessId) {
  const used = new Set((await models.Device.findAll({ where: { businessId }, attributes: ['deviceCode'], transaction })).map((d) => d.deviceCode));
  const length = used.size >= THREE_CHARACTER_CODES / 2 ? 4 : 3;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!used.has(code)) return code;
  }
  throw new Error('Could not find a free device code');
}

// Registers a phone, inside `transaction`, after the caller has checked the
// password, the key and the challenge's signature. Claims the challenge,
// refuses a device ID that already exists anywhere (a phone never swaps its
// key: a new key means a new device), gives the phone its code, and records
// it in the ChangeLog. Returns the new device.
async function registerDevice(models, transaction, { businessId, userId, deviceId, name, publicKey, challenge, now }) {
  if (!(await claimChallenge(models, transaction, { businessId, userId, challenge, now }))) {
    throw new AppError(400, 'CHALLENGE_INVALID', 'This registration has expired. Please try again.');
  }
  if (await models.Device.findByPk(deviceId, { transaction })) {
    throw new AppError(409, 'DEVICE_ID_TAKEN', 'This phone ID is already registered. Make a new one and try again.');
  }
  const deviceCode = await pickDeviceCode(models, transaction, businessId);
  const device = await models.Device.create({
    id: deviceId, businessId, userId, deviceCode, name, publicKey: { kty: 'EC', crv: 'P-256', x: publicKey.x, y: publicKey.y },
  }, { transaction });
  await recordChange(models, transaction, {
    businessId, entity: 'device', entityId: deviceId, changedBy: userId, changedAt: now, after: { status: 'active', deviceCode, name },
  });
  await stampSequence(models, transaction, businessId, [{ model: 'Device', where: { id: deviceId } }]);
  return device;
}

// Revokes devices of this business matching `where` (one phone, or all of a
// removed member's phones), inside `transaction`, and records each in the
// ChangeLog. A revoked phone's next request gets 403 DEVICE_REVOKED.
// Returns the revoked device IDs: the CALLER gives them new sequence numbers
// at the end of its transaction (stampSequence must be the last step).
async function revokeDevices(models, transaction, { businessId, where, revokedBy, now }) {
  const devices = await models.Device.findAll({ where: { ...where, businessId, isActive: true }, transaction });
  for (const device of devices) {
    await models.Device.update({ isActive: false, revokedAt: now, revokedBy }, { where: { id: device.id, businessId }, transaction });
    await recordChange(models, transaction, {
      businessId, entity: 'device', entityId: device.id, changedBy: revokedBy, changedAt: now,
      before: { status: 'active' }, after: { status: 'revoked' },
    });
  }
  return devices.map((d) => d.id);
}

// ---- Every signed request ---------------------------------------------------

// Checks a business request's signature, in this order (after the session and
// requireAuth have chosen the business):
//  1. the device: must exist, belong to THIS person in THIS business, and be
//     active; anything else is answered as an unknown device, so nobody can
//     probe other people's phones (or lock them out);
//  2. a lock-out after too many failed signatures (20 in 15 minutes);
//  3. the timestamp: within 5 minutes of the server's clock;
//  4. the signature itself (a failure counts towards the lock-out);
//  5. the nonce: recorded in its own short transaction, committed BEFORE the
//     request's work, so two copies of one request can never both pass.
// Returns the device.
async function checkSignedRequest(deps, req) {
  const { getModels, runTransaction } = deps;
  const models = getModels();
  const now = deps.now();
  const deviceId = String(req.get('X-Device-Id') ?? '').trim().toLowerCase();
  if (!UUID.test(deviceId)) throw errors.notRegistered();

  const device = await models.Device.findOne({ where: { id: deviceId, businessId: req.business.id, userId: req.user.id } });
  if (!device) throw errors.notRegistered();
  if (!device.isActive) throw errors.revoked();
  if (device.signatureLockedUntil && device.signatureLockedUntil.getTime() > now) {
    throw lockedOut(Math.ceil((device.signatureLockedUntil.getTime() - now) / 1000));
  }

  const signedAtText = String(req.get('X-Signed-At') ?? '');
  const nonce = String(req.get('X-Nonce') ?? '');
  const signature = String(req.get('X-Signature') ?? '');
  if (!/^\d{1,16}$/.test(signedAtText) || !/^[A-Za-z0-9_-]{22}$/.test(nonce) || Buffer.from(nonce, 'base64url').length !== 16) {
    await countFailure(deps, models, device, now);
    throw errors.invalid();
  }
  const signedAt = Number(signedAtText);
  if (Math.abs(now - signedAt) > CLOCK_TOLERANCE_MS) throw errors.clock();

  const text = signingText({
    method: req.method,
    pathWithQuery: req.originalUrl,
    bodyHash: sha256Hex(req.rawBody),
    deviceId,
    businessId: req.business.id,
    signedAt,
    nonce,
  });
  if (!verifySignature(device.publicKey, text, signature)) {
    await countFailure(deps, models, device, now);
    throw errors.invalid();
  }

  try {
    await runTransaction(async (transaction) => {
      await deleteExpiredNonces(models, transaction, { businessId: req.business.id, deviceId, now: new Date(now) });
      await models.DeviceRequestNonce.create({
        businessId: req.business.id, deviceId, nonce, expiresAt: new Date(now + NONCE_LIFETIME_MS),
      }, { transaction });
    });
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') throw errors.nonce();
    throw err;
  }

  if (!device.lastSeenAt || now - device.lastSeenAt.getTime() >= LAST_SEEN_EVERY_MS) {
    await models.Device.update({ lastSeenAt: new Date(now) }, { where: { id: deviceId, businessId: req.business.id } });
  }
  return device;
}

// Records that this phone synced (push or pull), at most once every 5
// minutes, so busy phones don't write to their device row on every request.
async function touchLastSync(deps, device) {
  const now = deps.now();
  if (device.lastSyncAt && now - device.lastSyncAt.getTime() < LAST_SEEN_EVERY_MS) return;
  await deps.getModels().Device.update({ lastSyncAt: new Date(now) }, { where: { id: device.id, businessId: device.businessId } });
}

// The answer while a phone is locked out after too many failed signatures.
function lockedOut(retryAfterSeconds) {
  const err = new AppError(429, 'RATE_LIMITED', 'This phone is blocked for a few minutes after too many failed checks.');
  err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

// Counts one failed signature for THIS (already verified as the person's
// own) device. At 20 in 15 minutes the device is locked for 15 minutes, saved
// on the device so the owner sees it in the phone list.
async function countFailure(deps, models, device, now) {
  const { allowed } = deps.limiters.deviceSignatureFailures.consume(`device:${device.id}`);
  if (!allowed) {
    await models.Device.update(
      { signatureLockedUntil: new Date(now + LOCKOUT_MS) },
      { where: { id: device.id, businessId: device.businessId } },
    );
  }
}

module.exports = {
  issueChallenge, registerDevice, revokeDevices, checkSignedRequest, touchLastSync, CODE_ALPHABET, CHALLENGE_LIFETIME_MS,
};
