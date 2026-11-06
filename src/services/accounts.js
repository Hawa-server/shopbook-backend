// Account logic shared by the /auth endpoints: finding a person by what they
// typed to sign in, the "me" answer, one-time email tokens, and turning the
// database's "already taken" errors into clear answers.

const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { AppError } = require('../lib/errors');
const { normalizeGhanaPhone } = require('../lib/phone');
const { createToken, hashToken, sameHash } = require('../lib/tokens');
const { TERMS_VERSION } = require('../legal');

const HOUR_MS = 60 * 60 * 1000;
const TOKEN_LIFETIME_MS = {
  confirm_email: 24 * HOUR_MS,
  change_email: 24 * HOUR_MS,
  reset_password: 30 * 60 * 1000,
};

// What the person typed in the sign-in box, as the key it's looked up and
// rate-limited by: an email in lower case if it contains "@", otherwise the
// phone number in +233 form (or the text itself if it isn't a valid number).
function loginKey(login) {
  const text = String(login).trim();
  if (text.includes('@')) return { kind: 'email', value: text.toLowerCase() };
  const phone = normalizeGhanaPhone(text);
  return phone ? { kind: 'phone', value: phone } : { kind: 'unknown', value: text.toLowerCase() };
}

// Finds the user for a login (phone number or email), or null.
async function findUserByLogin(models, login) {
  const key = loginKey(login);
  if (key.kind === 'email') return models.User.findOne({ where: { email: key.value } });
  if (key.kind === 'phone') return models.User.findOne({ where: { phone: key.value } });
  return null;
}

// The answer to GET /auth/me (and sign-up, sign-in…): who the person is,
// whether they've accepted the current terms, their ACTIVE memberships with
// each business's name (from BusinessSettings) and their role there, and any
// invitations waiting for them to accept or decline.
// Roles here are for display; the server re-checks them on every request.
async function buildMe(models, user) {
  const rows = await models.Membership.findAll({
    where: { userId: user.id, [Op.or]: [{ isActive: true }, { removedAt: null }] },
    include: [{ model: models.Business, as: 'business', include: [{ model: models.BusinessSettings, as: 'settings' }] }],
  });
  const memberships = rows.filter((m) => m.isActive);
  const invitations = rows
    .filter((m) => !m.isActive && !m.removedAt)
    .map((m) => ({
      membershipId: m.id,
      businessName: m.business.settings?.businessName ?? '',
      role: m.role,
      invitedAt: m.invitedAt,
    }))
    .sort((a, b) => new Date(a.invitedAt) - new Date(b.invitedAt));
  const businesses = memberships
    .map((m) => ({
      id: m.business.id,
      name: m.business.settings?.businessName ?? '',
      role: m.role,
      isPractice: m.business.isPractice,
      status: m.business.status,
    }))
    .sort((a, b) => Number(a.isPractice) - Number(b.isPractice) || a.name.localeCompare(b.name));

  return {
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email ?? null,
      emailConfirmed: Boolean(user.email && user.emailConfirmedAt),
      pendingEmail: user.pendingEmail ?? null, // ?? null: a just-created record leaves unset fields out
      language: user.language,
      mustChangePassword: user.mustChangePassword,
    },
    terms: {
      currentVersion: TERMS_VERSION,
      acceptedVersion: user.termsVersion ?? null,
      accepted: user.termsVersion === TERMS_VERSION,
    },
    businesses,
    invitations,
  };
}

// Creates a one-time token for an email link, inside `transaction`. Older
// unused tokens of the same kind for this person are made unusable first, so
// only the newest link works. Returns the token itself (for the link only:
// it's never stored or logged).
async function issueEmailToken(models, transaction, { userId, purpose, email, now }) {
  await models.EmailToken.update(
    { usedAt: now },
    { where: { userId, purpose, usedAt: null }, transaction },
  );
  const { token, tokenHash } = createToken();
  await models.EmailToken.create({
    id: randomUUID(),
    userId,
    purpose,
    tokenHash,
    email,
    expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS[purpose]),
    createdAt: now,
  }, { transaction });
  return token;
}

// Uses up a token from a link, inside `transaction`: finds it by its hash
// (only for the allowed purposes, unused and not expired) and marks it used
// with ONE conditional UPDATE ("…WHERE usedAt IS NULL"). If two requests
// race with the same link, only one update changes a row, so the link works
// exactly once, without any explicit lock. Returns the token row, or null.
async function claimEmailToken(models, transaction, { token, purposes, now }) {
  const tokenHash = hashToken(token);
  const row = await models.EmailToken.findOne({
    where: { tokenHash, purpose: { [Op.in]: purposes }, usedAt: null, expiresAt: { [Op.gt]: now } },
    transaction,
  });
  if (!row || !sameHash(row.tokenHash, tokenHash)) return null;

  const [changed] = await models.EmailToken.update(
    { usedAt: now },
    { where: { id: row.id, usedAt: null }, transaction },
  );
  return changed === 1 ? row : null;
}

// The answer for any link that can't be used: unknown, used, expired, or for
// an address that has since changed. One answer, so it reveals nothing.
function invalidToken() {
  return new AppError(400, 'INVALID_TOKEN', 'This link has expired or has already been used. Ask for a new one.');
}

// Turns MySQL's "duplicate entry" for a phone number or email into a clear
// 409 answer; any other error is passed on unchanged.
function takenError(err) {
  if (err?.name !== 'SequelizeUniqueConstraintError') return err;
  const message = err.original?.sqlMessage ?? err.parent?.sqlMessage ?? '';
  if (message.includes('uq_user_phone')) {
    return new AppError(409, 'PHONE_TAKEN', 'This phone number already has an account.', { phone: 'This phone number already has an account.' });
  }
  if (message.includes('uq_user_email')) {
    return new AppError(409, 'EMAIL_TAKEN', 'This email address already has an account.', { email: 'This email address already has an account.' });
  }
  return err;
}

// The link that goes in an email, e.g. https://app…/reset-password?token=…
function emailLink(config, page, token) {
  return `${config.APP_URL}/${page}?token=${encodeURIComponent(token)}`;
}

module.exports = {
  loginKey, findUserByLogin, buildMe, issueEmailToken, claimEmailToken,
  invalidToken, takenError, emailLink, TOKEN_LIFETIME_MS,
};
