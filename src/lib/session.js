// Sign-in sessions: a signed token (JWT) in an HTTP-only cookie.
//
// - The token holds only { userId, sessionVersion, issuedAt }. It's signed
//   with JWT_SECRET (HS256), so it can't be changed or made up without the secret.
// - HTTP-only: the app's JavaScript can't read it, so injected script can't steal it.
// - SameSite=Lax: browsers don't send it with most requests started by other
//   websites (one of the CSRF layers). Secure in production: HTTPS only.
// - Two lifetimes: IDLE (30 days; every signed-in request renews it) and
//   ABSOLUTE (90 days after issuedAt, the moment of signing in; renewal never
//   moves issuedAt), so a lost phone can't stay signed in forever.
// - sessionVersion: the user's counter in the database. Changing a password,
//   phone number or email adds 1, which makes every older token useless at once.

const jwt = require('jsonwebtoken');
const { AppError } = require('./errors');

const COOKIE_NAME = 'sb_session';
const DAY_MS = 24 * 60 * 60 * 1000;
const IDLE_MS = 30 * DAY_MS;
const ABSOLUTE_MS = 90 * DAY_MS;

// Cookie settings shared by setting and clearing it (they must match, or the
// browser treats them as two different cookies).
function cookieOptions(config) {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/api' };
}

// Makes the token and sets the cookie. The cookie and the token both end at
// whichever comes first: 30 days from now, or 90 days after issuedAt.
function setSessionCookie(res, config, { userId, sessionVersion, issuedAt }, now = Date.now()) {
  const expiresAt = Math.min(now + IDLE_MS, issuedAt + ABSOLUTE_MS);
  const lifetimeSeconds = Math.max(1, Math.floor((expiresAt - now) / 1000));
  // `iat` from the same clock as everything else, so the token's own expiry
  // is counted from the same "now" the server checks it against.
  const token = jwt.sign({ userId, sessionVersion, issuedAt, iat: Math.floor(now / 1000) }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: lifetimeSeconds,
  });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(config), maxAge: lifetimeSeconds * 1000 });
}

// Removes the cookie (sign-out, or after a password reset).
function clearSessionCookie(res, config) {
  res.clearCookie(COOKIE_NAME, cookieOptions(config));
}

// Reads and checks the token from the request's cookie. Returns its contents,
// or null if there's none, it's forged or expired, or it's past 90 days.
function readSessionToken(req, config, now = Date.now()) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], clockTimestamp: Math.floor(now / 1000) });
    const { userId, sessionVersion, issuedAt } = payload;
    if (typeof userId !== 'string' || !Number.isInteger(sessionVersion) || !Number.isInteger(issuedAt)) return null;
    if (now - issuedAt >= ABSOLUTE_MS) return null; // the absolute limit, whatever the token's own expiry says
    return { userId, sessionVersion, issuedAt };
  } catch {
    return null;
  }
}

// Middleware for every signed-in endpoint: checks the cookie, loads the user
// fresh from the database (so a changed password counts at once), compares
// sessionVersion, then renews the cookie for another 30 days. Sets req.user
// and req.session. Anything wrong is 401 NOT_SIGNED_IN: the app keeps all its
// local records and asks the person to sign in again.
function requireSession({ config, getModels, now = Date.now }) {
  return async function checkSession(req, res, next) {
    const time = now();
    const session = readSessionToken(req, config, time);
    if (!session) return next(notSignedIn());

    const user = await getModels().User.findByPk(session.userId);
    if (!user || user.sessionVersion !== session.sessionVersion) {
      clearSessionCookie(res, config);
      return next(notSignedIn());
    }

    req.user = user;
    req.session = session;
    setSessionCookie(res, config, session, time); // renewal: idle limit starts again, issuedAt kept
    return next();
  };
}

// The one answer for every session problem, so it reveals nothing about why.
function notSignedIn() {
  return new AppError(401, 'NOT_SIGNED_IN', 'Please sign in.');
}

module.exports = {
  COOKIE_NAME, IDLE_MS, ABSOLUTE_MS,
  setSessionCookie, clearSessionCookie, readSessionToken, requireSession,
};
