// CSRF protection (stopping another website from making a signed-in phone's
// browser send a request it didn't mean to), in layers:
// 1. the session cookie is SameSite=Lax (from BE2), so most cross-site
//    requests arrive without it;
// 2. every state-changing request (POST, PUT, PATCH, DELETE) must send
//    `X-Requested-With: XMLHttpRequest`. A plain HTML form on another site
//    can't add that header, and a script on another site can't add it
//    without the browser first asking our CORS rules, which say no;
// 3. on those requests, an `Origin` header, when present, must be one of our
//    allowed origins; the account endpoints (BE2) also require it to be present.
// CORS on its own is never treated as CSRF protection.

const { AppError } = require('../lib/errors');
const { allowedOrigins } = require('./allowedOrigins');

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Layers 2 and 3 for every route. Reading requests (GET) pass straight through:
// they never change anything.
function csrfProtection(config) {
  const origins = allowedOrigins(config);

  return function checkCsrf(req, res, next) {
    if (!STATE_CHANGING.has(req.method)) return next();

    if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
      return next(new AppError(403, 'CSRF_HEADER_MISSING', 'This request is missing a required header.'));
    }

    const origin = req.get('Origin');
    if (origin !== undefined && !origins.has(origin)) {
      return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This request came from a website that is not allowed.'));
    }

    return next();
  };
}

// Stricter check for the account endpoints (sign-up, sign-in, forgot and
// reset password, device bootstrap; mounted from BE2): the Origin header must
// be present and allowed. A missing Origin is accepted only when
// NODE_ENV=development, so Postman works locally, never through a production setting.
function requireOrigin(config) {
  const origins = allowedOrigins(config);

  return function checkOriginPresent(req, res, next) {
    const origin = req.get('Origin');
    if (origin === undefined) {
      if (config.isDevelopment) return next();
      return next(new AppError(403, 'ORIGIN_REQUIRED', 'This request must come from the Shop Book app.'));
    }
    if (!origins.has(origin)) {
      return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'This request came from a website that is not allowed.'));
    }
    return next();
  };
}

module.exports = { csrfProtection, requireOrigin };
