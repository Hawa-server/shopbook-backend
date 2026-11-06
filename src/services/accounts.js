// Account logic shared by the /auth endpoints: finding a person by what they
// typed to sign in, the "me" answer, one-time email tokens, and turning the
// database's "already taken" errors into clear answers.

const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { AppError } = require('../lib/errors');
const { normalizePhone } = require('../lib/phone');
const locale = require('../locale');
const { createToken, hashToken, sameHash } = require('../lib/tokens');
const { TERMS_VERSION } = require('../legal');
const { recordChange } = require('./changeLog');

const HOUR_MS = 60 * 60 * 1000;
const TOKEN_LIFETIME_MS = {
  confirm_email: 24 * HOUR_MS,
  change_email: 24 * HOUR_MS,
  reset_password: 30 * 60 * 1000,
};

// What the person typed in the sign-in box, as the key it's looked up and
// rate-limited by: an email in lower case if it contains "@", otherwise the
// phone number in E.164 (a local number is read with `country`, the country
// chosen on the screen), or the text itself if it isn't a valid number.
function loginKey(login, country = locale.DEFAULT_COUNTRY) {
  const text = String(login).trim();
  if (text.includes('@')) return { kind: 'email', value: text.toLowerCase() };
  const phone = normalizePhone(text, country);
  return phone ? { kind: 'phone', value: phone } : { kind: 'unknown', value: text.toLowerCase() };
}

// Finds the user for a login (phone number or email), or null.
async function findUserByLogin(models, login, country) {
  const key = loginKey(login, country);
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
      // Locale facts, so the phone formats money, dates and phone numbers itself.
      country: m.business.country,
      currency: locale.currencyForPhone(m.business.currency),
      timezone: m.business.timezone,
      defaultLanguage: m.business.settings?.defaultLanguage ?? locale.FALLBACK_LANGUAGE,
      paymentMethods: m.business.settings?.paymentMethods ?? [],
      localeLocked: Boolean(m.business.moneyRecordedAt),
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

// Creates a new business at sign-up, inside `transaction`: the business,
// its settings (with the business name), its first shop and the owner's
// membership. Done here, not with scoped(), because the business doesn't
// exist yet: this is where its businessId is born. Returns the business.
// The country sets the business's currency, time zone and payment methods.
async function createBusinessWithOwner(models, transaction, { owner, businessName, language, country }) {
  const rules = locale.country(country);
  const business = await models.Business.create({
    id: randomUUID(), country: rules.code, currency: rules.currency, timezone: rules.timezones[0],
  }, { transaction });
  // The membership first: the settings' composite key (businessId, updatedBy)
  // must point at an existing membership of this business.
  await models.Membership.create({
    id: randomUUID(), businessId: business.id, userId: owner.id, role: 'owner', createdBy: owner.id,
  }, { transaction });
  await models.BusinessSettings.create({
    businessId: business.id, businessName, defaultLanguage: language, updatedBy: owner.id,
    paymentMethods: [...rules.paymentMethods],
  }, { transaction });
  await models.Location.create({ id: randomUUID(), businessId: business.id, name: businessName, type: 'shop' }, { transaction });
  return business;
}

// The invited person answers one of THEIR OWN pending invitations, inside
// `transaction`. Looked up by the person's userId (not by a business: they
// aren't a member yet, so there's no req.business). Accept makes it active
// (and clears the owner-typed name, so the owner now sees the person's own
// name); decline ends it. Recorded in that business's ChangeLog.
// Returns false if there's no such pending invitation for this person.
async function answerInvitation(models, transaction, { membershipId, userId, answer, now }) {
  const m = await models.Membership.findOne({
    where: { id: membershipId, userId, isActive: false, removedAt: null },
    transaction,
  });
  if (!m) return false;
  const changes = answer === 'accept' ? { isActive: true, invitedName: null } : { removedAt: now, declinedAt: now };
  await m.update(changes, { transaction });
  await recordChange(models, transaction, {
    businessId: m.businessId, entity: 'membership', entityId: m.id, changedBy: userId, changedAt: now,
    before: { status: 'invited', role: m.role }, after: { status: answer === 'accept' ? 'active' : 'declined' },
  });
  return true;
}

// True if the person has an ACTIVE membership in a real (not practice)
// business other than `businessId`. A deliberate cross-business question,
// asked before an owner resets someone's password: if they belong elsewhere,
// the reset would let this owner sign in as them there, so it's refused.
async function belongsToAnotherRealBusiness(models, transaction, { userId, businessId }) {
  const count = await models.Membership.count({
    where: { userId, isActive: true, businessId: { [Op.ne]: businessId } },
    include: [{ model: models.Business, as: 'business', where: { isPractice: false } }],
    transaction,
  });
  return count > 0;
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
  createBusinessWithOwner, answerInvitation, belongsToAnotherRealBusiness,
  invalidToken, takenError, emailLink, TOKEN_LIFETIME_MS,
};
