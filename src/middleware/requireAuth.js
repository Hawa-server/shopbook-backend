// Which business a request is for, and what this person may do there.
//
// Every business endpoint runs: requireSession → requireAuth → requireRole.
// - The phone says which business it's working in with the X-Business header
//   (a person can belong to their shop and its practice shop, or to two
//   shops). The header is REQUIRED; it can only choose among the person's
//   OWN memberships, read from the database on EVERY request. The phone's
//   idea of its role, or of which businesses it may use, is never trusted.
// - A business the person isn't in is answered exactly like one that doesn't
//   exist (404), so nobody can find out which businesses exist.
// - A membership the owner ended is 403 ACCESS_REMOVED: the phone wipes that
//   business's local data. The person stays signed in for their other
//   businesses (sessionVersion isn't touched, ADR-19).

const { AppError } = require('../lib/errors');
const { requireTerms } = require('./requireTerms');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Refuses people who still have a temporary password with 403
// PASSWORD_CHANGE_REQUIRED (a staff member's first sign-in, or after the
// owner reset their password): they must choose their own first.
function requirePasswordChanged(req, res, next) {
  if (!req.user?.mustChangePassword) return next();
  return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please choose your own password first.'));
}

// Picks the business from X-Business among the user's own memberships and
// sets req.business and req.membership. Also refuses a closing business and
// runs the password and terms checks.
function requireAuth({ getModels }) {
  return async function chooseBusiness(req, res, next) {
    const header = req.get('X-Business');
    if (!header) {
      return next(new AppError(400, 'BUSINESS_REQUIRED', 'Missing X-Business header: say which business this request is for.'));
    }
    const businessId = header.trim().toLowerCase();
    if (!UUID.test(businessId)) return next(new AppError(404, 'NOT_FOUND', 'Not found'));

    const models = getModels();
    const membership = await models.Membership.findOne({
      where: { businessId, userId: req.user.id },
      include: [{ model: models.Business, as: 'business', include: [{ model: models.BusinessSettings, as: 'settings' }] }],
    });

    // No membership, or only an invitation not yet accepted: not a member.
    if (!membership || (!membership.isActive && !membership.removedAt)) {
      return next(new AppError(404, 'NOT_FOUND', 'Not found'));
    }
    if (!membership.isActive) {
      return next(new AppError(403, 'ACCESS_REMOVED', 'You no longer have access to this business.'));
    }
    if (membership.business.status === 'closing') {
      return next(new AppError(403, 'BUSINESS_CLOSING', 'This business has been closed by its owner.'));
    }

    req.membership = membership;
    req.business = membership.business;
    return requirePasswordChanged(req, res, (err) => (err ? next(err) : requireTerms(req, res, next)));
  };
}

// Allows only the listed roles in the chosen business (from req.membership,
// which requireAuth just read from the database). Others get 403 FORBIDDEN.
function requireRole(...roles) {
  return function checkRole(req, res, next) {
    if (roles.includes(req.membership?.role)) return next();
    return next(new AppError(403, 'FORBIDDEN', "Your role can't do this."));
  };
}

module.exports = { requireAuth, requireRole, requirePasswordChanged };
