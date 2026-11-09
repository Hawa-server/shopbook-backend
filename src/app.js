// Builds the Express app: the middleware every request passes through, in a
// fixed order, then the routes, then "not found" and the error handler.
// Kept separate from server.js (which only starts listening) so tests can
// build the app with their own settings and send it requests directly.

const express = require('express');
const cookieParser = require('cookie-parser');
const { routes: defaultRoutes } = require('./routes');
const { createAuthLimiters } = require('./routes/limiters');
const { createEmailSender } = require('./lib/email');
const { createBackgroundRunner } = require('./lib/background');
const db = require('./db');
const { requestId } = require('./middleware/requestId');
const { requestLog } = require('./middleware/requestLog');
const { securityHeaders } = require('./middleware/securityHeaders');
const { corsMiddleware } = require('./middleware/cors');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Keeps the exact bytes of each JSON body as received (req.rawBody). From BE5
// the device signature covers the SHA-256 of these bytes, so they must be
// hashed exactly as the phone sent them, before any parsing.
function keepRawBody(req, res, buf) {
  req.rawBody = buf;
}

// Makes the app. `config` comes from parseEnv; `checkDatabase` and `logger`
// are passed in so tests can replace them; `routes` defaults to the registry.
// The rest are the routes' shared helpers, each replaceable in tests: the
// email sender, the rate limiters, background work, the database (models and
// runTransaction) and the clock (`now`, milliseconds).
function createApp({
  config,
  checkDatabase,
  logger,
  routes = defaultRoutes,
  email = createEmailSender({ config, logger }),
  limiters = createAuthLimiters(),
  background = createBackgroundRunner({ logger }),
  getModels = db.getModels,
  runTransaction = db.runTransaction,
  now = Date.now,
  operations, // the sync operation registry; replaceable in tests (default: src/sync/operations)
}) {
  const app = express();

  // Don't announce "Express" to everyone (X-Powered-By).
  app.disable('x-powered-by');

  // How many proxies sit in front of the server (Vercel's rewrite, Render's
  // router). Express then takes req.ip from the right place in
  // X-Forwarded-For, so rate limits count each phone, not the proxy. 0 means
  // "no proxy" (local). The production value is checked in BE1 Part B.
  app.set('trust proxy', config.TRUST_PROXY);

  // Order matters: the ID first so every later step (and every log line) has
  // it; headers next so even errors carry them; CORS before the CSRF check so
  // browsers' preflight (OPTIONS) requests are answered; the body is read
  // (with a 1 MB limit; a 200-operation push fits easily) before routes.
  app.use(requestId);
  // X-Server-Time on every response (milliseconds since 1970, the server's
  // clock): phones keep the difference from their own clock and sign with
  // server-corrected time, so a phone set to the wrong day still signs right.
  app.use((req, res, next) => { res.set('X-Server-Time', String(now())); next(); });
  app.use(requestLog({ logger, logProxyChain: config.LOG_PROXY_CHAIN }));
  app.use(securityHeaders({ isProduction: config.isProduction }));
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '1mb', strict: true, verify: keepRawBody }));
  app.use(cookieParser()); // reads the session cookie (src/lib/session.js)
  app.use(csrfProtection(config));

  const deps = { config, checkDatabase, logger, email, limiters, background, getModels, runTransaction, now, operations };
  for (const route of routes) {
    app[route.method.toLowerCase()](route.path, ...route.build(deps));
  }

  app.use(notFound);
  app.use(errorHandler({ logger }));

  app.locals.deps = deps; // lets tests reach the email outbox, limiters and background work
  return app;
}

module.exports = { createApp };
