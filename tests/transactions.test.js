// runTransaction: retries a deadlock (up to 3 times), then answers 503
// TRY_AGAIN; never retries other errors. And scans of the code: only
// src/db.js opens transactions; only src/sync/runOperation.js locks rows and
// touches SyncSequence.

const fs = require('node:fs');
const path = require('node:path');

describe('runTransaction', () => {
  // Loads db.js with a stand-in Sequelize whose transaction() runs `behaviour`.
  function loadWith(behaviour) {
    jest.resetModules();
    jest.doMock('sequelize', () => {
      const actual = jest.requireActual('sequelize');
      return { ...actual, Sequelize: class { transaction(fn) { return behaviour(fn); } } };
    });
    jest.doMock('../src/config/env', () => ({ ...jest.requireActual('../src/config/env'), getConfig: () => ({}) }));
    jest.doMock('../src/config/database', () => ({ buildDbOptions: () => ({}) }));
    return require('../src/db');
  }
  afterEach(() => {
    jest.dontMock('sequelize');
    jest.dontMock('../src/config/env');
    jest.dontMock('../src/config/database');
    jest.resetModules();
  });

  const deadlock = () => Object.assign(new Error('Deadlock found'), { original: { errno: 1213, code: 'ER_LOCK_DEADLOCK' } });
  const noWait = { wait: async () => {} };

  test('a deadlock is retried and the second attempt succeeds', async () => {
    let calls = 0;
    const db = loadWith(async (fn) => { calls += 1; if (calls === 1) throw deadlock(); return fn('tx'); });
    await expect(db.runTransaction(async () => 'saved', noWait)).resolves.toBe('saved');
    expect(calls).toBe(2);
  });

  test('after 3 retries it answers 503 TRY_AGAIN (temporary, never a rejection)', async () => {
    let calls = 0;
    const db = loadWith(async () => { calls += 1; throw deadlock(); });
    await expect(db.runTransaction(async () => 'never', noWait)).rejects.toMatchObject({ status: 503, code: 'TRY_AGAIN' });
    expect(calls).toBe(4); // the first try + 3 retries
  });

  test('any other error is not retried', async () => {
    let calls = 0;
    const db = loadWith(async () => { calls += 1; throw new Error('a bug'); });
    await expect(db.runTransaction(async () => 'never', noWait)).rejects.toThrow('a bug');
    expect(calls).toBe(1);
  });
});

describe('who may open transactions, lock rows and touch SyncSequence', () => {
  // Every .js file under src/, as [relative path, text].
  function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
  }
  const root = path.join(__dirname, '../src');
  const files = sourceFiles(root).map((file) => [path.relative(root, file), fs.readFileSync(file, 'utf8')]);
  const offenders = (pattern, allowed) => files.filter(([file, text]) => !allowed.includes(file) && pattern.test(text)).map(([file]) => file);

  test('only src/db.js opens transactions (runTransaction, withSavepoint)', () => {
    expect(offenders(/\.transaction\(/, ['db.js'])).toEqual([]);
  });

  test('only src/sync/runOperation.js locks rows (FOR UPDATE)', () => {
    expect(offenders(/FOR\s+UPDATE|LOCK\.UPDATE|lock:\s*true/i, [path.join('sync', 'runOperation.js')])).toEqual([]);
  });

  test('only src/sync/runOperation.js touches SyncSequence (takeSequence); the model file only defines it', () => {
    // The one other file: the READ-ONLY consistency check (SELECTs only; it
    // compares rows with the counter). Checked below to contain no writes.
    const readOnlyCheck = path.join('checks', 'syncChecks.js');
    expect(offenders(/SyncSequence/, [path.join('sync', 'runOperation.js'), path.join('models', 'index.js'), readOnlyCheck])).toEqual([]);
    const checkText = files.find(([file]) => file === readOnlyCheck)[1];
    expect(checkText).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b|\.(create|update|destroy|upsert)\(/);
  });
});
