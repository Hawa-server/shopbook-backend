// Helpers for tests that use the real test database: an app wired to it, a
// controllable clock, emptying the tables between test files, and quick ways
// to sign up an owner and read the links from the emails "sent".
//
// Emptying tables is allowed ONLY here, on the test database: resetDatabase
// refuses unless NODE_ENV=test and the database name ends in _test. App code
// never deletes (the only deletes are in deleteBusinessData, BE15/BE16).

const request = require('supertest');
const { getConfig } = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { createLogger } = require('../../src/lib/logger');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { createEmailSender } = require('../../src/lib/email');
const db = require('../../src/db');
const { testPhone } = require('./testPhone');
const { TERMS_VERSION } = require('../../src/legal');

// Every table, children first. Updated as migrations add tables.
const TABLES = ['ReceiptNumber', 'ProcessedOperation', 'SyncSequence', 'DeviceRequestNonce', 'DeviceChallenge', 'Device', 'ChangeLog', 'EmailToken', 'Membership', 'Location', 'BusinessSettings', 'Business', 'User'];

// Empties every table in the test database.
async function resetDatabase() {
  const config = getConfig();
  if (config.NODE_ENV !== 'test' || !config.DB_NAME.endsWith('_test')) {
    throw new Error('resetDatabase refuses: this is not the test database.');
  }
  const sequelize = db.getSequelize();
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) await sequelize.query(`TRUNCATE TABLE \`${table}\``);
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
}

// A clock the test moves by hand: clock.now() for the app, clock.advance(ms).
function createClock(start = Date.UTC(2026, 10, 3, 9, 0, 0)) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; }, set: (ms) => { time = ms; } };
}

// Builds an app on the test database. Rate limits are off unless `limiters`
// is given; the email sender keeps emails in memory (NODE_ENV=test).
function dbApp({ clock = createClock(), limiters = createAuthLimiters({ unlimited: true }), email, ...rest } = {}) {
  const config = getConfig();
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  const sender = email ?? createEmailSender({ config, logger });
  const app = createApp({
    config, logger, checkDatabase: db.checkDatabase, email: sender, limiters, now: clock.now, ...rest,
  });
  return { app, config, clock, lines, outbox: sender.sentInTests, deps: app.locals.deps };
}

// The headers the phone app sends on account endpoints.
function appHeaders(config) {
  return { 'X-Requested-With': 'XMLHttpRequest', Origin: config.CLIENT_URL };
}

let counter = 0;

// A valid sign-up body; each call gets its own phone number and email.
function signupBody(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(7, '0');
  return {
    name: 'Ama Mensah',
    phone: `024${n}`,
    email: `owner${counter}@example.test`,
    password: 'market-stall-2026',
    businessName: 'Ama Fabrics',
    language: 'en',
    acceptTerms: true,
    termsVersion: TERMS_VERSION,
    ...overrides,
  };
}

// Signs up an owner on a new test phone (a supertest agent that keeps the
// cookie like a browser, and signs business requests with its own device
// key, using the app's clock). Returns the phone, the body used and the response.
async function signUpOwner(app, config, overrides = {}) {
  const raw = request.agent(app);
  const body = signupBody(overrides);
  const res = await raw.post('/api/auth/signup').set(appHeaders(config)).send(body);
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent: testPhone(raw, { password: body.password, now: app.locals.deps.now }), body, res };
}

// Signs in on a NEW test phone with a login and password.
async function signInAgent(app, config, login, password) {
  const raw = request.agent(app);
  const res = await raw.post('/api/auth/signin').set(appHeaders(config)).send({ login, password });
  return { agent: testPhone(raw, { password, now: app.locals.deps.now }), res };
}

// The token from the newest email of a template sent to `to`.
function tokenFrom(outbox, template, to) {
  const email = [...outbox].reverse().find((e) => e.template === template && (!to || e.to === to));
  if (!email) throw new Error(`no ${template} email${to ? ` to ${to}` : ''}`);
  return decodeURIComponent(/token=([^\s&]+)/.exec(email.data.link)[1]);
}

module.exports = {
  resetDatabase, createClock, dbApp, appHeaders, signupBody, signUpOwner, signInAgent, tokenFrom, TABLES,
};
