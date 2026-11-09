// The route registry: every endpoint the API has, in one table. The app mounts
// routes from this table, and `npm run check:api-docs` compares the same table
// with docs/api.md, so the documentation can never quietly miss an endpoint
// (or describe one that doesn't exist). Add every new route here.

const { healthHandler } = require('./health');
const { authRoutes } = require('./auth');
const { teamRoutes } = require('./team');
const { businessRoutes } = require('./business');
const { deviceRoutes } = require('./devices');
const { syncRoutes } = require('./sync');
const { productRoutes } = require('./products');

// Each entry: the HTTP method, the full path (with /api), `business` (true if
// it works inside one business: it then needs X-Business and requireAuth, and
// must have a case in the isolation test; false otherwise; a test fails if
// it's missing), `signed` (true if the phone must sign it with its device key:
// every business endpoint except the two device-registration ones), and
// `build`, which
// receives the app's dependencies and returns the route's middleware and
// handler in order. Paths use Express syntax (`/api/team/:membershipId`), and
// docs/api.md uses the same text in its `### METHOD /path` headings.
const routes = [
  { method: 'GET', path: '/api/health', business: false, signed: false, build: (deps) => [healthHandler(deps)] },
  ...authRoutes,
  ...teamRoutes,
  ...businessRoutes,
  ...deviceRoutes,
  ...syncRoutes,
  ...productRoutes,
];

module.exports = { routes };
