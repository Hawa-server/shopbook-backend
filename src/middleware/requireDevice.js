// requireDevice: every signed business endpoint runs
//   requireSession → requireAuth (business, membership) → requireDevice → role → handler.
// It checks the phone's signature (src/services/devices.js) and sets
// req.device. A device ID alone proves nothing: only a valid signature by the
// key registered for THIS person in THIS business lets the request through.

const { checkSignedRequest } = require('../services/devices');

// Makes the middleware with the app's dependencies.
function requireDevice(deps) {
  return async function checkDevice(req, res, next) {
    try {
      req.device = await checkSignedRequest(deps, req);
      return next();
    } catch (err) {
      if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
      return next(err);
    }
  };
}

module.exports = { requireDevice };
