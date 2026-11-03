// CSRF layers: a state-changing request without X-Requested-With, or with a
// foreign Origin, is refused with 403 before reaching any route; the right
// header and origin pass through (to 404 here, as no POST routes exist yet).
// Also the stricter requireOrigin check used by account endpoints from BE2.

const express = require('express');
const request = require('supertest');
const { requireOrigin } = require('../src/middleware/csrf');
const { errorHandler } = require('../src/middleware/errorHandler');
const { createLogger } = require('../src/lib/logger');
const { testApp, testConfig, CLIENT_URL } = require('./helpers/testApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('X-Requested-With and Origin on state-changing requests', () => {
  test.each(['post', 'put', 'patch', 'delete'])('%s without X-Requested-With is 403 CSRF_HEADER_MISSING', async (method) => {
    const { app } = testApp();
    const res = await request(app)[method]('/api/anything');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });

  test('a POST from a foreign Origin is 403 ORIGIN_NOT_ALLOWED', async () => {
    const { app } = testApp();
    const res = await request(app).post('/api/anything').set(XHR).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('a POST with the header and the app Origin passes the check', async () => {
    const { app } = testApp();
    const res = await request(app).post('/api/anything').set(XHR).set('Origin', CLIENT_URL);
    expect(res.status).toBe(404); // reached "not found", so the CSRF check let it through
  });

  test('a POST with the header and no Origin passes (Origin is checked when present)', async () => {
    const { app } = testApp();
    const res = await request(app).post('/api/anything').set(XHR);
    expect(res.status).toBe(404);
  });

  test('a GET needs neither header', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });

  test('the local development address is refused outside development', async () => {
    const { app } = testApp();
    const res = await request(app).post('/api/anything').set(XHR).set('Origin', 'http://localhost:5173');
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('the local development address is allowed in development', async () => {
    const { app } = testApp({ config: testConfig({ NODE_ENV: 'development' }) });
    const res = await request(app).post('/api/anything').set(XHR).set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(404);
  });
});

describe('requireOrigin (account endpoints, from BE2)', () => {
  // A tiny app with one route behind requireOrigin.
  function appWith(config) {
    const app = express();
    app.post('/account', requireOrigin(config), (req, res) => res.json({ ok: true }));
    app.use(errorHandler({ logger: createLogger({ level: 'silent' }) }));
    return app;
  }

  test('a missing Origin is 403 ORIGIN_REQUIRED outside development', async () => {
    const res = await request(appWith(testConfig())).post('/account');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_REQUIRED');
  });

  test('a missing Origin is allowed in development (Postman)', async () => {
    const res = await request(appWith(testConfig({ NODE_ENV: 'development' }))).post('/account');
    expect(res.status).toBe(200);
  });

  test('a foreign Origin is refused even in development', async () => {
    const res = await request(appWith(testConfig({ NODE_ENV: 'development' }))).post('/account').set('Origin', 'https://evil.example');
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('the app Origin is allowed', async () => {
    const res = await request(appWith(testConfig())).post('/account').set('Origin', CLIENT_URL);
    expect(res.status).toBe(200);
  });
});
