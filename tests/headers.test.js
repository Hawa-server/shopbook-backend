// Headers on every response: a fresh X-Request-Id, the security headers (HSTS
// only in production), no X-Powered-By, and CORS only for CLIENT_URL.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { testApp, testConfig, CLIENT_URL } = require('./helpers/testApp');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('response headers', () => {
  test('every response has its own X-Request-Id, including errors', async () => {
    const { app } = testApp();
    const ok = await request(app).get('/api/health');
    const missing = await request(app).get('/api/missing');
    expect(ok.headers['x-request-id']).toMatch(UUID);
    expect(missing.headers['x-request-id']).toMatch(UUID);
    expect(ok.headers['x-request-id']).not.toBe(missing.headers['x-request-id']);
  });

  test('a request ID sent by the client is ignored', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health').set('X-Request-Id', 'chosen-by-client');
    expect(res.headers['x-request-id']).not.toBe('chosen-by-client');
  });

  test('security headers are present and X-Powered-By is not', async () => {
    const { app } = testApp();
    for (const res of [await request(app).get('/api/health'), await request(app).get('/api/missing')]) {
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeUndefined(); // not in test
    }
  });

  test('HSTS is sent in production', async () => {
    // Production requires a CA certificate path that exists; any file will do here.
    const ca = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shopbook-')), 'ca.pem');
    fs.writeFileSync(ca, 'test');
    const { app } = testApp({ config: testConfig({ NODE_ENV: 'production', DB_SSL_CA_PATH: ca, TRUST_PROXY: '1' }) });
    const res = await request(app).get('/api/health');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  test('CORS allows CLIENT_URL, with credentials', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health').set('Origin', CLIENT_URL);
    expect(res.headers['access-control-allow-origin']).toBe(CLIENT_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('CORS gives a foreign origin nothing', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('a preflight from CLIENT_URL is answered and allows X-Requested-With', async () => {
    const { app } = testApp();
    const res = await request(app)
      .options('/api/anything')
      .set('Origin', CLIENT_URL)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Requested-With/);
  });
});
