// Test helpers: build a config and an app without reading any .env file or
// touching MySQL, so most tests run anywhere. Only tests/health.test.js uses
// the real test database.

const { parseEnv } = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { createLogger } = require('../../src/lib/logger');

// The address used as the "real" phone app in tests.
const CLIENT_URL = 'https://app.shopbook.test';

// A valid test config; `overrides` replaces any variable.
function testConfig(overrides = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    DB_HOST: 'localhost',
    DB_NAME: 'not_used',
    DB_USER: 'not_used',
    DB_PASSWORD: '',
    CLIENT_URL,
    JWT_SECRET: 'test-only-secret-not-used-anywhere-else',
    ...overrides,
  });
}

// Builds an app with a fake database check (up by default) and a logger that
// collects its lines in `lines`, so tests can inspect what was logged.
function testApp({ config = testConfig(), databaseUp = true, routes } = {}) {
  const lines = [];
  const logger = createLogger({ level: 'debug', write: (line) => lines.push(line) });
  const app = createApp({ config, logger, checkDatabase: async () => databaseUp, ...(routes ? { routes } : {}) });
  return { app, lines, config };
}

module.exports = { testConfig, testApp, CLIENT_URL };
