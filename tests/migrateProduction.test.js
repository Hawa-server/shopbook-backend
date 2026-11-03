// The production migration guard (scripts/migrate-production.js). Every test
// uses a temporary env file and a stand-in for sequelize-cli, so nothing
// connects to any database and the real .env.production is never read.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateProduction, Refused } = require('../scripts/migrate-production');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopbook-migrate-'));
const caFile = path.join(dir, 'ca.pem');
fs.writeFileSync(caFile, '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n');

// Writes a temporary env file from an object and returns its path.
function envFile(name, vars) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, Object.entries(vars).map(([key, value]) => `${key}=${value}`).join('\n'));
  return file;
}

const productionVars = {
  NODE_ENV: 'production',
  DB_HOST: 'mysql-example.aivencloud.test',
  DB_PORT: '12345',
  DB_NAME: 'shopbook',
  DB_USER: 'app',
  DB_PASSWORD: 'fake-password-for-test',
  DB_SSL_CA_PATH: caFile,
  CLIENT_URL: 'https://shopbook.example.test',
  TRUST_PROXY: '1',
};

// A stand-in for spawnSync that records what it was asked to run.
function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0 };
  };
  return { spawn, calls };
}

describe('migrate-production guard', () => {
  test('stops before running anything when the env file is missing', () => {
    const { spawn, calls } = fakeSpawn();
    expect(() => migrateProduction({ command: 'db:migrate', envFile: path.join(dir, '.env.production'), spawn, write: () => {} }))
      .toThrow(/\.env\.production not found/);
    expect(calls).toHaveLength(0);
  });

  test('refuses a file that is not NODE_ENV=production', () => {
    const { spawn, calls } = fakeSpawn();
    const file = envFile('dev.env', { ...productionVars, NODE_ENV: 'development' });
    expect(() => migrateProduction({ command: 'db:migrate', envFile: file, spawn, write: () => {} })).toThrow(/NODE_ENV=production/);
    expect(calls).toHaveLength(0);
  });

  test('refuses a production file that fails the environment check', () => {
    const { spawn, calls } = fakeSpawn();
    const { DB_SSL_CA_PATH, ...noCa } = productionVars;
    const file = envFile('no-ca.env', noCa);
    expect(() => migrateProduction({ command: 'db:migrate', envFile: file, spawn, write: () => {} })).toThrow(Refused);
    expect(calls).toHaveLength(0);
  });

  test('refuses any command other than db:migrate and db:migrate:status', () => {
    const { spawn, calls } = fakeSpawn();
    const file = envFile('ok1.env', productionVars);
    expect(() => migrateProduction({ command: 'db:migrate:undo:all', envFile: file, spawn, write: () => {} })).toThrow(/Unknown command/);
    expect(calls).toHaveLength(0);
  });

  test('prints the host and database, never the password, then runs sequelize-cli', () => {
    const { spawn, calls } = fakeSpawn();
    const output = [];
    const file = envFile('ok2.env', productionVars);
    const status = migrateProduction({ command: 'db:migrate:status', envFile: file, spawn, write: (text) => output.push(text) });

    expect(status).toBe(0);
    const printed = output.join('');
    expect(printed).toContain('mysql-example.aivencloud.test:12345');
    expect(printed).toContain('"shopbook"');
    expect(printed).not.toContain('fake-password-for-test');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toBe('db:migrate:status');
  });

  test("passes only the file's variables, not the shell's own database settings", () => {
    const { spawn, calls } = fakeSpawn();
    const file = envFile('ok3.env', productionVars);
    const saved = process.env.DB_HOST;
    process.env.DB_HOST = 'localhost-from-the-shell';
    process.env.SOME_OTHER_SETTING = 'should-not-pass';
    try {
      migrateProduction({ command: 'db:migrate', envFile: file, spawn, write: () => {} });
    } finally {
      if (saved === undefined) delete process.env.DB_HOST; else process.env.DB_HOST = saved;
      delete process.env.SOME_OTHER_SETTING;
    }
    const { env } = calls[0].options;
    expect(env.DB_HOST).toBe('mysql-example.aivencloud.test');
    expect(env.SOME_OTHER_SETTING).toBeUndefined();
    expect(env.NODE_ENV).toBe('production');
  });
});
