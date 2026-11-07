// runOperation: how every pushed operation changes data (BE5 Part B). It's
// the heart of "never silently lose or duplicate a trader's money".
//
// One operation = one transaction (built on runTransaction, so a deadlock is
// retried up to 3 times), always in this order (the global lock order: the
// same order everywhere means two operations can't wait for each other in a
// circle):
//   1. RESERVE: insert the ProcessedOperation row for (businessId, opId)
//      first. Its unique key decides between two copies of the same
//      operation arriving together: the second waits, then finds it taken.
//   2. LOCK the business rows the operation reads, parent before child:
//      customer → sale → sale lines → products/sizes → reversal original →
//      settings (ctx.lock refuses a lock taken out of this order).
//   3. WRITE the records (unique reservations such as receipt numbers first).
//   4. (from BE9) rebuild the customer's balance.
//   5. SEQUENCE LAST: take the SyncSequence numbers (takeSequence) for every
//      synced row written, so the busiest row is held for the shortest time.
//   Then the ProcessedOperation row gets its final result, and it all commits.
//
// Outcomes:
// - a business-rule rejection (ctx.reject) is STORED: the handler's partial
//   writes are undone by a savepoint, the rejection is saved, so the same
//   operation always gets the same answer;
// - the same opId again, same device/type/payload → "duplicate" with the
//   stored answer; different → rejected OP_ID_CONFLICT; nothing applied;
// - a temporary failure (database down, deadlock after retries) rolls
//   EVERYTHING back, including the reservation, and is thrown: never stored
//   as a rejection, so the phone simply retries later.
//
// This file is the ONLY one allowed to lock rows (FOR UPDATE) and to touch
// SyncSequence (a test checks it).

const { createHash } = require('node:crypto');
const { runTransaction, withSavepoint } = require('../db');
const { scoped } = require('../services/scoped');

// The global lock order (ranks): a later lock may never come before an earlier one.
const LOCK_ORDER = ['customer', 'sale', 'saleLines', 'products', 'reversal', 'settings'];

// Thrown by a handler (through ctx.reject) for a business-rule failure.
class OperationRejected extends Error {
  constructor(code, message, fields) {
    super(message);
    this.name = 'OperationRejected';
    this.code = code;
    if (fields) this.fields = fields;
  }

  // The error part of the stored and returned result.
  toError() {
    return { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) };
  }
}

// Signals (inside the transaction) that this opId was already processed.
class AlreadyProcessed extends Error {}

// JSON with object keys sorted, so the same payload always gives the same
// text (and hash), whatever order the phone sent its fields in.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// SHA-256 of the VALIDATED, normalised operation (type + payload).
function payloadHashOf(type, payload) {
  return createHash('sha256').update(stableStringify({ type, payload })).digest('hex');
}

// ---- Sequence numbers -------------------------------------------------------

// Creates a new business's counter (at sign-up), inside `transaction`.
function startSequence(models, transaction, businessId) {
  return models.SyncSequence.create({ businessId, lastSeq: 0 }, { transaction });
}

// Takes the next `count` numbers of this business's counter, inside
// `transaction`, locking its row until the commit. ALWAYS the last step of a
// transaction: the counter is the busiest row, so it's held the shortest.
async function takeSequence(models, transaction, businessId, count) {
  const row = await models.SyncSequence.findOne({ where: { businessId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!row) throw new Error('This business has no SyncSequence row');
  const first = Number(row.lastSeq) + 1;
  await models.SyncSequence.update({ lastSeq: Number(row.lastSeq) + count }, { where: { businessId }, transaction });
  return Array.from({ length: count }, (_, i) => first + i);
}

// The business's current lastSeq, for a pull's watermark: a plain read (no
// lock, nothing written).
async function readWatermark(models, businessId) {
  const row = await models.SyncSequence.findOne({ where: { businessId }, attributes: ['lastSeq'] });
  return row ? Number(row.lastSeq) : 0;
}

// Gives each listed synced row a NEW sequence number (an inserted or changed
// row must be pulled again by every phone). `rows`: [{ model, where }].
// Uses takeSequence, so it too must be the last step.
async function stampSequence(models, transaction, businessId, rows) {
  if (rows.length === 0) return;
  const numbers = await takeSequence(models, transaction, businessId, rows.length);
  for (const [i, { model, where }] of rows.entries()) {
    await models[model].update({ serverSeq: numbers[i] }, { where: { ...where, businessId }, transaction });
  }
}

// ---- One operation ------------------------------------------------------------

// Runs one pushed operation (see the top of this file). `context` holds the
// chosen business, user, membership and device (from requireAuth and
// requireDevice); `definition` is the operation type's { roles, handler }.
// Returns { status: 'saved'|'duplicate'|'rejected', result?, error? }.
async function runOperation(deps, { context, opId, type, payload, definition }) {
  const models = deps.getModels();
  const { business, user, membership, device } = context;
  const businessId = business.id;
  const payloadHash = payloadHashOf(type, payload);
  const now = new Date(deps.now());

  try {
    return await runTransaction(async (transaction) => {
      // 1. Reserve the opId (its unique key decides between copies).
      try {
        await models.ProcessedOperation.create({
          businessId, opId, deviceId: device.id, userId: user.id, type, payloadHash, status: 'pending', processedAt: now,
        }, { transaction });
      } catch (err) {
        if (err?.name === 'SequelizeUniqueConstraintError') throw new AlreadyProcessed();
        throw err;
      }

      const finish = (status, result, errorCode = null) => models.ProcessedOperation.update(
        { status, resultJson: result, errorCode },
        { where: { businessId, opId }, transaction },
      );

      // The role is checked against the membership requireAuth re-read now.
      if (!definition.roles.includes(membership.role)) {
        const error = new OperationRejected('FORBIDDEN', "Your role can't do this.").toError();
        await finish('rejected', { error }, error.code);
        return { status: 'rejected', error };
      }

      // 2–3. Locks and writes, inside a savepoint (undone if rejected).
      const stamps = [];
      let result;
      try {
        result = await withSavepoint(transaction, (savepoint) => definition.handler(
          makeContext({ models, transaction: savepoint, business, user, membership, device, now, stamps }),
          payload,
        ));
      } catch (err) {
        if (!(err instanceof OperationRejected)) throw err;
        const error = err.toError();
        await finish('rejected', { error }, error.code);
        return { status: 'rejected', error };
      }

      // 5. Sequence numbers last, then the final result.
      await stampSequence(models, transaction, businessId, stamps);
      await finish('saved', { result: result ?? {} });
      return { status: 'saved', result: result ?? {} };
    });
  } catch (err) {
    if (!(err instanceof AlreadyProcessed)) throw err;
    return answerRepeat(models, { businessId, opId, deviceId: device.id, type, payloadHash });
  }
}

// The answer for an opId that was already processed (committed): the stored
// answer if it's really the same operation, otherwise OP_ID_CONFLICT (a bug
// in the phone: two different things sent with one ID). Nothing is applied.
async function answerRepeat(models, { businessId, opId, deviceId, type, payloadHash }) {
  const stored = await models.ProcessedOperation.findOne({ where: { businessId, opId } });
  if (stored && stored.deviceId === deviceId && stored.type === type && stored.payloadHash === payloadHash) {
    if (stored.status === 'rejected') return { status: 'rejected', error: stored.resultJson.error };
    return { status: 'duplicate', result: stored.resultJson.result };
  }
  return {
    status: 'rejected',
    error: { code: 'OP_ID_CONFLICT', message: 'This operation ID was already used for something else. Tell the developer.' },
  };
}

// What a handler receives: the transaction, the business's scoped models,
// who is doing it, and three tools: lock (in the global order), stamp (this
// synced row was inserted or changed) and reject (a business-rule failure).
function makeContext({ models, transaction, business, user, membership, device, now, stamps }) {
  let lastRank = -1;
  return {
    models,
    transaction,
    s: scoped({ business }, models),
    business,
    user,
    membership,
    device,
    now,
    // Locks rows of a business model (FOR UPDATE) as step `kind` of the
    // global order; refuses to go backwards in that order.
    async lock(kind, model, where) {
      const rank = LOCK_ORDER.indexOf(kind);
      if (rank === -1) throw new Error(`Unknown lock kind: ${kind}`);
      if (rank < lastRank) throw new Error(`Lock order broken: ${kind} after ${LOCK_ORDER[lastRank]}`);
      lastRank = rank;
      return models[model].findAll({ where: { ...where, businessId: business.id }, transaction, lock: transaction.LOCK.UPDATE });
    },
    stamp(model, where) {
      stamps.push({ model, where });
    },
    reject(code, message, fields) {
      throw new OperationRejected(code, message, fields);
    },
  };
}

module.exports = {
  runOperation, takeSequence, stampSequence, startSequence, readWatermark, payloadHashOf, stableStringify, OperationRejected, LOCK_ORDER,
};
