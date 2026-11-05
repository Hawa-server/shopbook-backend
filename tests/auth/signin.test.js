// Sign-in by phone number (typed any common way) or email (any case), the
// one message for every failure, the rate limit, and sign-out.

const request = require('supertest');
const db = require('../../src/db');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { resetDatabase, dbApp, appHeaders, signUpOwner, signInAgent } = require('../helpers/dbApp');

let ctx;
let owner;
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp();
  owner = await signUpOwner(ctx.app, ctx.config, { phone: '0244000001', email: 'kofi@example.test' });
});
afterAll(() => db.closeDatabase());

describe('POST /api/auth/signin', () => {
  test.each(['0244000001', '024 400 0001', '+233244000001', '233 24 400 0001', 'kofi@example.test', '  KOFI@Example.Test '])(
    'signs in with %p',
    async (login) => {
      const { agent, res } = await signInAgent(ctx.app, ctx.config, login, owner.body.password);
      expect(res.status).toBe(200);
      expect(res.body.user.phone).toBe('+233244000001');
      expect(res.headers['set-cookie'][0]).toMatch(/^sb_session=.+HttpOnly; SameSite=Lax$/);
      expect((await agent.get('/api/auth/me')).status).toBe(200);
    },
  );

  test('a wrong password, an unknown phone number and an unknown email give the same answer', async () => {
    const attempts = [
      ['0244000001', 'wrong-password-1'],
      ['0249999999', owner.body.password],
      ['nobody@example.test', owner.body.password],
      ['not a phone', owner.body.password],
    ];
    const answers = [];
    for (const [login, password] of attempts) {
      const { res } = await signInAgent(ctx.app, ctx.config, login, password);
      answers.push({ status: res.status, body: res.body, cookie: res.headers['set-cookie'] });
    }
    for (const answer of answers) {
      expect(answer).toEqual({
        status: 401,
        body: { error: { code: 'WRONG_LOGIN', message: 'Wrong phone number, email or password.' } },
        cookie: undefined,
      });
    }
  });

  test('allows 10 attempts per 15 minutes for one login, then 429', async () => {
    const limited = dbApp({ limiters: createAuthLimiters() });
    for (let i = 0; i < 10; i += 1) {
      expect((await signInAgent(limited.app, limited.config, '0244000001', 'wrong-password-1')).res.status).toBe(401);
    }
    const eleventh = await signInAgent(limited.app, limited.config, '024 400 0001', owner.body.password);
    expect(eleventh.res.status).toBe(429); // the same login typed differently counts together
    expect(eleventh.res.headers['retry-after']).toBeDefined();
  });

  test('needs the Origin header outside development', async () => {
    const res = await request(ctx.app).post('/api/auth/signin').set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: '0244000001', password: owner.body.password });
    expect(res.body.error.code).toBe('ORIGIN_REQUIRED');
  });
});

describe('POST /api/auth/signout', () => {
  test('removes the cookie on this phone only', async () => {
    const phoneA = await signInAgent(ctx.app, ctx.config, '0244000001', owner.body.password);
    const phoneB = await signInAgent(ctx.app, ctx.config, '0244000001', owner.body.password);
    const out = await phoneA.agent.post('/api/auth/signout').set('X-Requested-With', 'XMLHttpRequest');
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'][0]).toMatch(/^sb_session=;/);
    expect((await phoneA.agent.get('/api/auth/me')).status).toBe(401);
    expect((await phoneB.agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('GET /api/auth/me without signing in', () => {
  test('is 401 NOT_SIGNED_IN', async () => {
    const res = await request(ctx.app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NOT_SIGNED_IN');
  });

  test('a forged cookie is 401 too', async () => {
    const res = await request(ctx.app).get('/api/auth/me').set('Cookie', 'sb_session=eyJhbGciOiJub25lIn0.eyJ1c2VySWQiOiJ4In0.');
    expect(res.status).toBe(401);
  });
});
