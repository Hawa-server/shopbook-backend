// GET /api/health: 200 "ok" against the real test database (from .env.test),
// and 503 "down" when the database doesn't answer, with nothing but
// status, database and version in the answer.

const request = require('supertest');
const { getConfig } = require('../src/config/env');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/lib/logger');
const { checkDatabase, closeDatabase } = require('../src/db');
const { version } = require('../package.json');
const { testApp } = require('./helpers/testApp');

describe('GET /api/health', () => {
  afterAll(() => closeDatabase());

  test('answers 200 ok with the real test database', async () => {
    // getConfig reads .env.test (loaded by `npm test`); if it's missing, this
    // fails with the list of missing variables.
    const app = createApp({ config: getConfig(), checkDatabase, logger: createLogger({ level: 'silent' }) });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok', version });
  });

  test('answers 503 down when the database does not answer', async () => {
    const { app } = testApp({ databaseUp: false });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'down', database: 'down', version });
  });

  test('a real check against an unreachable database says down, without details', async () => {
    // A complete, valid config whose port is 1 on localhost: nothing listens
    // there, so the connection itself is refused (not the config).
    jest.resetModules();
    const saved = process.env;
    process.env = {
      PATH: saved.PATH,
      NODE_ENV: 'test',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      DB_NAME: 'unreachable',
      DB_USER: 'unreachable',
      DB_PASSWORD: '',
      CLIENT_URL: 'https://app.shopbook.test',
      JWT_SECRET: 'unreachable-test-secret',
    };
    const db = require('../src/db');
    expect(() => require('../src/config/env').getConfig()).not.toThrow();
    try {
      expect(await db.checkDatabase(2000)).toBe(false);
    } finally {
      await db.closeDatabase();
      process.env = saved;
      jest.resetModules();
    }
  });
});
