// Logging: one JSON line per request with the expected fields, and never a
// body, cookie, password, token, email or query string, even when a request
// carries them.

const request = require('supertest');
const { createLogger, scrub } = require('../src/lib/logger');
const { testApp } = require('./helpers/testApp');

describe('request log', () => {
  test('one JSON line per request with the expected fields', async () => {
    const { app, lines } = testApp();
    const res = await request(app).get('/api/health');
    const entries = lines.map((line) => JSON.parse(line)).filter((entry) => entry.event === 'request');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      requestId: res.headers['x-request-id'],
      method: 'GET',
      path: '/api/health',
      status: 200,
    });
    expect(typeof entries[0].durationMs).toBe('number');
    expect(typeof entries[0].time).toBe('string');
  });

  test('bodies, cookies, headers and query strings never reach the log', async () => {
    const { app, lines } = testApp();
    await request(app)
      .post('/api/anything?token=query-secret-123')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', 'session=cookie-secret-456')
      .send({ password: 'body-secret-789', email: 'ama@example.com', phone: '+233241234567' });

    const text = lines.join('\n');
    for (const secret of ['query-secret-123', 'cookie-secret-456', 'body-secret-789', 'ama@example.com', '+233241234567']) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('logger safety net', () => {
  test('blocked keys are replaced at any depth', () => {
    expect(scrub({ userId: 'u1', password: 'x', nested: { Token: 'y', ok: 1 } })).toEqual({
      userId: 'u1',
      password: '[removed]',
      nested: { Token: '[removed]', ok: 1 },
    });
  });

  test('lines below the level are not written', () => {
    const lines = [];
    const logger = createLogger({ level: 'warn', write: (line) => lines.push(line) });
    logger.info('ignored');
    logger.warn('kept');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).event).toBe('kept');
  });
});
