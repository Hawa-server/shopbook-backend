// The list of web addresses (origins) allowed to call the API from a browser:
// the phone app's address (CLIENT_URL), plus the local development address
// only when NODE_ENV=development. Shared by CORS and the CSRF Origin check so
// the two can never disagree.

const { DEV_CLIENT_ORIGIN } = require('../config/env');

// Returns a Set of allowed origins for this config.
function allowedOrigins(config) {
  const origins = new Set([config.CLIENT_URL]);
  if (config.isDevelopment) origins.add(DEV_CLIENT_ORIGIN);
  return origins;
}

module.exports = { allowedOrigins };
