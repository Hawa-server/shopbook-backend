// CORS: tells browsers which other web addresses may read the API's answers.
// Only the phone app's address (CLIENT_URL, plus the local development
// address in development) is allowed. In production the app calls the API
// through its own address (Vercel rewrites /api to Render), so CORS mostly
// matters for local development; it is NOT the CSRF protection (see csrf.js).

const cors = require('cors');
const { allowedOrigins } = require('./allowedOrigins');

// Makes the CORS middleware. For an origin not on the list it simply sends no
// CORS headers, so the browser keeps the answer from that site's script.
// It allows the app's own request headers (X-Business, the four signing
// headers) and lets it read X-Request-Id and X-Server-Time.
function corsMiddleware(config) {
  const origins = allowedOrigins(config);
  return cors({
    origin: (origin, callback) => callback(null, origin !== undefined && origins.has(origin)),
    credentials: true, // the session cookie (BE2) is sent with requests
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Business', 'X-Device-Id', 'X-Signed-At', 'X-Nonce', 'X-Signature'],
    exposedHeaders: ['X-Request-Id', 'X-Server-Time'],
    maxAge: 600,
  });
}

module.exports = { corsMiddleware };
