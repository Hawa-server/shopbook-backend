// The owner's team endpoints under /api/team: list members, add a member,
// change a role, reset a staff member's password, remove someone.
// Every one runs requireSession → requireAuth (X-Business) → owner only.
//
// Two kinds of "add":
// - a phone number with NO account yet: a new account is made with a
//   temporary password the owner gives the person in person (shown once);
// - a phone number that ALREADY has an account: an INVITATION. The person
//   accepts or declines at their next sign-in. The owner sees only the name
//   and number they typed, never that account's own name or email, and the
//   account itself (password, details) is not touched.
// Every change writes a ChangeLog row in the same transaction. Passwords,
// temporary or not, never appear in ChangeLog or in the logs.

const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { AppError } = require('../lib/errors');
const { parseBody, fieldError, fieldRules } = require('../lib/validation');
const { normalizePhone } = require('../lib/phone');
const { hashPassword, generateTemporaryPassword } = require('../lib/passwords');
const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { scoped } = require('../services/scoped');
const { updateUser } = require('../services/users');
const accounts = require('../services/accounts');

const PHONE_MESSAGE = 'Enter a valid mobile number, for example 024 123 4567.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAFF_ROLE = () => z.enum(['manager', 'associate'], { error: 'Choose Manager or Sales associate.' });

// A membership's state as the owner sees it.
function statusOf(m) {
  if (m.isActive) return 'active';
  if (!m.removedAt) return 'invited';
  return m.declinedAt ? 'declined' : 'removed';
}

// How one member looks to the owner. While a row still carries the name the
// owner typed for an invitation (invited, declined, or cancelled before
// accepting), only what the owner typed is shown: their name and the phone
// number. The account's own name and email are never shown for those rows.
function memberView(m) {
  const status = statusOf(m);
  const fromInvitation = Boolean(m.invitedName);
  return {
    membershipId: m.id,
    name: fromInvitation ? m.invitedName : m.user.name,
    phone: m.user.phone,
    email: fromInvitation ? null : (m.user.email ?? null),
    role: m.role,
    status,
    mustChangePassword: fromInvitation ? null : m.user.mustChangePassword,
    invitedAt: m.invitedAt ?? null,
    joinedAt: m.createdAt,
    removedAt: m.removedAt ?? null,
  };
}

// Loads one membership of THIS business by its ID (with its account), inside
// `transaction` if given, through scoped() (so only this business's rows can
// match). Anything else, including another business's membership ID, is 404:
// exactly as if it didn't exist.
async function findMemberOrNotFound(s, models, membershipId, transaction) {
  if (!UUID.test(String(membershipId))) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const m = await s.Membership.findOne({
    where: { id: membershipId },
    include: [{ model: models.User, as: 'user' }],
    transaction,
  });
  if (!m) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return m;
}

// Adds a ChangeLog row for a membership, through scoped() (it sets businessId).
function logChange(s, transaction, { membershipId, changedBy, changedAt, before = null, after = null }) {
  return s.ChangeLog.create({
    id: randomUUID(), entity: 'membership', entityId: membershipId, changedBy, changedAt, before, after,
  }, { transaction });
}

// Applies `changes` to one membership of this business through scoped().
function updateMember(s, transaction, membershipId, changes) {
  return s.Membership.update(changes, { where: { id: membershipId }, transaction });
}

// The owner's own row can never be changed, removed or reset here (AC11).
function refuseOwnerRow(m) {
  if (m.role === 'owner') throw new AppError(409, 'OWNER_CANNOT_CHANGE', "The owner can't be changed, removed or reset here.");
}

// Counts a hit on the per-owner and per-IP limits of one action.
function limitTeamAction(limiterByOwner, limiterByIp, req, res) {
  for (const [limiter, key] of [[limiterByOwner, `user:${req.user.id}`], [limiterByIp, `ip:${req.ip}`]]) {
    const { allowed, retryAfterSeconds } = limiter.consume(key);
    if (!allowed) {
      res.set('Retry-After', String(retryAfterSeconds));
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
    }
  }
}

// ---- Handlers -------------------------------------------------------------

// GET /api/team: every membership of this business (owner first, then
// active, invited, and ended ones).
function listTeam(deps) {
  const order = { active: 0, invited: 1, declined: 2, removed: 3 };
  return async function handleList(req, res) {
    const models = deps.getModels();
    const rows = await scoped(req, models).Membership.findAll({
      include: [{ model: models.User, as: 'user' }],
      order: [['createdAt', 'ASC']],
    });
    const members = rows.map(memberView).sort((a, b) => (
      Number(b.role === 'owner') - Number(a.role === 'owner') || order[a.status] - order[b.status]
    ));
    res.json({ members });
  };
}

// POST /api/team: { name, phone, role, email? }. A new account with a
// temporary password, or an invitation for an existing account. Either way
// the answer has the same fields; only `temporaryPassword` is null for an
// invitation (and `status` says which).
function addMember(deps) {
  const schema = z.object({
    name: fieldRules.name('their name'),
    phone: z.string({ error: PHONE_MESSAGE }),
    role: STAFF_ROLE(),
    email: z.preprocess((v) => (v === '' || v === null ? undefined : v), fieldRules.email().optional()),
  });

  return async function handleAdd(req, res) {
    limitTeamAction(deps.limiters.teamAddByOwner, deps.limiters.teamAddByIp, req, res);
    const body = parseBody(schema, req.body);
    const phone = normalizePhone(body.phone, req.business.country); // local numbers read with the business's country
    if (!phone) throw fieldError('phone', PHONE_MESSAGE);

    // Made (and hashed) every time, before the transaction, so adding a new
    // person and inviting an existing one take about the same time.
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const models = deps.getModels();
    const s = scoped(req, models);
    const now = new Date(deps.now());

    let outcome;
    try {
      outcome = await deps.runTransaction(async (transaction) => {
        const log = (membershipId, after, before = null) => logChange(s, transaction, {
          membershipId, changedBy: req.user.id, changedAt: now, before, after,
        });
        // User isn't business data (a person can belong to several businesses).
        const existingUser = await models.User.findOne({ where: { phone }, transaction });

        if (existingUser) {
          const existing = await s.Membership.findOne({ where: { userId: existingUser.id }, transaction });
          if (existing && existing.isActive) throw new AppError(409, 'ALREADY_MEMBER', 'This person is already in your team.');
          if (existing && !existing.removedAt) throw new AppError(409, 'ALREADY_INVITED', 'This person has already been invited.');

          let membershipId;
          if (existing) { // removed or declined before: invite again
            membershipId = existing.id;
            await updateMember(s, transaction, membershipId, {
              role: body.role, invitedName: body.name, invitedAt: now, removedAt: null, declinedAt: null,
            });
            await log(membershipId, { status: 'invited', role: body.role, name: body.name }, { status: statusOf(existing), role: existing.role });
          } else {
            membershipId = randomUUID();
            await s.Membership.create({
              id: membershipId, userId: existingUser.id, role: body.role,
              invitedName: body.name, invitedAt: now, isActive: false, createdBy: req.user.id,
            }, { transaction });
            await log(membershipId, { status: 'invited', role: body.role, name: body.name });
          }
          return { membership: await findMemberOrNotFound(s, models, membershipId, transaction), invited: true };
        }

        const user = await models.User.create({
          id: randomUUID(), name: body.name, phone, email: body.email ?? null, passwordHash,
          mustChangePassword: true, language: req.user.language,
        }, { transaction });
        const membershipId = randomUUID();
        await s.Membership.create({ id: membershipId, userId: user.id, role: body.role, createdBy: req.user.id }, { transaction });
        await log(membershipId, { status: 'active', role: body.role, name: body.name, newAccount: true });
        const membership = await findMemberOrNotFound(s, models, membershipId, transaction);
        const token = body.email
          ? await accounts.issueEmailToken(models, transaction, { userId: user.id, purpose: 'confirm_email', email: body.email, now })
          : null;
        return { membership, invited: false, token };
      });
    } catch (err) {
      throw accounts.takenError(err);
    }

    const { membership, invited, token } = outcome;
    let emailSent = null;
    if (token) {
      emailSent = await deps.email.sendEmail({
        to: membership.user.email, template: 'confirm_email', language: membership.user.language, userId: membership.user.id,
        data: { name: membership.user.name, link: accounts.emailLink(deps.config, 'confirm-email', token) },
      });
    }
    const member = memberView(membership);
    if (invited) member.email = null; // never the account's own email
    res.status(201).json({ member, temporaryPassword: invited ? null : temporaryPassword, emailSent });
  };
}

// PATCH /api/team/:membershipId: { role }, manager ↔ associate (also on a
// pending invitation). The owner's role never changes here.
function changeRole(deps) {
  const schema = z.object({ role: STAFF_ROLE() });
  return async function handleChangeRole(req, res) {
    const body = parseBody(schema, req.body);
    const models = deps.getModels();
    const now = new Date(deps.now());
    const s = scoped(req, models);
    const member = await deps.runTransaction(async (transaction) => {
      const m = await findMemberOrNotFound(s, models, req.params.membershipId, transaction);
      refuseOwnerRow(m);
      if (m.removedAt) throw new AppError(409, 'MEMBER_REMOVED', 'This person is no longer in your team.');
      if (m.role === body.role) return m;
      await updateMember(s, transaction, m.id, { role: body.role });
      await logChange(s, transaction, { membershipId: m.id, changedBy: req.user.id, changedAt: now, before: { role: m.role }, after: { role: body.role } });
      return findMemberOrNotFound(s, models, m.id, transaction);
    });
    res.json({ member: memberView(member) });
  };
}

// POST /api/team/:membershipId/reset-password: a new temporary password for
// an active staff member (shown once), who must then choose their own; all
// their sign-ins end. Refused when the person also belongs to another real
// business: otherwise this owner could sign in as them THERE.
function resetPassword(deps) {
  return async function handleReset(req, res) {
    limitTeamAction(deps.limiters.teamResetByOwner, deps.limiters.teamResetByIp, req, res);
    const models = deps.getModels();
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = new Date(deps.now());

    const s = scoped(req, models);
    const member = await deps.runTransaction(async (transaction) => {
      const m = await findMemberOrNotFound(s, models, req.params.membershipId, transaction);
      refuseOwnerRow(m);
      if (!m.isActive) throw new AppError(409, 'MEMBER_REMOVED', 'This person is no longer in your team.');

      if (await accounts.belongsToAnotherRealBusiness(models, transaction, { userId: m.userId, businessId: req.business.id })) {
        throw new AppError(403, 'RESET_NOT_ALLOWED', 'This person also uses Shop Book with another business. They can reset their password by email, or ask for help.');
      }

      await updateUser(models, transaction, m.userId, { passwordHash, mustChangePassword: true }, { endOtherSignIns: true });
      await logChange(s, transaction, {
        membershipId: m.id, changedBy: req.user.id, changedAt: now, after: { event: 'password_reset' }, // never the password itself
      });
      return findMemberOrNotFound(s, models, m.id, transaction);
    });
    res.json({ member: memberView(member), temporaryPassword });
  };
}

// DELETE /api/team/:membershipId: removes someone from THIS business (or
// cancels a pending invitation). Their next request here gets 403
// ACCESS_REMOVED; their sign-in and other businesses are untouched (ADR-19).
// From BE5 this also revokes their phones for this business.
function removeMember(deps) {
  return async function handleRemove(req, res) {
    const models = deps.getModels();
    const now = new Date(deps.now());
    const s = scoped(req, models);
    const member = await deps.runTransaction(async (transaction) => {
      const m = await findMemberOrNotFound(s, models, req.params.membershipId, transaction);
      refuseOwnerRow(m);
      if (m.removedAt) throw new AppError(409, 'MEMBER_REMOVED', 'This person is no longer in your team.');
      await updateMember(s, transaction, m.id, { isActive: false, removedAt: now });
      await logChange(s, transaction, {
        membershipId: m.id, changedBy: req.user.id, changedAt: now, before: { status: statusOf(m), role: m.role }, after: { status: 'removed' },
      });
      return findMemberOrNotFound(s, models, m.id, transaction);
    });
    res.json({ member: memberView(member) });
  };
}

// ---- Route table ----------------------------------------------------------

// Every team route: signed in, business chosen by X-Business, owner only.
const ownerOnly = (d) => [requireSession(d), requireAuth(d), requireRole('owner')];

const teamRoutes = [
  { method: 'GET', path: '/api/team', business: true, build: (d) => [...ownerOnly(d), listTeam(d)] },
  { method: 'POST', path: '/api/team', business: true, build: (d) => [...ownerOnly(d), addMember(d)] },
  { method: 'PATCH', path: '/api/team/:membershipId', business: true, build: (d) => [...ownerOnly(d), changeRole(d)] },
  { method: 'POST', path: '/api/team/:membershipId/reset-password', business: true, build: (d) => [...ownerOnly(d), resetPassword(d)] },
  { method: 'DELETE', path: '/api/team/:membershipId', business: true, build: (d) => [...ownerOnly(d), removeMember(d)] },
];

module.exports = { teamRoutes, memberView, statusOf };
