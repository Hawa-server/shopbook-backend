// The sync torture test's harness (BE5.5): a REAL local server (the app
// listening on a random port) and "phones" that talk to it over real HTTP,
// each with its own cookie, its own non-extractable signing key and its own
// clock offset, exactly like the app. Real HTTP lets a test cut a connection
// after the request was sent, so a response is really lost.
//
// Test-only operations live HERE, never in the real registry
// (src/sync/operations), and the server only has them because this file
// passes them to createApp. Their faults are switched on ONLY by the test
// code through the `faults` object below: never by a header, a query, a
// payload field or an environment variable.

const http = require('node:http');
const { randomUUID, randomBytes, createHash, webcrypto } = require('node:crypto');
const { z } = require('zod');
const { getConfig } = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { createLogger } = require('../../src/lib/logger');
const { createAuthLimiters } = require('../../src/routes/limiters');
const db = require('../../src/db');
const { operations: realOperations } = require('../../src/sync/operations');

const { subtle } = webcrypto;

// Fault switches, set by the tests themselves (plain variables, nothing else).
const faults = {
  failRemaining: 0, // test.failAt: how many more runs fail temporarily
  deadlocksRemaining: 0, // test.deadlockOnce: how many more runs hit a deadlock
  saleDeadlocksRemaining: 0, // test.saleDeadlockOnce: the same, for a real sale
};

// The test-only operations (all roles may send them).
const testOperations = {
  // Inserts a location through runOperation: the safe way to make many
  // synced rows before products exist.
  'test.addLocation': {
    roles: ['owner', 'manager', 'associate'],
    schema: z.object({ name: z.string().min(1).max(60) }),
    async handler(ctx, { name }) {
      const id = randomUUID();
      await ctx.s.Location.create({ id, name, type: 'shop' }, { transaction: ctx.transaction });
      ctx.stamp('Location', { id });
      return { id };
    },
  },
  // Like test.addLocation, but fails temporarily (as if the database went
  // away) while faults.failRemaining > 0, AFTER writing its row.
  'test.failAt': {
    roles: ['owner', 'manager', 'associate'],
    schema: z.object({ name: z.string().min(1).max(60) }),
    async handler(ctx, { name }) {
      const id = randomUUID();
      await ctx.s.Location.create({ id, name, type: 'shop' }, { transaction: ctx.transaction });
      if (faults.failRemaining > 0) {
        faults.failRemaining -= 1;
        throw Object.assign(new Error('connect ECONNREFUSED (simulated database stop)'), { name: 'SequelizeConnectionRefusedError' });
      }
      ctx.stamp('Location', { id });
      return { id };
    },
  },
  // The REAL sale.create (same schema, same handler), but MySQL "ends it to
  // break a deadlock" after the whole sale was written, while
  // faults.saleDeadlocksRemaining > 0. runTransaction retries it; the sale
  // must exist exactly once (one registry row, one set of movements).
  'test.saleDeadlockOnce': {
    roles: ['owner', 'manager', 'associate'],
    get schema() { return realOperations['sale.create'].schema; },
    async handler(ctx, payload) {
      const result = await realOperations['sale.create'].handler(ctx, payload);
      if (faults.saleDeadlocksRemaining > 0) {
        faults.saleDeadlocksRemaining -= 1;
        throw Object.assign(new Error('Deadlock found (simulated)'), { original: { errno: 1213, code: 'ER_LOCK_DEADLOCK' } });
      }
      return result;
    },
  },
  // Like test.addLocation, but MySQL "ends it to break a deadlock" while
  // faults.deadlocksRemaining > 0 (runTransaction retries it).
  'test.deadlockOnce': {
    roles: ['owner', 'manager', 'associate'],
    schema: z.object({ name: z.string().min(1).max(60) }),
    async handler(ctx, { name }) {
      const id = randomUUID();
      await ctx.s.Location.create({ id, name, type: 'shop' }, { transaction: ctx.transaction });
      if (faults.deadlocksRemaining > 0) {
        faults.deadlocksRemaining -= 1;
        throw Object.assign(new Error('Deadlock found (simulated)'), { original: { errno: 1213, code: 'ER_LOCK_DEADLOCK' } });
      }
      ctx.stamp('Location', { id });
      return { id };
    },
  },
};

// Starts the app on a random port with the real registry plus the test-only
// operations. Returns { url, config, close, deps }.
// `withTestOperations: false` starts it exactly as production does (the real
// registry only), to prove the test-only types don't exist there.
async function startServer({ withTestOperations = true } = {}) {
  const config = getConfig();
  const app = createApp({
    config,
    logger: createLogger({ level: 'silent' }),
    checkDatabase: db.checkDatabase,
    limiters: createAuthLimiters({ unlimited: true }),
    ...(withTestOperations ? { operations: { ...realOperations, ...testOperations } } : {}),
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, config, deps: app.locals.deps,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

// One raw HTTP request. Returns { status, headers, body }. With
// `loseResponse`, the connection is destroyed as soon as the server starts
// answering: the server has done its work, but the phone never sees the answer.
function rawRequest(url, { method, path, headers, bodyText, loseResponse = false }) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}${path}`, { method, headers: { ...headers, ...(bodyText ? { 'Content-Length': Buffer.byteLength(bodyText) } : {}) } }, (res) => {
      if (loseResponse) {
        res.destroy();
        req.destroy();
        resolve({ lost: true });
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', (err) => (loseResponse ? resolve({ lost: true }) : reject(err)));
    if (bodyText) req.write(bodyText);
    req.end();
  });
}

// A phone: a cookie, a key per business, and a clock offset learned from
// X-Server-Time (like the app). `clockSkewMs` makes its own clock wrong.
class Phone {
  constructor(server, { clockSkewMs = 0 } = {}) {
    this.server = server;
    this.cookie = null;
    this.devices = new Map(); // businessId → { deviceId, privateKey }
    this.offset = 0;
    this.clockSkewMs = clockSkewMs;
  }

  // The phone's own (possibly wrong) clock, and the server-corrected one.
  ownClock() { return Date.now() + this.clockSkewMs; }

  signedAt() { return this.ownClock() + this.offset; }

  // Sends a request; keeps the cookie and learns the clock offset.
  async send({ method, path, business, body, sign = true, signing = {}, loseResponse = false }) {
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const headers = { 'X-Requested-With': 'XMLHttpRequest', Origin: this.server.config.CLIENT_URL };
    if (bodyText) headers['Content-Type'] = 'application/json';
    if (this.cookie) headers.Cookie = this.cookie;
    if (business) headers['X-Business'] = business;
    let signed = null;
    if (business && sign && this.devices.has(business)) {
      signed = await this.signHeaders({ method, path, business, bodyText, ...signing });
      Object.assign(headers, signed);
    }
    const res = await rawRequest(this.server.url, { method, path, headers, bodyText, loseResponse });
    if (!res.lost) {
      // The LAST sb_session wins, as in a browser (a refreshed sign-in can
      // send two: the old one, then the new one).
      const setCookie = res.headers['set-cookie']?.filter((c) => c.startsWith('sb_session=')).at(-1);
      if (setCookie) this.cookie = setCookie.split(';')[0];
      if (res.headers['x-server-time']) this.offset = Number(res.headers['x-server-time']) - this.ownClock();
    }
    return { ...res, signed, headers: res.headers, sentHeaders: headers, bodyText };
  }

  // Re-sends EXACTLY the same bytes and headers as an earlier request (a replay).
  replay(previous, { method, path }) {
    return rawRequest(this.server.url, { method, path, headers: previous.sentHeaders, bodyText: previous.bodyText });
  }

  // The four signing headers (server-corrected time, a new nonce each time).
  async signHeaders({ method, path, business, bodyText, signedAt, nonce }) {
    const { deviceId, privateKey } = this.devices.get(business);
    const usedNonce = nonce ?? randomBytes(16).toString('base64url');
    const time = signedAt ?? this.signedAt();
    const bodyHash = createHash('sha256').update(Buffer.from(bodyText, 'utf8')).digest('hex');
    const text = [method, path, bodyHash, deviceId, business, String(time), usedNonce].join('\n');
    const signature = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(text, 'utf8'))).toString('base64url');
    return { 'X-Device-Id': deviceId, 'X-Signed-At': String(time), 'X-Nonce': usedNonce, 'X-Signature': signature };
  }

  // Signs up an owner; returns the business ID.
  async signUp(body) {
    const res = await this.send({ method: 'POST', path: '/api/auth/signup', body });
    if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.password = body.password;
    return res.body.businesses[0].id;
  }

  // Signs in.
  async signIn(login, password) {
    const res = await this.send({ method: 'POST', path: '/api/auth/signin', body: { login, password } });
    this.password = password;
    return res;
  }

  // Registers this phone in a business (challenge, key, password).
  async register(business) {
    const challenge = await this.send({ method: 'POST', path: '/api/devices/challenge', business });
    if (challenge.status !== 200) throw new Error(`challenge failed: ${challenge.status} ${JSON.stringify(challenge.body)}`);
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const jwk = await subtle.exportKey('jwk', pair.publicKey);
    const signature = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(challenge.body.challenge, 'utf8'))).toString('base64url');
    const deviceId = randomUUID();
    const res = await this.send({
      method: 'POST', path: '/api/devices', business,
      body: { deviceId, name: 'Torture phone', publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, challenge: challenge.body.challenge, challengeSignature: signature, currentPassword: this.password },
    });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    this.devices.set(business, { deviceId, privateKey: pair.privateKey, deviceCode: res.body.device.deviceCode });
    return deviceId;
  }

  // Pushes operations (signed). `options.loseResponse` cuts the connection.
  push(business, operations, options = {}) {
    return this.send({ method: 'POST', path: '/api/sync/push', business, body: { deviceId: this.devices.get(business).deviceId, operations }, ...options });
  }

  // Pulls one page (signed).
  pull(business, since = 0, limit = 500) {
    return this.send({ method: 'GET', path: `/api/sync/pull?since=${since}&limit=${limit}`, business });
  }
}

// An operation envelope.
function op(type, payload, opId = randomUUID()) {
  return { opId, type, recordedOnline: true, payload };
}

module.exports = { startServer, Phone, op, faults, testOperations };
