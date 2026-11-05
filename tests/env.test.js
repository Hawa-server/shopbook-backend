// The environment check: a missing or wrong variable gives a clear message
// naming the variable (never its value), and starting the real server with a
// missing variable stops it with exit code 1.

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv, EnvError } = require('../src/config/env');

// A complete, valid set of variables for the tests below to break one at a time.
const valid = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'shopbook_test',
  DB_USER: 'tester',
  DB_PASSWORD: 'not-a-real-password-123',
  CLIENT_URL: 'https://app.shopbook.test/',
  JWT_SECRET: 'short-is-fine-outside-production',
};

// Everything production needs on top of `valid`.
const production = {
  ...valid,
  NODE_ENV: 'production',
  TRUST_PROXY: '3',
  DB_SSL_CA_PATH: __filename,
  JWT_SECRET: 'p'.repeat(32),
  APP_URL: 'https://app.shopbook.test',
  EMAIL_API_KEY: 'key',
  EMAIL_FROM_ADDRESS: 'shop@shopbook.test',
  EMAIL_FROM_NAME: 'Shop Book',
};

describe('parseEnv', () => {
  test('a valid environment gives a config with defaults', () => {
    const config = parseEnv(valid);
    expect(config.PORT).toBe(3000);
    expect(config.DB_PORT).toBe(3306);
    expect(config.TRUST_PROXY).toBe(0);
    expect(config.LOG_LEVEL).toBe('silent'); // quiet in tests by default
    expect(config.CLIENT_URL).toBe('https://app.shopbook.test'); // trailing slash removed
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('a missing variable is named in the message', () => {
    const { DB_NAME, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(EnvError);
    expect(() => parseEnv(rest)).toThrow(/DB_NAME is missing/);
  });

  test('an empty value counts as missing (except DB_PASSWORD)', () => {
    expect(() => parseEnv({ ...valid, DB_HOST: '' })).toThrow(/DB_HOST is missing/);
    expect(parseEnv({ ...valid, DB_PASSWORD: '' }).DB_PASSWORD).toBe('');
  });

  test('a wrong value is named without printing the value', () => {
    let message = '';
    try {
      parseEnv({ ...valid, NODE_ENV: 'prod', CLIENT_URL: 'not a url', DB_PASSWORD: 'secret-value' });
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/NODE_ENV has an invalid value/);
    expect(message).toMatch(/CLIENT_URL has an invalid value/);
    expect(message).not.toContain('prod"');
    expect(message).not.toContain('not a url');
    expect(message).not.toContain('secret-value');
  });

  test('production needs a CA certificate and TRUST_PROXY', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/DB_SSL_CA_PATH or DB_SSL_CA is required in production/);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/TRUST_PROXY is required in production/);
  });

  test('the CA certificate can be given as text, including with literal \\n', () => {
    const pem = '-----BEGIN CERTIFICATE-----\\nMIIBfake\\n-----END CERTIFICATE-----';
    const { DB_SSL_CA_PATH, ...withoutPath } = production;
    const config = parseEnv({ ...withoutPath, DB_SSL_CA: pem });
    expect(config.DB_SSL_CA).toBe('-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----');
  });

  test('CA text that is not a certificate, or both ways at once, is refused', () => {
    expect(() => parseEnv({ ...valid, DB_SSL_CA: 'hello' })).toThrow(/DB_SSL_CA is not a PEM certificate/);
    const pem = '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----';
    expect(() => parseEnv({ ...valid, DB_SSL_CA: pem, DB_SSL_CA_PATH: __filename })).toThrow(/use only one/);
  });

  test('production refuses a JWT_SECRET shorter than 32 characters, and needs the email settings', () => {
    expect(parseEnv(production).JWT_SECRET).toHaveLength(32);
    expect(() => parseEnv({ ...production, JWT_SECRET: 'p'.repeat(31) })).toThrow(/JWT_SECRET must be at least 32 characters in production/);
    for (const name of ['APP_URL', 'EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME']) {
      expect(() => parseEnv({ ...production, [name]: undefined })).toThrow(new RegExp(`${name} is required in production`));
    }
  });

  test('APP_URL defaults to CLIENT_URL outside production', () => {
    expect(parseEnv(valid).APP_URL).toBe('https://app.shopbook.test');
  });

  test('a CA certificate path that does not exist is refused', () => {
    expect(() => parseEnv({ ...valid, DB_SSL_CA_PATH: '/no/such/ca.pem' })).toThrow(/DB_SSL_CA_PATH points to a file that does not exist/);
  });
});

describe('starting the server', () => {
  test('stops with exit code 1 and a clear message when a variable is missing', () => {
    // Only PATH and NODE_ENV: every database variable and CLIENT_URL are missing.
    const result = spawnSync(process.execPath, [path.join(__dirname, '../src/server.js')], {
      env: { PATH: process.env.PATH, NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid environment variables/);
    expect(result.stderr).toMatch(/DB_HOST is missing/);
    expect(result.stderr).toMatch(/CLIENT_URL is missing/);
    expect(result.stderr).toMatch(/JWT_SECRET is missing/);
    expect(result.stderr).toMatch(/See \.env\.example/);
  });
});
