// Builds the Express app: the middleware every request passes through, in a
// fixed order, then the routes, then "not found" and the error handler.
// Kept separate from server.js (which only starts listening) so tests can
// build the app with their own settings and send it requests directly.

const express = require('express');
const { routes: defaultRoutes } = require('./routes');
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
function createApp({ config, checkDatabase, logger, routes = defaultRoutes }) {
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
  app.use(requestLog({ logger, logProxyChain: config.LOG_PROXY_CHAIN }));
  app.use(securityHeaders({ isProduction: config.isProduction }));
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '1mb', strict: true, verify: keepRawBody }));
  app.use(csrfProtection(config));

  const deps = { config, checkDatabase, logger };
  for (const route of routes) {
    app[route.method.toLowerCase()](route.path, ...route.build(deps));
  }

  app.use(notFound);
  app.use(errorHandler({ logger }));

  return app;
}

module.exports = { createApp };
