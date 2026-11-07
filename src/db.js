// The one database connection pool for the server, the models, the quick
// check that /api/health uses, and runTransaction: the ONLY place in the code
// that opens a database transaction (BE5's runOperation is built on it).

const { Sequelize } = require('sequelize');
const { getConfig } = require('./config/env');
const { buildDbOptions } = require('./config/database');
const { defineModels } = require('./models');
const { AppError } = require('./lib/errors');

let sequelize;
let models;

// Returns the shared Sequelize instance, creating it the first time. Created
// lazily so that tests which never touch the database don't need one.
function getSequelize() {
  if (!sequelize) sequelize = new Sequelize(buildDbOptions(getConfig()));
  return sequelize;
}

// Returns the models (User, Business, …), defining them the first time.
function getModels() {
  if (!models) models = defineModels(getSequelize());
  return models;
}

// MySQL's answers for "this transaction lost a lock fight; try again":
// a deadlock (1213) and a lock wait timeout (1205).
const RETRYABLE_ERRNOS = new Set([1213, 1205]);
const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

// True if `err` is a deadlock or lock wait timeout, which are safe to retry
// because MySQL has already rolled the whole transaction back.
function isRetryableLockError(err) {
  const original = err?.original ?? err?.parent ?? err;
  return RETRYABLE_ERRNOS.has(original?.errno) || RETRYABLE_CODES.has(original?.code);
}

// Runs `fn(transaction)` inside one database transaction: everything `fn`
// writes is saved together when it returns, or nothing is saved if it throws.
// Every query inside must pass `{ transaction }` to be part of it.
//
// MySQL may end a transaction to break a deadlock, or give up waiting for a
// lock. Both are temporary: the transaction is retried up to `retries` times
// (3) after a short random wait, so two requests that collided don't collide
// again in step. After that it's answered 503 TRY_AGAIN (temporary: the
// phone retries later), never treated as a permanent rejection.
// `wait` can be replaced in tests.
async function runTransaction(fn, { retries = 3, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getSequelize().transaction((transaction) => fn(transaction));
    } catch (err) {
      if (!isRetryableLockError(err)) throw err;
      if (attempt >= retries) {
        throw new AppError(503, 'TRY_AGAIN', 'The server is busy. Please try again in a moment.');
      }
      await wait(20 + Math.floor(Math.random() * 80) * (attempt + 1));
    }
  }
}

// Runs `fn` inside a SAVEPOINT of an open transaction: if `fn` throws, only
// what it wrote since the savepoint is undone, and the outer transaction goes
// on. runOperation uses it so a rejected operation's partial writes vanish
// while its rejection is still stored in the same transaction.
function withSavepoint(transaction, fn) {
  return getSequelize().transaction({ transaction }, (savepoint) => fn(savepoint));
}

// Answers true if MySQL replies to `SELECT 1` within `timeoutMs`, else false.
// Never throws and never returns the error itself: health answers only
// "ok" or "down", so hostnames and error messages can't leak.
async function checkDatabase(timeoutMs = 3000) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
    });
    await Promise.race([getSequelize().query('SELECT 1'), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Closes the pool (on shutdown and at the end of tests) so the process can exit.
async function closeDatabase() {
  if (sequelize) {
    await sequelize.close();
    sequelize = undefined;
    models = undefined;
  }
}

module.exports = { getSequelize, getModels, runTransaction, withSavepoint, isRetryableLockError, checkDatabase, closeDatabase };
