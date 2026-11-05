// runTransaction: retries a deadlock (up to 3 times), then answers 503
// TRY_AGAIN; never retries other errors. And a scan of the code: no file
// except src/db.js may open a transaction or lock rows itself.

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

describe('only runTransaction opens transactions', () => {
  // Every .js file under src/, except db.js where runTransaction lives.
  function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.name.endsWith('.js') ? [full] : [];
    });
  }

  test('no file in src/ calls .transaction( or uses FOR UPDATE, except src/db.js', () => {
    const root = path.join(__dirname, '../src');
    const offenders = sourceFiles(root)
      .filter((file) => path.relative(root, file) !== 'db.js')
      .filter((file) => /\.transaction\(|FOR\s+UPDATE|LOCK\.UPDATE/i.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
