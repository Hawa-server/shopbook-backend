// CORS: tells browsers which other web addresses may read the API's answers.
// Only the phone app's address (CLIENT_URL, plus the local development
// address in development) is allowed. In production the app calls the API
// through its own address (Vercel rewrites /api to Render), so CORS mostly
// matters for local development; it is NOT the CSRF protection (see csrf.js).

const cors = require('cors');
const { allowedOrigins } = require('./allowedOrigins');

// Makes the CORS middleware. For an origin not on the list it simply sends no
// CORS headers, so the browser keeps the answer from that site's script.
// Later tasks add their request headers here (X-Business in BE3, the signing
// headers in BE5) and X-Server-Time to the exposed headers.
function corsMiddleware(config) {
  const origins = allowedOrigins(config);
  return cors({
    origin: (origin, callback) => callback(null, origin !== undefined && origins.has(origin)),
    credentials: true, // the session cookie (BE2) is sent with requests
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
}

module.exports = { corsMiddleware };
