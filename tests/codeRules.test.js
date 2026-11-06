// Rules about the code itself, checked by reading it, so a later change
// can't quietly break them:
// - route handlers never touch business tables directly or run raw SQL:
//   only scoped(), runTransaction and (from BE5) runOperation may;
// - nothing deletes rows except deleteBusinessData and the explicit
//   housekeeping allow-list (which is empty until BE5 adds the nonce clean-up);
// - every route Express really has is marked business: true or false in the
//   registry (true routes must also have an isolation case: tests/isolation).

const fs = require('node:fs');
const path = require('node:path');
const { BUSINESS_MODELS } = require('../src/models');
const { HOUSEKEEPING_DELETES } = require('../src/services/housekeeping');
const { routes } = require('../src/routes');
const { testApp } = require('./helpers/testApp');

const SRC = path.join(__dirname, '../src');

// Every .js file under a folder, as [relative path, text].
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(full);
    return entry.name.endsWith('.js') ? [[path.relative(SRC, full), fs.readFileSync(full, 'utf8')]] : [];
  });
}

describe('route handlers (src/routes) never touch business tables or SQL directly', () => {
  const routeFiles = filesIn(path.join(SRC, 'routes'));
  const modelNames = ['Business', ...BUSINESS_MODELS].join('|');

  test.each([
    ['a business model directly', new RegExp(`models\\.(${modelNames})\\b`)],
    ['raw SQL (.query)', /\.query\(/],
    ['the Sequelize instance (literal, fn, getSequelize…)', /\bsequelize\b|getSequelize|Sequelize\.(literal|fn|col)/],
  ])('no route file uses %s', (_label, pattern) => {
    const offenders = routeFiles.filter(([, text]) => pattern.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});

describe('deleting rows', () => {
  const ALLOWED = new Set([path.join('services', 'housekeeping.js'), path.join('services', 'deleteBusinessData.js')]);

  test('only deleteBusinessData and the housekeeping file may delete anything', () => {
    const pattern = /\.destroy\(|\bDELETE\s+FROM\b|\bTRUNCATE\b|bulkDelete|\.drop\(/i;
    const offenders = filesIn(SRC)
      .filter(([file, text]) => !ALLOWED.has(file) && pattern.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  test('the housekeeping allow-list is exactly what the owner approved (empty until BE5)', () => {
    // Changing this list needs the project owner's OK: update this test only then.
    expect(HOUSEKEEPING_DELETES).toEqual([]);
  });
});

describe('the route registry', () => {
  test('every route Express has is in the registry and marked business: true or false', () => {
    const { app } = testApp();
    const inExpress = app.router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`))
      .sort();
    const inRegistry = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(inExpress).toEqual(inRegistry);

    const unmarked = routes.filter((r) => typeof r.business !== 'boolean').map((r) => `${r.method} ${r.path}`);
    expect(unmarked).toEqual([]);
  });
});
