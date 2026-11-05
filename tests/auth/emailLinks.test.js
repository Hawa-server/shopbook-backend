// Email links: confirming an email (once, 24 hours, only the newest link),
// "Send the link again" (502 when sending fails), forgot password (the same
// answer whatever happens, nothing to an unconfirmed email), reset password
// (once, 30 minutes, ends every sign-in), and changing phone number or email.

const request = require('supertest');
const db = require('../../src/db');
const { resetDatabase, dbApp, createClock, appHeaders, signUpOwner, signInAgent, tokenFrom } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

beforeAll(() => resetDatabase());
afterAll(() => db.closeDatabase());

// Confirms the owner's email with the newest confirm link.
async function confirm(ctx, to) {
  return request(ctx.app).post('/api/auth/confirm-email').set(XHR).send({ token: tokenFrom(ctx.outbox, 'confirm_email', to) });
}

describe('confirm email', () => {
  test('the link confirms the email once', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    const first = await confirm(ctx, body.email);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ emailConfirmed: true });
    expect((await agent.get('/api/auth/me')).body.user.emailConfirmed).toBe(true);

    const again = await confirm(ctx, body.email);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  test('expires after 24 hours', async () => {
    const clock = createClock();
    const ctx = dbApp({ clock });
    const { body } = await signUpOwner(ctx.app, ctx.config);
    clock.advance(24 * HOUR + MINUTE);
    expect((await confirm(ctx, body.email)).body.error.code).toBe('INVALID_TOKEN');
  });

  test('"Send the link again" makes only the newest link work', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    const oldToken = tokenFrom(ctx.outbox, 'confirm_email', body.email);
    const resent = await agent.post('/api/auth/confirm-email/send').set(XHR);
    expect(resent.status).toBe(200);
    expect(resent.body).toEqual({ emailSent: true });

    expect((await request(ctx.app).post('/api/auth/confirm-email').set(XHR).send({ token: oldToken })).body.error.code).toBe('INVALID_TOKEN');
    expect((await confirm(ctx, body.email)).status).toBe(200);
    expect((await agent.post('/api/auth/confirm-email/send').set(XHR)).body.error.code).toBe('NOTHING_TO_CONFIRM');
  });

  test('"Send the link again" answers 502 EMAIL_NOT_SENT when sending fails', async () => {
    const ctx = dbApp();
    const { body } = await signUpOwner(ctx.app, ctx.config);
    const failing = dbApp({ email: { sendEmail: async () => false, sentInTests: [] } });
    const { agent } = await signInAgent(failing.app, failing.config, body.email, body.password);
    const res = await agent.post('/api/auth/confirm-email/send').set(XHR);
    expect(res.status).toBe(502);
    expect(res.body.error).toEqual({ code: 'EMAIL_NOT_SENT', message: "Couldn't send the email. Try again later." });
  });

  test('a made-up token is refused', async () => {
    const ctx = dbApp();
    const res = await request(ctx.app).post('/api/auth/confirm-email').set(XHR).send({ token: 'made-up-token' });
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('forgot and reset password', () => {
  const FORGOT = "If that account has a confirmed email, we've sent a link. Check your inbox and spam.";

  // Asks for a reset link and waits for the background work to finish.
  async function forgot(ctx, login) {
    const res = await request(ctx.app).post('/api/auth/forgot-password').set(appHeaders(ctx.config)).send({ login });
    await ctx.deps.background.idle();
    return res;
  }

  test('gives the same answer for a real, an unconfirmed and an unknown account, and emails only the confirmed one', async () => {
    const ctx = dbApp();
    const confirmed = await signUpOwner(ctx.app, ctx.config);
    await confirm(ctx, confirmed.body.email);
    const unconfirmed = await signUpOwner(ctx.app, ctx.config);
    const sentBefore = ctx.outbox.length;

    const answers = [];
    for (const login of [confirmed.body.phone, unconfirmed.body.email, 'nobody@example.test', '0209999999']) {
      const res = await forgot(ctx, login);
      answers.push([res.status, res.body]);
    }
    for (const answer of answers) expect(answer).toEqual([200, { message: FORGOT }]);

    const sent = ctx.outbox.slice(sentBefore);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: confirmed.body.email, template: 'reset_password' });
    expect(sent[0].data.link).toMatch(/^http:\/\/localhost:5173\/reset-password\?token=/);
  });

  test('the reset link works once, signs out every phone, and the new password works', async () => {
    const ctx = dbApp();
    const { agent: phoneA, body } = await signUpOwner(ctx.app, ctx.config);
    await confirm(ctx, body.email);
    const { agent: phoneB } = await signInAgent(ctx.app, ctx.config, body.phone, body.password);
    await forgot(ctx, body.email);
    const token = tokenFrom(ctx.outbox, 'reset_password', body.email);

    const reset = await phoneA.post('/api/auth/reset-password').set(appHeaders(ctx.config)).send({ token, newPassword: 'fresh-start-2026' });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ passwordChanged: true });
    expect((await phoneA.get('/api/auth/me')).status).toBe(401);
    expect((await phoneB.get('/api/auth/me')).status).toBe(401);
    expect((await signInAgent(ctx.app, ctx.config, body.email, 'fresh-start-2026')).res.status).toBe(200);

    const again = await request(ctx.app).post('/api/auth/reset-password').set(appHeaders(ctx.config)).send({ token, newPassword: 'another-one-2026' });
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  test('the reset link expires after 30 minutes', async () => {
    const clock = createClock();
    const ctx = dbApp({ clock });
    const { body } = await signUpOwner(ctx.app, ctx.config);
    await confirm(ctx, body.email);
    await forgot(ctx, body.email);
    clock.advance(30 * MINUTE + 1000);
    const res = await request(ctx.app).post('/api/auth/reset-password').set(appHeaders(ctx.config))
      .send({ token: tokenFrom(ctx.outbox, 'reset_password', body.email), newPassword: 'fresh-start-2026' });
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('a failure in the background work is logged and never crashes the server', async () => {
    const ctx = dbApp({ getModels: () => { throw new Error('database unavailable'); } });
    const res = await forgot(ctx, 'someone@example.test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: FORGOT });
    const failure = ctx.lines.map((line) => JSON.parse(line)).find((entry) => entry.event === 'background_task_failed');
    expect(failure).toMatchObject({ task: 'forgot_password', errorName: 'Error' });
    expect(JSON.stringify(failure)).not.toContain('someone@example.test');
  });

  test('a weak new password is refused before the link is used', async () => {
    const ctx = dbApp();
    const { body } = await signUpOwner(ctx.app, ctx.config);
    await confirm(ctx, body.email);
    await forgot(ctx, body.email);
    const token = tokenFrom(ctx.outbox, 'reset_password', body.email);
    const weak = await request(ctx.app).post('/api/auth/reset-password').set(appHeaders(ctx.config)).send({ token, newPassword: 'short' });
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    const ok = await request(ctx.app).post('/api/auth/reset-password').set(appHeaders(ctx.config)).send({ token, newPassword: 'fresh-start-2026' });
    expect(ok.status).toBe(200); // the link was still usable
  });
});

describe('change phone number', () => {
  test('needs the current password, refuses a number someone else has, and ends other sign-ins', async () => {
    const ctx = dbApp();
    const { agent: phoneA, body } = await signUpOwner(ctx.app, ctx.config);
    const other = await signUpOwner(ctx.app, ctx.config);
    const { agent: phoneB } = await signInAgent(ctx.app, ctx.config, body.email, body.password);

    const wrong = await phoneA.patch('/api/auth/me/phone').set(XHR).send({ currentPassword: 'wrong-password', newPhone: '0207770001' });
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    const taken = await phoneA.patch('/api/auth/me/phone').set(XHR).send({ currentPassword: body.password, newPhone: other.body.phone });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('PHONE_TAKEN');

    const ok = await phoneA.patch('/api/auth/me/phone').set(XHR).send({ currentPassword: body.password, newPhone: '020 777 0001' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phone).toBe('+233207770001');
    expect((await phoneA.get('/api/auth/me')).status).toBe(200);
    expect((await phoneB.get('/api/auth/me')).status).toBe(401);
    expect((await signInAgent(ctx.app, ctx.config, '0207770001', body.password)).res.status).toBe(200);
  });
});

describe('change email', () => {
  test('keeps the new email pending until confirmed, tells the old address, and ends other sign-ins', async () => {
    const ctx = dbApp();
    const { agent: phoneA, body } = await signUpOwner(ctx.app, ctx.config);
    await confirm(ctx, body.email);
    const { agent: phoneB } = await signInAgent(ctx.app, ctx.config, body.phone, body.password);

    const res = await phoneA.patch('/api/auth/me/email').set(XHR).send({ currentPassword: body.password, newEmail: 'New.Address@Example.test' });
    expect(res.status).toBe(200);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.user).toMatchObject({ email: body.email, pendingEmail: 'new.address@example.test', emailConfirmed: true });
    expect((await phoneB.get('/api/auth/me')).status).toBe(401);

    const notice = ctx.outbox.find((e) => e.template === 'email_changed');
    expect(notice).toMatchObject({ to: body.email });
    expect(notice.text).toContain('ne***@example.test');
    expect(notice.text).not.toContain('new.address@example.test');

    // The old email still signs in until the new one is confirmed.
    expect((await signInAgent(ctx.app, ctx.config, body.email, body.password)).res.status).toBe(200);
    const confirmed = await request(ctx.app).post('/api/auth/confirm-email').set(XHR)
      .send({ token: tokenFrom(ctx.outbox, 'change_email', 'new.address@example.test') });
    expect(confirmed.status).toBe(200);
    const me = (await phoneA.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ email: 'new.address@example.test', pendingEmail: null, emailConfirmed: true });
    expect((await signInAgent(ctx.app, ctx.config, 'new.address@example.test', body.password)).res.status).toBe(200);
    expect((await signInAgent(ctx.app, ctx.config, body.email, body.password)).res.status).toBe(401);
  });

  test('refuses an email that belongs to someone else, or a wrong password', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    const other = await signUpOwner(ctx.app, ctx.config);
    const taken = await agent.patch('/api/auth/me/email').set(XHR).send({ currentPassword: body.password, newEmail: other.body.email });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('EMAIL_TAKEN');
    const wrong = await agent.patch('/api/auth/me/email').set(XHR).send({ currentPassword: 'wrong-password', newEmail: 'free@example.test' });
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
  });

  test('if someone else takes the address before the link is tapped, confirming is refused and nothing changes', async () => {
    const ctx = dbApp();
    const { agent, body } = await signUpOwner(ctx.app, ctx.config);
    await agent.patch('/api/auth/me/email').set(XHR).send({ currentPassword: body.password, newEmail: 'race@example.test' });
    await signUpOwner(ctx.app, ctx.config, { email: 'race@example.test' }); // someone signs up with it first
    const res = await request(ctx.app).post('/api/auth/confirm-email').set(XHR)
      .send({ token: tokenFrom(ctx.outbox, 'change_email', 'race@example.test') });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect((await agent.get('/api/auth/me')).body.user.email).toBe(body.email);
  });
});
