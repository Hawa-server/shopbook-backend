// Refuses signed-in requests from someone who hasn't accepted the current
// privacy notice and terms, with 403 TERMS_REQUIRED (the app then shows them).
// Put after requireSession on every signed-in endpoint EXCEPT the few needed
// to get there: me, sign-out, accept-terms, change-password and the language.

const { AppError } = require('../lib/errors');
const { TERMS_VERSION } = require('../legal');

// Passes only when req.user has accepted TERMS_VERSION.
function requireTerms(req, res, next) {
  if (req.user?.termsVersion === TERMS_VERSION) return next();
  return next(new AppError(403, 'TERMS_REQUIRED', 'Please accept the privacy notice and terms to continue.'));
}

module.exports = { requireTerms };
