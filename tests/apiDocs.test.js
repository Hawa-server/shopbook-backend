// check:api-docs: the real docs/api.md matches the route registry, and the
// comparison catches a route missing on either side.

const fs = require('node:fs');
const path = require('node:path');
const { routes } = require('../src/routes');
const { compareRoutes, compareOperations } = require('../scripts/check-api-docs');
const { operations } = require('../src/sync/operations');

describe('check:api-docs', () => {
  test('docs/api.md documents exactly the routes the server has', () => {
    const markdown = fs.readFileSync(path.join(__dirname, '../docs/api.md'), 'utf8');
    expect(compareRoutes({ routes, markdown })).toEqual({ missingInDocs: [], missingInCode: [] });
  });

  test('a route with no heading, and a heading with no route, are both reported', () => {
    // The real api.md plus one heading for a route that doesn't exist.
    const markdown = `${fs.readFileSync(path.join(__dirname, '../docs/api.md'), 'utf8')}\n### POST /api/ghost\n`;
    const result = compareRoutes({ routes: [...routes, { method: 'GET', path: '/api/undocumented' }], markdown });
    expect(result.missingInDocs).toEqual(['GET /api/undocumented']);
    expect(result.missingInCode).toEqual(['POST /api/ghost']);
  });

  test('docs/api.md documents exactly the registered sync operation types', () => {
    const markdown = fs.readFileSync(path.join(__dirname, '../docs/api.md'), 'utf8');
    expect(compareOperations({ types: Object.keys(operations), markdown })).toEqual({ missingInDocs: [], missingInCode: [] });
  });
});
