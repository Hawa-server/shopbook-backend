// check:api-docs: the real docs/api.md matches the route registry, and the
// comparison catches a route missing on either side.

const fs = require('node:fs');
const path = require('node:path');
const { routes } = require('../src/routes');
const { compareRoutes } = require('../scripts/check-api-docs');

describe('check:api-docs', () => {
  test('docs/api.md documents exactly the routes the server has', () => {
    const markdown = fs.readFileSync(path.join(__dirname, '../docs/api.md'), 'utf8');
    expect(compareRoutes({ routes, markdown })).toEqual({ missingInDocs: [], missingInCode: [] });
  });

  test('a route with no heading, and a heading with no route, are both reported', () => {
    const markdown = '### GET /api/health\n\n### POST /api/ghost\n';
    const result = compareRoutes({ routes: [...routes, { method: 'GET', path: '/api/undocumented' }], markdown });
    expect(result.missingInDocs).toEqual(['GET /api/undocumented']);
    expect(result.missingInCode).toEqual(['POST /api/ghost']);
  });
});
