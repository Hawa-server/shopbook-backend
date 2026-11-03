// Starts the API: checks the environment (stopping with a clear message if
// anything is missing), builds the app and listens on PORT. On Render this is
// what `npm start` runs. It also shuts down cleanly when Render stops or
// restarts the service, so requests in progress can finish.

const { getConfigOrExit } = require('./config/env');
const { createLogger, describeError } = require('./lib/logger');
const { checkDatabase, closeDatabase } = require('./db');
const { createApp } = require('./app');

const config = getConfigOrExit();
const logger = createLogger({ level: config.LOG_LEVEL });
const app = createApp({ config, checkDatabase, logger });

const server = app.listen(config.PORT, () => {
  logger.info('server_started', { port: config.PORT, nodeEnv: config.NODE_ENV, trustProxy: config.TRUST_PROXY });
});

// Stops taking new connections, lets open requests finish, closes the
// database pool, then exits. Render sends SIGTERM before stopping a service;
// SIGINT is Ctrl+C locally. If it takes more than 10 seconds, exit anyway.
function shutdown(signal) {
  logger.info('server_stopping', { signal });
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A promise that failed with nobody handling it is a bug: log it (without
// data) so it shows up, rather than letting it disappear.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', describeError(reason));
});
