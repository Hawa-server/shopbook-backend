// BE4.5 against the real test database: sign-up with a country (default
// GH), the locale facts in `me`, GET /api/reference, the owner changing the
// locale until money is recorded (then CURRENCY_LOCKED), and the database's
// own rules for E.164 phones and language tags.

const request = require('supertest');
const db = require('../../src/db');
const { resetDatabase, dbApp, appHeaders, signupBody, signUpOwner, signInAgent } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });

let ctx;
beforeAll(() => resetDatabase());
beforeEach(() => { ctx = dbApp(); });
afterAll(() => db.closeDatabase());

describe('sign-up and me', () => {
  test('without a country the business is Ghana: GHS, Africa/Accra, cash and MoMo', async () => {
    const { res } = await signUpOwner(ctx.app, ctx.config);
    expect(res.body.businesses[0]).toMatchObject({
      country: 'GH',
      currency: { code: 'GHS', symbol: 'GH₵', minorUnits: 2, symbolPosition: 'before', symbolSpace: ' ', decimalSeparator: '.', groupSeparator: ',' },
      timezone: 'Africa/Accra',
      defaultLanguage: 'en',
      paymentMethods: ['cash', 'mobile_money'],
      localeLocked: false,
    });
    const business = await db.getModels().Business.findByPk(res.body.businesses[0].id);
    expect(business).toMatchObject({ country: 'GH', currency: 'GHS', timezone: 'Africa/Accra', moneyRecordedAt: null });
  });

  test('country GH can be given; a country or language not supported yet is refused', async () => {
    expect((await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config)).send(signupBody({ country: 'GH' }))).status).toBe(201);
    const ng = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config)).send(signupBody({ country: 'NG' }));
    expect(ng.status).toBe(400);
    expect(ng.body.error.fields.country).toMatch(/supported country/);
    const fr = await request(ctx.app).post('/api/auth/signup').set(appHeaders(ctx.config)).send(signupBody({ language: 'fr' }));
    expect(fr.body.error.fields.language).toMatch(/supported languages/);
  });

  test('phone numbers are stored in E.164 and sign-in reads local numbers with the chosen country', async () => {
    const { body, res } = await signUpOwner(ctx.app, ctx.config, { phone: '055 123 9876' });
    expect(res.body.user.phone).toBe('+233551239876');
    for (const login of ['0551239876', '+233551239876']) {
      const { agent } = { agent: request.agent(ctx.app) };
      const signedIn = await agent.post('/api/auth/signin').set(appHeaders(ctx.config)).send({ login, password: body.password, country: 'GH' });
      expect(signedIn.status).toBe(200);
    }
    expect((await signInAgent(ctx.app, ctx.config, '0551239876', body.password)).res.status).toBe(200); // country defaults to GH
  });
});

describe('GET /api/reference', () => {
  test('anyone gets the supported countries, currencies, languages and payment methods', async () => {
    const res = await request(ctx.app).get('/api/reference');
    expect(res.status).toBe(200);
    expect(res.body.countries.map((c) => c.code)).toEqual(['GH']);
    expect(res.body.currencies[0]).toMatchObject({ code: 'GHS', minorUnits: 2, symbol: 'GH₵' });
    expect(res.body.languages.map((l) => l.tag)).toEqual(['en', 'tw']);
    expect(res.body.countries[0].paymentMethods).toEqual([{ code: 'cash', name: 'Cash' }, { code: 'mobile_money', name: 'MoMo' }]);
  });
});

describe('PATCH /api/business/locale', () => {
  test('the owner can set it (recorded in ChangeLog) until money is recorded, then 409 CURRENCY_LOCKED', async () => {
    const { agent, res } = await signUpOwner(ctx.app, ctx.config);
    const businessId = res.body.businesses[0].id;
    const ok = await agent.patch('/api/business/locale').set(biz(businessId)).send({ country: 'GH', currency: 'ghs', timezone: 'Africa/Accra' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ country: 'GH', currency: { code: 'GHS' }, timezone: 'Africa/Accra', localeLocked: false });
    expect(await db.getModels().ChangeLog.count({ where: { businessId, entity: 'business' } })).toBe(1);

    await db.getModels().Business.update({ moneyRecordedAt: new Date() }, { where: { id: businessId } }); // as BE8's first sale will
    const locked = await agent.patch('/api/business/locale').set(biz(businessId)).send({ timezone: 'Africa/Accra' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('CURRENCY_LOCKED');
    expect((await agent.get('/api/auth/me')).body.businesses[0].localeLocked).toBe(true);
  });

  test('refuses an unsupported currency, a time zone outside the country, an empty change, and non-owners', async () => {
    const { agent, res } = await signUpOwner(ctx.app, ctx.config);
    const businessId = res.body.businesses[0].id;
    const send = (body) => agent.patch('/api/business/locale').set(biz(businessId)).send(body);
    expect((await send({ currency: 'USD' })).body.error.fields.currency).toMatch(/supported currency/);
    expect((await send({ timezone: 'Europe/London' })).body.error.fields.timezone).toMatch(/time zones/);
    expect((await send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await send({ country: 'NG' })).body.error.fields.country).toMatch(/supported country/);

    const staffPhone = signupBody().phone;
    const added = await agent.post('/api/team').set(biz(businessId)).send({ name: 'Staff', phone: staffPhone, role: 'manager' });
    const { agent: staff } = await signInAgent(ctx.app, ctx.config, staffPhone, added.body.temporaryPassword);
    await staff.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: 'manager-pass-2026' });
    await staff.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    expect((await staff.patch('/api/business/locale').set(biz(businessId)).send({ timezone: 'Africa/Accra' })).body.error.code).toBe('FORBIDDEN');
  });
});

describe('database rules', () => {
  test('a phone not in E.164 and a malformed language tag are refused by MySQL', async () => {
    const { res } = await signUpOwner(ctx.app, ctx.config);
    const sequelize = db.getSequelize();
    await expect(sequelize.query('UPDATE `User` SET phone = ? WHERE id = ?', { replacements: ['0241234567', res.body.user.id] })).rejects.toThrow();
    await expect(sequelize.query('UPDATE `User` SET language = ? WHERE id = ?', { replacements: ['EN!', res.body.user.id] })).rejects.toThrow();
    await expect(sequelize.query('UPDATE `User` SET language = ? WHERE id = ?', { replacements: ['fr', res.body.user.id] })).resolves.toBeDefined(); // a valid tag; the server's table decides what's offered
  });

  test('a business without payment methods, or with a bad currency code, is refused by MySQL', async () => {
    const { res } = await signUpOwner(ctx.app, ctx.config);
    const id = res.body.businesses[0].id;
    const sequelize = db.getSequelize();
    await expect(sequelize.query("UPDATE BusinessSettings SET paymentMethods = JSON_ARRAY() WHERE businessId = ?", { replacements: [id] })).rejects.toThrow();
    await expect(sequelize.query("UPDATE Business SET currency = 'gh' WHERE id = ?", { replacements: [id] })).rejects.toThrow();
  });
});
