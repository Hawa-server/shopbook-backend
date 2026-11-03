// The error format: unknown routes, bad JSON, bodies over 1 MB, and an
// unexpected error, which must never show its message, stack or SQL, only a
// reference matching the X-Request-Id header.

const request = require('supertest');
const { routes } = require('../src/routes');
const { testApp } = require('./helpers/testApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('error format', () => {
  test('an unknown route is 404 NOT_FOUND in the error format', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/nothing-here?x=1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  test('invalid JSON is 400 INVALID_JSON', async () => {
    const { app } = testApp();
    const res = await request(app).post('/api/nothing-here').set(XHR).set('Content-Type', 'application/json').send('{"broken": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('a body over 1 MB is 413 PAYLOAD_TOO_LARGE', async () => {
    const { app } = testApp();
    const big = JSON.stringify({ text: 'x'.repeat(1024 * 1024 + 10) });
    const res = await request(app).post('/api/nothing-here').set(XHR).set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('an unexpected error is 500 with a reference and no internal details', async () => {
    const boom = {
      method: 'GET',
      path: '/api/test-boom',
      build: () => [() => { throw new Error("secret: SELECT * FROM User WHERE phone='+233241234567'"); }],
    };
    const { app, lines } = testApp({ routes: [...routes, boom] });
    const res = await request(app).get('/api/test-boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: `Something went wrong. Reference: ${res.headers['x-request-id']}` },
    });
    expect(res.text).not.toMatch(/secret|SELECT|\+233|at /);

    // The details are in the server's log, under the same request ID.
    const logged = lines.map((line) => JSON.parse(line)).find((entry) => entry.event === 'unexpected_error');
    expect(logged.requestId).toBe(res.headers['x-request-id']);
  });

  test('a database error is logged without its message or SQL', async () => {
    const dbError = Object.assign(new Error("Duplicate entry '+233241234567' for key 'phone'"), {
      name: 'SequelizeUniqueConstraintError',
      sql: "INSERT INTO User (phone) VALUES ('+233241234567')",
      original: { code: 'ER_DUP_ENTRY' },
    });
    const boom = { method: 'GET', path: '/api/test-db-boom', build: () => [() => { throw dbError; }] };
    const { app, lines } = testApp({ routes: [...routes, boom] });
    await request(app).get('/api/test-db-boom');

    const logText = lines.join('\n');
    expect(logText).toContain('ER_DUP_ENTRY');
    expect(logText).not.toContain('+233241234567');
    expect(logText).not.toContain('INSERT INTO');
  });
});
