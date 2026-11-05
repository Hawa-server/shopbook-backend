// Sign-up: one transaction creates the business, its settings (with the
// business name), the owner, the membership and the first shop; the owner is
// signed in and gets a confirm-email link. Also every refusal: rules for the
// password, phone number and terms, a phone or email already used, the
// Origin header, the rate limit, and the database's one-active-owner rule.

const request = require('supertest');
const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { resetDatabase, dbApp, appHeaders, signupBody, signUpOwner } = require('../helpers/dbApp');

let ctx;
beforeAll(async () => { await resetDatabase(); });
beforeEach(() => { ctx = dbApp(); });
afterAll(() => db.closeDatabase());

describe('POST /api/auth/signup', () => {
  test('creates everything in one go, signs the owner in and sends the confirm link', async () => {
    const { agent, body, res } = await signUpOwner(ctx.app, ctx.config, { phone: '024 555 0101', email: '  Ama@Example.TEST ' });
    expect(res.body.emailSent).toBe(true);
    expect(res.body.user).toEqual({
      id: expect.any(String), name: 'Ama Mensah', phone: '+233245550101', email: 'ama@example.test',
      emailConfirmed: false, pendingEmail: null, language: 'en', mustChangePassword: false,
    }); // every field of the documented `me` object, none missing
    expect(res.body.terms).toEqual({ currentVersion: '1', acceptedVersion: '1', accepted: true });
    expect(res.body.businesses).toHaveLength(1);
    expect(res.body.businesses[0]).toMatchObject({ name: body.businessName, role: 'owner', isPractice: false, status: 'active' });
    expect(res.headers['set-cookie'][0]).toMatch(/^sb_session=.+; Max-Age=2592000; Path=\/api; Expires=.+; HttpOnly; SameSite=Lax$/);

    // The rows in the database.
    const models = db.getModels();
    const user = await models.User.findOne({ where: { phone: '+233245550101' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(body.password);
    const businessId = res.body.businesses[0].id;
    expect(await models.BusinessSettings.findByPk(businessId)).toMatchObject({ businessName: 'Ama Fabrics', defaultLanguage: 'en', updatedBy: user.id });
    expect(await models.Location.count({ where: { businessId } })).toBe(1);
    expect(await models.Membership.findOne({ where: { businessId } })).toMatchObject({ userId: user.id, role: 'owner', isActive: true });

    // The confirm-email link went to the owner; only the token's hash is stored.
    const email = ctx.outbox.at(-1);
    expect(email).toMatchObject({ to: 'ama@example.test', template: 'confirm_email' });
    expect(email.data.link).toMatch(/^http:\/\/localhost:5173\/confirm-email\?token=/);
    const token = decodeURIComponent(email.data.link.split('token=')[1]);
    const stored = await models.EmailToken.findOne({ where: { userId: user.id } });
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(token);

    // The cookie works.
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);
  });

  test.each([
    ['a password under 8 characters', { password: 'short1' }, 'password', /at least 8/],
    ['a common password', { password: 'Password123' }, 'password', /too common/],
    ['a phone number that is not a Ghana mobile', { phone: '0301234567' }, 'phone', /Ghana mobile/],
    ['a bad email', { email: 'not-an-email' }, 'email', /valid email/],
    ['terms not accepted', { acceptTerms: false }, 'acceptTerms', /Accept the privacy notice/],
    ['no business name', { businessName: '   ' }, 'businessName', /business's name/],
    ['a business name over 60 characters', { businessName: 'x'.repeat(61) }, 'businessName', /at most 60/],
  ])('refuses %s with a clear message', async (_label, overrides, field, message) => {
    const res = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config)).send(signupBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.fields[field]).toMatch(message);
  });

  test('refuses an outdated terms version with 409 TERMS_VERSION_MISMATCH', async () => {
    const res = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config)).send(signupBody({ termsVersion: '0' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TERMS_VERSION_MISMATCH');
  });

  test('refuses a phone number or email that already has an account, and creates nothing', async () => {
    const { body } = await signUpOwner(ctx.app, ctx.config);
    const before = await db.getModels().Business.count();

    const samePhone = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config))
      .send(signupBody({ phone: `+233${body.phone.slice(1)}` }));
    expect(samePhone.status).toBe(409);
    expect(samePhone.body.error.code).toBe('PHONE_TAKEN');

    const sameEmail = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config))
      .send(signupBody({ email: body.email.toUpperCase() }));
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.error.code).toBe('EMAIL_TAKEN');

    expect(await db.getModels().Business.count()).toBe(before); // the transaction rolled back
  });

  test('still succeeds when the email fails, with emailSent false', async () => {
    const failing = { sendEmail: async () => false, sentInTests: [] };
    const app = dbApp({ email: failing });
    const res = await request(app.app).post('/api/auth/signup').set(appHeaders(app.config)).send(signupBody());
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
  });

  test('needs the Origin header outside development', async () => {
    const res = await request(ctx.app).post('/api/auth/signup').set('X-Requested-With', 'XMLHttpRequest').send(signupBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_REQUIRED');
  });

  test('allows 5 sign-ups per hour per IP, then 429', async () => {
    const limited = dbApp({ limiters: createAuthLimiters() });
    for (let i = 0; i < 5; i += 1) {
      expect((await request(limited.app).post('/api/auth/signup').set(appHeaders(limited.config)).send(signupBody())).status).toBe(201);
    }
    const sixth = await request(limited.app).post('/api/auth/signup').set(appHeaders(limited.config)).send(signupBody());
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('database rules (straight in MySQL)', () => {
  test('a second ACTIVE owner for the same business is refused by the database', async () => {
    const { res } = await signUpOwner(ctx.app, ctx.config);
    const other = await signUpOwner(ctx.app, ctx.config);
    const businessId = res.body.businesses[0].id;
    const otherUserId = other.res.body.user.id;

    const error = await db.getModels().Membership.create({
      id: randomUUID(), businessId, userId: otherUserId, role: 'owner', createdBy: otherUserId,
    }).catch((err) => err);
    // MySQL's own message names the key that refused it.
    expect(error.original.sqlMessage).toMatch(/Duplicate entry .* for key 'Membership.uq_membership_one_active_owner'/);

    // A manager in the same business is fine: the key only counts active owners.
    await expect(db.getModels().Membership.create({
      id: randomUUID(), businessId, userId: otherUserId, role: 'manager', createdBy: res.body.user.id,
    })).resolves.toBeDefined();
  });

  test('a business name over 60 characters or a receipt note over 120 is refused by the database', async () => {
    const { res } = await signUpOwner(ctx.app, ctx.config);
    const businessId = res.body.businesses[0].id;
    const sequelize = db.getSequelize();
    await expect(sequelize.query('UPDATE BusinessSettings SET businessName = ? WHERE businessId = ?', { replacements: ['x'.repeat(61), businessId] }))
      .rejects.toThrow();
    await expect(sequelize.query('UPDATE BusinessSettings SET receiptNote = ? WHERE businessId = ?', { replacements: ['x'.repeat(121), businessId] }))
      .rejects.toThrow();
    await expect(sequelize.query('UPDATE BusinessSettings SET receiptNote = ? WHERE businessId = ?', { replacements: ['x'.repeat(120), businessId] }))
      .resolves.toBeDefined();
  });
});
