// The route registry: every endpoint the API has, in one table. The app mounts
// routes from this table, and `npm run check:api-docs` compares the same table
// with docs/api.md, so the documentation can never quietly miss an endpoint
// (or describe one that doesn't exist). Add every new route here.

const { healthHandler } = require('./health');
const { authRoutes } = require('./auth');

// Each entry: the HTTP method, the full path (with /api), and `build`, which
// receives the app's dependencies and returns the route's middleware and
// handler in order. Paths use Express syntax (`/api/team/:membershipId`), and
// docs/api.md uses the same text in its `### METHOD /path` headings.
const routes = [
  { method: 'GET', path: '/api/health', build: (deps) => [healthHandler(deps)] },
  ...authRoutes,
];

module.exports = { routes };
