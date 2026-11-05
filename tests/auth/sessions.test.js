// Sessions: the 30-day idle limit (renewed by use), the 90-day absolute limit
// (never moved by renewal), and sessionVersion: changing the password ends
// every other sign-in while the phone that changed it stays signed in.
// Also the terms gate and the language setting.

const request = require('supertest');
const db = require('../../src/db');
const { IDLE_MS, ABSOLUTE_MS } = require('../../src/lib/session');
const { resetDatabase, dbApp, createClock, appHeaders, signUpOwner, signInAgent } = require('../helpers/dbApp');

const DAY = 24 * 60 * 60 * 1000;
const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

beforeAll(() => resetDatabase());
afterAll(() => db.closeDatabase());

describe('session lifetimes', () => {
  test('idle: a sign-in unused for 30 days ends; one used every few weeks carries on', async () => {
    const clock = createClock();
    const ctx = dbApp({ clock });
    const { agent } = await signUpOwner(ctx.app, ctx.config);

    clock.advance(29 * DAY);
    expect((await agent.get('/api/auth/me')).status).toBe(200); // used: renewed for 30 more days
    clock.advance(29 * DAY);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    clock.advance(IDLE_MS + 1000); // more than 30 days without use
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  test('absolute: after 90 days the sign-in ends even if it was used every day', async () => {
    const clock = createClock();
    const ctx = dbApp({ clock });
    const { agent } = await signUpOwner(ctx.app, ctx.config);

    for (let day = 1; day < 90; day += 7) {
      clock.set(createClock().now() + day * DAY);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    }
    clock.set(createClock().now() + ABSOLUTE_MS + 1000);
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_SIGNED_IN');
  });
});

describe('POST /api/auth/change-password', () => {
  test('ends other sign-ins, keeps this one, and the new password works', async () => {
    const ctx = dbApp();
    const { agent: phoneA, body } = await signUpOwner(ctx.app, ctx.config);
    const { agent: phoneB } = await signInAgent(ctx.app, ctx.config, body.email, body.password);

    const res = await phoneA.post('/api/auth/change-password').set(XHR)
      .send({ currentPassword: body.password, newPassword: 'new-stall-password-9' });
    expect(res.status).toBe(200);

    expect((await phoneA.get('/api/auth/me')).status).toBe(200); // this phone stays signed in
    expect((await phoneB.get('/api/auth/me')).status).toBe(401); // the other one is signed out
    expect((await signInAgent(ctx.app, ctx.config, body.email, body.password)).res.status).toBe(401);
    expect((await signInAgent(ctx.app, ctx.config, body.email, 'new-stall-password-9')).res.status).toBe(200);
  });

  test('refuses a wrong current password, a weak new one, or the same one', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    const wrong = await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: 'not-it-123', newPassword: 'new-stall-password-9' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    const weak = await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: body.password, newPassword: '12345678' });
    expect(weak.body.error.fields.newPassword).toMatch(/too common/);
    const same = await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: body.password, newPassword: body.password });
    expect(same.body.error.fields.newPassword).toMatch(/different/);
  });
});

describe('terms', () => {
  test('GET /api/legal/current gives version 1 in English and Twi', async () => {
    const ctx = dbApp();
    const res = await request(ctx.app).get('/api/legal/current');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    for (const language of ['en', 'tw']) {
      expect(res.body.documents[language].privacy).toMatch(/Shop Book privacy notice/);
      expect(res.body.documents[language].terms).toMatch(/Shop Book terms of use/);
    }
  });

  test('someone who has not accepted the current terms gets 403 TERMS_REQUIRED until they do', async () => {
    const ctx = dbApp();
    const { agent, res: signedUp, body } = await signUpOwner(ctx.app, ctx.config);
    await db.getModels().User.update({ termsVersion: '0' }, { where: { id: signedUp.body.user.id } }); // as if the terms changed

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200); // me still works, so the app knows to ask
    expect(me.body.terms.accepted).toBe(false);
    const blocked = await agent.patch('/api/auth/me/phone').set(XHR).send({ currentPassword: body.password, newPhone: '0209999001' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TERMS_REQUIRED');

    expect((await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '0' })).body.error.code).toBe('TERMS_VERSION_MISMATCH');
    const accepted = await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    expect(accepted.body.terms.accepted).toBe(true);
    expect((await agent.patch('/api/auth/me/phone').set(XHR).send({ currentPassword: body.password, newPhone: '0209999001' })).status).toBe(200);
  });
});

describe('PATCH /api/auth/me', () => {
  test('changes the person\'s own language, and refuses anything else', async () => {
    const ctx = dbApp();
    const { agent } = await signUpOwner(ctx.app, ctx.config);
    const res = await agent.patch('/api/auth/me').set(XHR).send({ language: 'tw', name: 'Changed' });
    expect(res.status).toBe(200);
    expect(res.body.user.language).toBe('tw');
    expect(res.body.user.name).toBe('Ama Mensah'); // only the listed field is applied
    expect((await agent.patch('/api/auth/me').set(XHR).send({ language: 'fr' })).body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('CSRF on signed-in requests', () => {
  test('a signed-in POST from another website is refused even with the cookie', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    const res = await agent.post('/api/auth/change-password').set({ ...XHR, Origin: 'https://evil.example' })
      .send({ currentPassword: body.password, newPassword: 'new-stall-password-9' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(appHeaders(ctx.config).Origin).toBe(ctx.config.CLIENT_URL);
  });
});
