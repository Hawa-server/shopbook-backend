// The sync endpoints (BE5 Part B): POST /api/sync/push and GET /api/sync/pull.
// Both are business endpoints, signed by the phone's key, for every role
// (each operation and each pull row is then checked against the role).
// Phones push first, then pull, so their own records come back with server
// sequence numbers.

const { z } = require('zod');
const { AppError } = require('../lib/errors');
const { parseBody } = require('../lib/validation');
const { requireSession } = require('../lib/session');
const { requireAuth } = require('../middleware/requireAuth');
const { requireDevice } = require('../middleware/requireDevice');
const { processPush, MAX_OPERATIONS } = require('../sync/push');
const { pullPage, MAX_LIMIT } = require('../sync/pull');
const { operations: defaultOperations } = require('../sync/operations');
const { touchLastSync } = require('../services/devices');

// Counts one sync request towards 120 per 15 minutes per person.
function syncLimit(deps) {
  return function limitSync(req, res, next) {
    const { allowed, retryAfterSeconds } = deps.limiters.syncByUser.consume(`user:${req.user.id}`);
    if (allowed) return next();
    res.set('Retry-After', String(retryAfterSeconds));
    return next(new AppError(429, 'RATE_LIMITED', 'Too many sync requests. The app will try again shortly.'));
  };
}

// POST /api/sync/push: { deviceId, operations: [{ opId, type, recordedOnline, payload }] }.
function push(deps) {
  const schema = z.object({
    deviceId: z.string().trim().toLowerCase(),
    operations: z.array(z.unknown()).max(MAX_OPERATIONS, `At most ${MAX_OPERATIONS} operations per push.`),
  });
  return async function handlePush(req, res) {
    const body = parseBody(schema, req.body);
    if (body.deviceId !== req.device.id) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', { deviceId: 'This is not the device that signed the request.' });
    }
    const context = { business: req.business, user: req.user, membership: req.membership, device: req.device };
    const results = await processPush({ ...deps, operations: deps.operations ?? defaultOperations }, context, body.operations);
    await touchLastSync(deps, req.device);
    res.json({ results, serverTime: new Date(deps.now()).toISOString() });
  };
}

// GET /api/sync/pull?since=<cursor>&limit=<1..500>.
function pull(deps) {
  const schema = z.object({
    since: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(MAX_LIMIT),
  });
  return async function handlePull(req, res) {
    const query = parseBody(schema, req.query);
    const page = await pullPage(deps, req, query);
    await touchLastSync(deps, req.device);
    res.json(page);
  };
}

const signedMember = (d) => [requireSession(d), requireAuth(d), requireDevice(d), syncLimit(d)];

const syncRoutes = [
  { method: 'POST', path: '/api/sync/push', business: true, signed: true, build: (d) => [...signedMember(d), push(d)] },
  { method: 'GET', path: '/api/sync/pull', business: true, signed: true, build: (d) => [...signedMember(d), pull(d)] },
];

module.exports = { syncRoutes };
