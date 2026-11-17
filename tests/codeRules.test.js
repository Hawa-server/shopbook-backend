// Rules about the code itself, checked by reading it, so a later change
// can't quietly break them:
// - route handlers never touch business tables directly or run raw SQL:
//   only scoped(), runTransaction and (from BE5) runOperation may;
// - nothing deletes rows except deleteBusinessData and the explicit
//   housekeeping allow-list (BE5: expired nonces; BE6.5: unused photos);
// - every route Express really has is marked business: true or false in the
//   registry (true routes must also have an isolation case: tests/isolation).

const fs = require('node:fs');
const path = require('node:path');
const { BUSINESS_MODELS, PERMANENT_MODELS, PROJECTION_MODELS } = require('../src/models');
const { HOUSEKEEPING_DELETES, PHOTO_UNUSED_DAYS, PHOTO_CLEANUP_BATCH } = require('../src/services/housekeeping');
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
  // debtLots.js (BE9): rebuilds one customer's WORKED-OUT debt rows (approved by the owner, 11 Nov 2026).
  const ALLOWED = new Set([path.join('services', 'housekeeping.js'), path.join('services', 'deleteBusinessData.js'), path.join('services', 'debtLots.js')]);

  test('only deleteBusinessData, the housekeeping file and the debt-lot service may delete anything', () => {
    const pattern = /\.destroy\(|\bDELETE\s+FROM\b|\bTRUNCATE\b|bulkDelete|\.drop\(/i;
    const offenders = filesIn(SRC)
      .filter(([file, text]) => !ALLOWED.has(file) && pattern.test(text))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  test('the housekeeping allow-list is exactly what the owner approved', () => {
    // Changing this list needs the project owner's OK: update this test only then.
    // BE5: the expired-nonce clean-up (approved by the owner).
    // BE6.5: unused product photos (approved by the owner, 11 Nov 2026).
    expect(HOUSEKEEPING_DELETES.map((entry) => entry.table)).toEqual(['DeviceRequestNonce', 'Photo']);
    expect(PHOTO_UNUSED_DAYS).toBe(30);
    expect(PHOTO_CLEANUP_BATCH).toBe(20);
  });

  test('the photo clean-up deletes only unused photos of ONE business, file first, then the row', () => {
    const text = fs.readFileSync(path.join(SRC, 'services', 'housekeeping.js'), 'utf8');
    const body = text.slice(text.indexOf('async function cleanUpUnusedPhotos'));
    // The one row delete re-checks the business, the photo, "unused for 30 days" and "no product uses it".
    expect(body).toMatch(/DELETE ph FROM Photo ph WHERE ph\.businessId = \? AND ph\.id = \? AND \$\{unused\}/);
    expect(body).toMatch(/const unused = `COALESCE\(ph\.releasedAt, ph\.uploadedAt\) < \?\s+AND NOT EXISTS \(SELECT 1 FROM Product p WHERE p\.businessId = ph\.businessId AND p\.photoId = ph\.id\)`/);
    // The file is removed BEFORE the row.
    expect(body.indexOf('storage.remove(')).toBeGreaterThan(-1);
    expect(body.indexOf('storage.remove(')).toBeLessThan(body.indexOf('DELETE ph FROM Photo'));
  });

  test('stored photo files are removed only by the clean-up rule (and, later, deleteBusinessData)', () => {
    const allowed = new Set([path.join('services', 'housekeeping.js'), path.join('services', 'deleteBusinessData.js'), path.join('lib', 'photoStorage.js')]);
    const offenders = filesIn(SRC).filter(([file, text]) => !allowed.has(file) && /\.remove\(/.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  test('the debt-lot service may delete only the three worked-out tables, never a permanent one', () => {
    // Changing this list needs the project owner's OK (approved 11 Nov 2026).
    expect([...PROJECTION_MODELS].sort()).toEqual(['CreditLot', 'DebtAllocation', 'DebtLot']);
    expect(PROJECTION_MODELS.filter((m) => PERMANENT_MODELS.includes(m))).toEqual([]);
    const text = fs.readFileSync(path.join(SRC, 'services', 'debtLots.js'), 'utf8');
    const destroys = text.match(/\.destroy\(/g) ?? [];
    expect(destroys).toHaveLength(1); // the one loop over PROJECTION_MODELS, scoped to one customer
    // The one delete: inside a loop over PROJECTION_MODELS, always within ONE customer (`...ids`).
    expect(text).toMatch(/for \(const model of PROJECTION_MODELS\) \{[^}]*await models\[model\]\.destroy\(\{ where: \{ \.\.\.ids, id: plan\[model\]\.remove \}, transaction \}\)/);
    expect(text).not.toMatch(/DELETE\s+FROM|TRUNCATE|bulkDelete/i);
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

    const unmarked = routes.filter((r) => typeof r.business !== 'boolean' || typeof r.signed !== 'boolean').map((r) => `${r.method} ${r.path}`);
    expect(unmarked).toEqual([]);
  });

  test('every business route is signed, except the two device-registration endpoints', () => {
    const DEVICE_BOOTSTRAP = ['POST /api/devices/challenge', 'POST /api/devices'];
    const unsigned = routes.filter((r) => r.business && !r.signed).map((r) => `${r.method} ${r.path}`).sort();
    expect(unsigned).toEqual([...DEVICE_BOOTSTRAP].sort());
  });

  test("a route marked signed really checks the device signature (and one that isn't, doesn't)", () => {
    const { app } = testApp();
    const deps = app.locals.deps;
    for (const route of routes) {
      const names = route.build(deps).map((fn) => fn.name);
      expect([`${route.method} ${route.path}`, names.includes('checkDevice')]).toEqual([`${route.method} ${route.path}`, route.signed]);
    }
  });
});
