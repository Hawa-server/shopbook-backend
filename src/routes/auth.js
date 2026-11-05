// The account endpoints under /api/auth (and /api/legal/current): sign-up,
// sign-in and sign-out, "me", password, terms, email confirmation, forgot and
// reset password, and changing phone number, email or language.
//
// Rules that run through all of them:
// - Sign-in and forgot password never reveal whether an account exists.
// - Passwords are only ever checked against their argon2id hash.
// - Changing a password, phone number or email adds 1 to the person's
//   sessionVersion, which ends every OTHER sign-in at once; the phone that
//   made the change gets a fresh cookie and stays signed in.
// - Emails are sent only after the database change has committed.

const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { AppError } = require('../lib/errors');
const { parseBody, fieldError, fieldRules } = require('../lib/validation');
const { normalizeGhanaPhone } = require('../lib/phone');
const { passwordProblem, hashPassword, verifyPassword, getDummyHash } = require('../lib/passwords');
const { setSessionCookie, clearSessionCookie, requireSession } = require('../lib/session');
const { requireOrigin } = require('../middleware/csrf');
const { requireTerms } = require('../middleware/requireTerms');
const { TERMS_VERSION, currentLegal } = require('../legal');
const { maskEmail } = require('../emails/templates');
const accounts = require('../services/accounts');

const PHONE_MESSAGE = 'Enter a Ghana mobile number, for example 024 123 4567.';
const FORGOT_ANSWER = "If that account has a confirmed email, we've sent a link. Check your inbox and spam.";

// Counts one hit on `limiter` for `key` and throws 429 RATE_LIMITED (with
// Retry-After) when that key is over its limit. For limits whose key is only
// known after reading the body (a login, a user).
function limit(limiter, key, res) {
  const { allowed, retryAfterSeconds } = limiter.consume(key);
  if (allowed) return;
  res.set('Retry-After', String(retryAfterSeconds));
  throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
}

// Checks the person's current password before a sensitive change, counting
// the attempt against their limit. A wrong password is 400 WRONG_PASSWORD.
async function checkCurrentPassword(deps, req, res, currentPassword) {
  limit(deps.limiters.passwordCheckByUser, `user:${req.user.id}`, res);
  if (!(await verifyPassword(req.user.passwordHash, currentPassword))) {
    throw new AppError(400, 'WRONG_PASSWORD', "That's not your current password.", { currentPassword: "That's not your current password." });
  }
}

// Throws VALIDATION_FAILED on the field if the new password breaks the rules.
function checkNewPassword(field, password) {
  const problem = passwordProblem(password);
  if (problem) throw fieldError(field, problem);
}

// Adds 1 to the user's sessionVersion together with other changes, inside a
// transaction. Done in SQL ("sessionVersion + 1") so two changes at the same
// moment can't both write the same number.
function bumpSession(sequelize) {
  return sequelize.literal('sessionVersion + 1');
}

// Gives the phone that made a change a fresh cookie with the new
// sessionVersion, keeping the original sign-in time (the 90-day limit).
async function keepThisSignIn(deps, req, res) {
  const user = await deps.getModels().User.findByPk(req.user.id);
  setSessionCookie(res, deps.config, { userId: user.id, sessionVersion: user.sessionVersion, issuedAt: req.session.issuedAt }, deps.now());
  return user;
}

// ---- Handlers -------------------------------------------------------------

// POST /api/auth/signup: creates the business, its settings (with the
// business name), the owner, the owner's membership and the first shop, all
// in ONE transaction: either everything exists afterwards or nothing does.
// Then signs the owner in and sends the confirm-email link.
function signup(deps) {
  const schema = z.object({
    name: fieldRules.name('your name'),
    phone: z.string({ error: PHONE_MESSAGE }),
    email: fieldRules.email(),
    password: fieldRules.password(),
    businessName: fieldRules.name("your business's name"),
    language: fieldRules.language(),
    acceptTerms: z.literal(true, { error: 'Accept the privacy notice and terms to continue.' }),
    termsVersion: z.string({ error: 'Missing terms version.' }),
  });

  return async function handleSignup(req, res) {
    const body = parseBody(schema, req.body);
    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) throw fieldError('phone', PHONE_MESSAGE);
    checkNewPassword('password', body.password);
    if (body.termsVersion !== TERMS_VERSION) {
      throw new AppError(409, 'TERMS_VERSION_MISMATCH', 'The privacy notice and terms have changed. Please read and accept them again.');
    }

    const passwordHash = await hashPassword(body.password); // slow on purpose: done before the transaction
    const models = deps.getModels();
    const now = new Date(deps.now());

    let created;
    try {
      created = await deps.runTransaction(async (transaction) => {
        const user = await models.User.create({
          id: randomUUID(), name: body.name, phone, email: body.email, passwordHash,
          language: body.language, termsVersion: TERMS_VERSION, termsAcceptedAt: now,
        }, { transaction });
        const business = await models.Business.create({ id: randomUUID() }, { transaction });
        await models.BusinessSettings.create({
          businessId: business.id, businessName: body.businessName, defaultLanguage: body.language, updatedBy: user.id,
        }, { transaction });
        await models.Location.create({ id: randomUUID(), businessId: business.id, name: body.businessName, type: 'shop' }, { transaction });
        await models.Membership.create({
          id: randomUUID(), businessId: business.id, userId: user.id, role: 'owner', createdBy: user.id,
        }, { transaction });
        const token = await accounts.issueEmailToken(models, transaction, { userId: user.id, purpose: 'confirm_email', email: body.email, now });
        return { user, token };
      });
    } catch (err) {
      throw accounts.takenError(err);
    }

    const { user, token } = created;
    const emailSent = await deps.email.sendEmail({
      to: user.email, template: 'confirm_email', language: user.language, userId: user.id,
      data: { name: user.name, link: accounts.emailLink(deps.config, 'confirm-email', token) },
    });
    setSessionCookie(res, deps.config, { userId: user.id, sessionVersion: user.sessionVersion, issuedAt: deps.now() }, deps.now());
    res.status(201).json({ ...(await accounts.buildMe(models, user)), emailSent });
  };
}

// POST /api/auth/signin: { login, password }, where login is a phone number
// or an email. Every failure gets the same answer, and an unknown login still
// checks a password hash, so neither the words nor the timing tell anyone
// whether an account exists.
function signin(deps) {
  const schema = z.object({
    login: z.string({ error: 'Enter your phone number or email.' }).trim().min(1, 'Enter your phone number or email.').max(254),
    password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(1000),
  });

  return async function handleSignin(req, res) {
    const body = parseBody(schema, req.body);
    limit(deps.limiters.signinByLogin, `login:${accounts.loginKey(body.login).value}`, res);

    const models = deps.getModels();
    const user = await accounts.findUserByLogin(models, body.login);
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, body.password)
      : (await verifyPassword(await getDummyHash(), body.password), false);
    if (!passwordOk) throw new AppError(401, 'WRONG_LOGIN', 'Wrong phone number, email or password.');

    setSessionCookie(res, deps.config, { userId: user.id, sessionVersion: user.sessionVersion, issuedAt: deps.now() }, deps.now());
    res.json(await accounts.buildMe(models, user));
  };
}

// POST /api/auth/signout: removes the cookie on this phone (nothing else).
function signout(deps) {
  return function handleSignout(req, res) {
    clearSessionCookie(res, deps.config);
    res.status(204).end();
  };
}

// GET /api/auth/me: who's signed in, their businesses and roles, terms status.
function me(deps) {
  return async function handleMe(req, res) {
    res.json(await accounts.buildMe(deps.getModels(), req.user));
  };
}

// PATCH /api/auth/me: { language }, the person's own app language.
function updateMe(deps) {
  const schema = z.object({ language: fieldRules.language() });
  return async function handleUpdateMe(req, res) {
    const body = parseBody(schema, req.body);
    await req.user.update({ language: body.language });
    res.json(await accounts.buildMe(deps.getModels(), req.user));
  };
}

// POST /api/auth/change-password: { currentPassword, newPassword }. Also how
// staff replace a temporary password at first sign-in. Ends other sign-ins.
function changePassword(deps) {
  const schema = z.object({ currentPassword: fieldRules.password(), newPassword: fieldRules.password() });
  return async function handleChangePassword(req, res) {
    const body = parseBody(schema, req.body);
    await checkCurrentPassword(deps, req, res, body.currentPassword);
    checkNewPassword('newPassword', body.newPassword);
    if (body.newPassword === body.currentPassword) {
      throw fieldError('newPassword', 'Choose a password different from your current one.');
    }

    const passwordHash = await hashPassword(body.newPassword);
    const models = deps.getModels();
    await deps.runTransaction((transaction) => models.User.update(
      { passwordHash, mustChangePassword: false, sessionVersion: bumpSession(models.User.sequelize) },
      { where: { id: req.user.id }, transaction },
    ));
    const user = await keepThisSignIn(deps, req, res);
    res.json(await accounts.buildMe(models, user));
  };
}

// POST /api/auth/accept-terms: { version }, recording that the person
// accepted this version of the privacy notice and terms, and when.
function acceptTerms(deps) {
  const schema = z.object({ version: z.string({ error: 'Missing terms version.' }) });
  return async function handleAcceptTerms(req, res) {
    const body = parseBody(schema, req.body);
    if (body.version !== TERMS_VERSION) {
      throw new AppError(409, 'TERMS_VERSION_MISMATCH', 'The privacy notice and terms have changed. Please read and accept them again.');
    }
    await req.user.update({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date(deps.now()) });
    res.json(await accounts.buildMe(deps.getModels(), req.user));
  };
}

// POST /api/auth/confirm-email/send: "Send the link again". Sends the link for
// a pending new email if there is one, otherwise for the unconfirmed email.
// Sending is this endpoint's whole job, so a failure is 502 EMAIL_NOT_SENT.
function resendConfirmation(deps) {
  return async function handleResend(req, res) {
    limit(deps.limiters.emailByAccount, `user:${req.user.id}`, res);
    const user = req.user;
    let purpose;
    let email;
    if (user.pendingEmail) {
      purpose = 'change_email';
      email = user.pendingEmail;
    } else if (user.email && !user.emailConfirmedAt) {
      purpose = 'confirm_email';
      email = user.email;
    } else {
      throw new AppError(409, 'NOTHING_TO_CONFIRM', user.email ? 'Your email is already confirmed.' : 'You have no email to confirm.');
    }

    const models = deps.getModels();
    const now = new Date(deps.now());
    const token = await deps.runTransaction((transaction) => accounts.issueEmailToken(models, transaction, { userId: user.id, purpose, email, now }));
    const sent = await deps.email.sendEmail({
      to: email, template: purpose, language: user.language, userId: user.id,
      data: { name: user.name, link: accounts.emailLink(deps.config, 'confirm-email', token) },
    });
    if (!sent) throw new AppError(502, 'EMAIL_NOT_SENT', "Couldn't send the email. Try again later.");
    res.json({ emailSent: true });
  };
}

// POST /api/auth/confirm-email: { token } from a confirm-email or change-email
// link. No sign-in needed (the link may be opened on another device). The
// token is used up in the same transaction as the change, so if the change
// fails (the new email was taken meanwhile), the link still works later.
function confirmEmail(deps) {
  const schema = z.object({ token: z.string({ error: 'Missing token.' }).min(1).max(200) });
  return async function handleConfirmEmail(req, res) {
    const body = parseBody(schema, req.body);
    const models = deps.getModels();
    const now = new Date(deps.now());

    try {
      await deps.runTransaction(async (transaction) => {
        const row = await accounts.claimEmailToken(models, transaction, { token: body.token, purposes: ['confirm_email', 'change_email'], now });
        if (!row) throw accounts.invalidToken();
        const user = await models.User.findByPk(row.userId, { transaction });

        if (row.purpose === 'confirm_email') {
          if (!user || user.email !== row.email) throw accounts.invalidToken(); // the email has changed since
          await user.update({ emailConfirmedAt: now }, { transaction });
        } else {
          if (!user || user.pendingEmail !== row.email) throw accounts.invalidToken(); // a newer change replaced it
          await user.update({ email: row.email, pendingEmail: null, emailConfirmedAt: now }, { transaction });
        }
      });
    } catch (err) {
      throw accounts.takenError(err);
    }
    res.json({ emailConfirmed: true });
  };
}

// POST /api/auth/forgot-password: { login }. Answers at once, always with the
// same words, then does the work in the background: if the account exists
// and its email is confirmed, a reset link (30 minutes) goes to that email.
// Every error in the background work is caught and logged (never crashes).
function forgotPassword(deps) {
  const schema = z.object({
    login: z.string({ error: 'Enter your phone number or email.' }).trim().min(1, 'Enter your phone number or email.').max(254),
  });
  return async function handleForgot(req, res) {
    const body = parseBody(schema, req.body);
    limit(deps.limiters.emailByAccount, `login:${accounts.loginKey(body.login).value}`, res);

    deps.background.run('forgot_password', async () => {
      const models = deps.getModels();
      const user = await accounts.findUserByLogin(models, body.login);
      if (!user || !user.email || !user.emailConfirmedAt) return; // nothing is sent to an unconfirmed email
      const now = new Date(deps.now());
      const token = await deps.runTransaction((transaction) => accounts.issueEmailToken(models, transaction, {
        userId: user.id, purpose: 'reset_password', email: user.email, now,
      }));
      await deps.email.sendEmail({
        to: user.email, template: 'reset_password', language: user.language, userId: user.id,
        data: { name: user.name, link: accounts.emailLink(deps.config, 'reset-password', token) },
      });
    });

    res.json({ message: FORGOT_ANSWER });
  };
}

// POST /api/auth/reset-password: { token, newPassword } from a reset link.
// Sets the password and ends EVERY sign-in, including this phone's (the
// person signs in again with the new password).
function resetPassword(deps) {
  const schema = z.object({
    token: z.string({ error: 'Missing token.' }).min(1).max(200),
    newPassword: fieldRules.password(),
  });
  return async function handleReset(req, res) {
    const body = parseBody(schema, req.body);
    checkNewPassword('newPassword', body.newPassword);
    const passwordHash = await hashPassword(body.newPassword);
    const models = deps.getModels();
    const now = new Date(deps.now());

    await deps.runTransaction(async (transaction) => {
      const row = await accounts.claimEmailToken(models, transaction, { token: body.token, purposes: ['reset_password'], now });
      if (!row) throw accounts.invalidToken();
      const user = await models.User.findByPk(row.userId, { transaction });
      if (!user || user.email !== row.email || !user.emailConfirmedAt) throw accounts.invalidToken();
      await models.User.update(
        { passwordHash, mustChangePassword: false, sessionVersion: bumpSession(models.User.sequelize) },
        { where: { id: user.id }, transaction },
      );
    });

    clearSessionCookie(res, deps.config);
    res.json({ passwordChanged: true });
  };
}

// PATCH /api/auth/me/phone: { currentPassword, newPhone }. Ends other sign-ins.
function changePhone(deps) {
  const schema = z.object({ currentPassword: fieldRules.password(), newPhone: z.string({ error: PHONE_MESSAGE }) });
  return async function handleChangePhone(req, res) {
    const body = parseBody(schema, req.body);
    await checkCurrentPassword(deps, req, res, body.currentPassword);
    const phone = normalizeGhanaPhone(body.newPhone);
    if (!phone) throw fieldError('newPhone', PHONE_MESSAGE);
    if (phone === req.user.phone) throw fieldError('newPhone', 'This is already your phone number.');

    const models = deps.getModels();
    try {
      await deps.runTransaction((transaction) => models.User.update(
        { phone, sessionVersion: bumpSession(models.User.sequelize) },
        { where: { id: req.user.id }, transaction },
      ));
    } catch (err) {
      const mapped = accounts.takenError(err);
      if (mapped.code === 'PHONE_TAKEN') mapped.fields = { newPhone: mapped.message };
      throw mapped;
    }
    const user = await keepThisSignIn(deps, req, res);
    res.json(await accounts.buildMe(models, user));
  };
}

// PATCH /api/auth/me/email: { currentPassword, newEmail }. The new email is
// kept as PENDING until its link is tapped (the old one keeps working until
// then), and a notice goes to the old email. Ends other sign-ins.
function changeEmail(deps) {
  const schema = z.object({ currentPassword: fieldRules.password(), newEmail: fieldRules.email() });
  return async function handleChangeEmail(req, res) {
    const body = parseBody(schema, req.body);
    await checkCurrentPassword(deps, req, res, body.currentPassword);
    if (body.newEmail === req.user.email) throw fieldError('newEmail', 'This is already your email.');

    const models = deps.getModels();
    const existing = await models.User.findOne({ where: { email: body.newEmail } });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'This email address already has an account.', { newEmail: 'This email address already has an account.' });
    }

    const now = new Date(deps.now());
    const oldEmail = req.user.email;
    const token = await deps.runTransaction(async (transaction) => {
      await models.User.update(
        { pendingEmail: body.newEmail, sessionVersion: bumpSession(models.User.sequelize) },
        { where: { id: req.user.id }, transaction },
      );
      return accounts.issueEmailToken(models, transaction, { userId: req.user.id, purpose: 'change_email', email: body.newEmail, now });
    });

    const user = await keepThisSignIn(deps, req, res);
    const emailSent = await deps.email.sendEmail({
      to: body.newEmail, template: 'change_email', language: user.language, userId: user.id,
      data: { name: user.name, link: accounts.emailLink(deps.config, 'confirm-email', token) },
    });
    if (oldEmail) {
      await deps.email.sendEmail({
        to: oldEmail, template: 'email_changed', language: user.language, userId: user.id,
        data: { name: user.name, newEmailMasked: maskEmail(body.newEmail) },
      });
    }
    res.json({ ...(await accounts.buildMe(models, user)), emailSent });
  };
}

// GET /api/legal/current: the current privacy notice and terms, both languages.
function legal() {
  return function handleLegal(req, res) {
    res.json(currentLegal());
  };
}

// ---- Route table ----------------------------------------------------------

// The account routes for the registry. `session` = signed in; `terms` = has
// accepted the current terms; `origin` = the Origin header must be the app's.
const authRoutes = [
  { method: 'GET', path: '/api/legal/current', build: () => [legal()] },
  { method: 'POST', path: '/api/auth/signup', build: (d) => [requireOrigin(d.config), d.limiters.signupByIp.middleware(), signup(d)] },
  { method: 'POST', path: '/api/auth/signin', build: (d) => [requireOrigin(d.config), d.limiters.signinByIp.middleware(), signin(d)] },
  { method: 'POST', path: '/api/auth/signout', build: (d) => [signout(d)] },
  { method: 'GET', path: '/api/auth/me', build: (d) => [requireSession(d), me(d)] },
  { method: 'PATCH', path: '/api/auth/me', build: (d) => [requireSession(d), updateMe(d)] },
  { method: 'POST', path: '/api/auth/change-password', build: (d) => [requireSession(d), changePassword(d)] },
  { method: 'POST', path: '/api/auth/accept-terms', build: (d) => [requireSession(d), acceptTerms(d)] },
  { method: 'POST', path: '/api/auth/confirm-email/send', build: (d) => [requireSession(d), requireTerms, d.limiters.emailByIp.middleware(), resendConfirmation(d)] },
  { method: 'POST', path: '/api/auth/confirm-email', build: (d) => [confirmEmail(d)] },
  { method: 'POST', path: '/api/auth/forgot-password', build: (d) => [requireOrigin(d.config), d.limiters.emailByIp.middleware(), forgotPassword(d)] },
  { method: 'POST', path: '/api/auth/reset-password', build: (d) => [requireOrigin(d.config), resetPassword(d)] },
  { method: 'PATCH', path: '/api/auth/me/phone', build: (d) => [requireSession(d), requireTerms, changePhone(d)] },
  { method: 'PATCH', path: '/api/auth/me/email', build: (d) => [requireSession(d), requireTerms, changeEmail(d)] },
];

module.exports = { authRoutes };
