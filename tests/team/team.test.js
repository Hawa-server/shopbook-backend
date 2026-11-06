// BE3: choosing the business (X-Business), the owner's team endpoints, staff
// temporary passwords, invitations for existing accounts (which must reveal
// nothing about the account), accept/decline, removal and resets.

const request = require('supertest');
const db = require('../../src/db');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const TEMP = /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/;

let ctx;
beforeAll(() => resetDatabase());
beforeEach(() => { ctx = dbApp(); });
afterAll(() => db.closeDatabase());

// Headers for a business request.
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });

// An owner with a business: { agent, body, businessId, userId }.
async function owner(overrides) {
  const { agent, body, res } = await signUpOwner(ctx.app, ctx.config, overrides);
  return { agent, body, businessId: res.body.businesses[0].id, userId: res.body.user.id };
}

// Adds a brand-new staff member; returns the answer and the new person's sign-in details.
async function addStaff(o, role = 'associate', extra = {}) {
  const phone = signupBody().phone; // a fresh, unused number
  const res = await o.agent.post('/api/team').set(biz(o.businessId)).send({ name: 'Kofi Boateng', phone, role, ...extra });
  return { res, phone, password: res.body.temporaryPassword };
}

// A staff member who has finished first sign-in (own password, terms accepted).
async function readyStaff(o, role = 'associate') {
  const { res, phone, password } = await addStaff(o, role);
  const { agent } = await signInAgent(ctx.app, ctx.config, phone, password);
  await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: password, newPassword: 'my-own-pass-2026' });
  await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
  return { agent, phone, password: 'my-own-pass-2026', membershipId: res.body.member.membershipId };
}

describe('choosing the business (X-Business)', () => {
  test('a missing X-Business is 400 BUSINESS_REQUIRED', async () => {
    const o = await owner();
    const res = await o.agent.get('/api/team').set(XHR);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BUSINESS_REQUIRED');
  });

  test("another business's ID, a made-up ID or a non-UUID is 404, never 403", async () => {
    const a = await owner();
    const b = await owner();
    for (const id of [b.businessId, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await a.agent.get('/api/team').set(biz(id));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test('X-Business is allowed by CORS for the app', async () => {
    const res = await request(ctx.app).options('/api/team').set('Origin', ctx.config.CLIENT_URL)
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'x-business');
    expect(res.headers['access-control-allow-headers']).toMatch(/X-Business/);
  });
});

describe('adding a new staff member', () => {
  test('gets a temporary password shown once, stored only as a hash, never logged or in ChangeLog', async () => {
    const o = await owner();
    const { res, phone } = await addStaff(o, 'manager', { email: 'kofi@example.test' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.temporaryPassword).toMatch(TEMP);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.member).toMatchObject({ name: 'Kofi Boateng', role: 'manager', status: 'active', email: 'kofi@example.test', mustChangePassword: true });

    const temp = res.body.temporaryPassword;
    const user = await db.getModels().User.findOne({ where: { phone: `+233${phone.slice(1)}` } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(temp);
    const changes = await db.getModels().ChangeLog.findAll({ where: { businessId: o.businessId } });
    expect(changes).toHaveLength(1);
    expect(JSON.stringify(changes)).not.toContain(temp);
    expect(ctx.lines.join('\n')).not.toContain(temp);
  });

  test("first sign-in: password change, then terms, then the role's own limits", async () => {
    const o = await owner();
    const { phone, password } = await addStaff(o, 'associate');
    const { agent, res: signedIn } = await signInAgent(ctx.app, ctx.config, phone, password);
    expect(signedIn.body.user.mustChangePassword).toBe(true);

    expect((await agent.get('/api/team').set(biz(o.businessId))).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: password, newPassword: 'my-own-pass-2026' });
    expect((await agent.get('/api/team').set(biz(o.businessId))).body.error.code).toBe('TERMS_REQUIRED');
    await agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    const res = await agent.get('/api/team').set(biz(o.businessId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN'); // now it's only the role
  });

  test('ALREADY_MEMBER for someone already in the team; bad input is refused', async () => {
    const o = await owner();
    const { phone } = await addStaff(o);
    const again = await o.agent.post('/api/team').set(biz(o.businessId)).send({ name: 'Kofi', phone, role: 'manager' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_MEMBER');
    const owner2 = await o.agent.post('/api/team').set(biz(o.businessId)).send({ name: 'X', phone: '0201112233', role: 'owner' });
    expect(owner2.body.error.fields.role).toBeDefined();
    const badPhone = await o.agent.post('/api/team').set(biz(o.businessId)).send({ name: 'X', phone: '0302123456', role: 'manager' });
    expect(badPhone.body.error.fields.phone).toMatch(/Ghana mobile/);
  });
});

describe('managers and associates', () => {
  test('get 403 on every team endpoint', async () => {
    const o = await owner();
    const target = await addStaff(o);
    const targetId = target.res.body.member.membershipId;
    for (const role of ['manager', 'associate']) {
      const staff = await readyStaff(o, role);
      // Each request is made just before it's sent (supertest needs that).
      const calls = [
        () => staff.agent.get('/api/team'),
        () => staff.agent.post('/api/team').send({ name: 'X', phone: '0201112299', role: 'associate' }),
        () => staff.agent.patch(`/api/team/${targetId}`).send({ role: 'manager' }),
        () => staff.agent.post(`/api/team/${targetId}/reset-password`),
        () => staff.agent.delete(`/api/team/${targetId}`),
      ];
      for (const call of calls) {
        const res = await call().set(biz(o.businessId));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  }, 120000); // two staff members' worth of argon2 hashing
});

describe('inviting someone who already has an account', () => {
  test('reveals nothing about the existing account, and leaves it untouched', async () => {
    const a = await owner();
    const b = await owner({ name: 'Real Name Of B', email: 'real.b@example.test' });
    const fresh = await addStaff(a);

    const res = await a.agent.post('/api/team').set(biz(a.businessId))
      .send({ name: 'Name The Owner Typed', phone: b.body.phone, role: 'manager', email: 'typed@example.test' });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeNull();
    expect(res.body.emailSent).toBeNull();
    expect(res.body.member).toMatchObject({ name: 'Name The Owner Typed', email: null, status: 'invited', mustChangePassword: null });
    // Same fields as a new-member answer.
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(fresh.res.body).sort());
    expect(Object.keys(res.body.member).sort()).toEqual(Object.keys(fresh.res.body.member).sort());

    const list = await a.agent.get('/api/team').set(biz(a.businessId));
    for (const text of [JSON.stringify(res.body), JSON.stringify(list.body)]) {
      expect(text).not.toContain('Real Name Of B');
      expect(text).not.toContain('real.b@example.test');
      expect(text).not.toContain(b.userId);
    }

    // B's account is unchanged: same password, same email, no typed email.
    expect((await signInAgent(ctx.app, ctx.config, b.body.phone, b.body.password)).res.status).toBe(200);
    const bUser = await db.getModels().User.findByPk(b.userId);
    expect(bUser).toMatchObject({ name: 'Real Name Of B', email: 'real.b@example.test', mustChangePassword: false });

    // A pending invitation is not membership yet.
    expect((await b.agent.get('/api/team').set(biz(a.businessId))).status).toBe(404);
    expect((await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Again', phone: b.body.phone, role: 'associate' })).body.error.code)
      .toBe('ALREADY_INVITED');
  });

  test('the invited person sees it in /me and can accept; then they are a member', async () => {
    const a = await owner({ businessName: 'Shop A' });
    const b = await owner({ name: 'Real Name Of B' });
    const invite = await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Typed', phone: b.body.phone, role: 'manager' });
    const membershipId = invite.body.member.membershipId;

    const me = await b.agent.get('/api/auth/me');
    expect(me.body.invitations).toEqual([{ membershipId, businessName: 'Shop A', role: 'manager', invitedAt: expect.any(String) }]);

    const accepted = await b.agent.post(`/api/auth/invitations/${membershipId}/accept`).set(XHR);
    expect(accepted.status).toBe(200);
    expect(accepted.body.invitations).toEqual([]);
    expect(accepted.body.businesses.map((x) => [x.name, x.role])).toEqual(expect.arrayContaining([['Shop A', 'manager']]));

    const row = (await a.agent.get('/api/team').set(biz(a.businessId))).body.members.find((m) => m.membershipId === membershipId);
    expect(row).toMatchObject({ status: 'active', name: 'Real Name Of B' }); // now a member: shown as themselves

    expect((await b.agent.post(`/api/auth/invitations/${membershipId}/accept`).set(XHR)).status).toBe(404); // twice → 404
  });

  test('decline ends it; the owner can invite again; nobody else can answer an invitation', async () => {
    const a = await owner();
    const b = await owner();
    const c = await owner();
    const invite = await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Typed', phone: b.body.phone, role: 'associate' });
    const membershipId = invite.body.member.membershipId;

    expect((await c.agent.post(`/api/auth/invitations/${membershipId}/accept`).set(XHR)).status).toBe(404);
    expect((await a.agent.post(`/api/auth/invitations/${membershipId}/decline`).set(XHR)).status).toBe(404);

    const declined = await b.agent.post(`/api/auth/invitations/${membershipId}/decline`).set(XHR);
    expect(declined.status).toBe(200);
    expect(declined.body.invitations).toEqual([]);
    const row = (await a.agent.get('/api/team').set(biz(a.businessId))).body.members.find((m) => m.membershipId === membershipId);
    expect(row).toMatchObject({ status: 'declined', name: 'Typed', email: null });

    const again = await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Typed again', phone: b.body.phone, role: 'manager' });
    expect(again.status).toBe(201);
    expect(again.body.member).toMatchObject({ membershipId, status: 'invited', name: 'Typed again' });
  });
});

describe('removing someone', () => {
  test('their next request here is 403 ACCESS_REMOVED; their own business still works', async () => {
    const a = await owner();
    const b = await owner();
    const invite = await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Typed', phone: b.body.phone, role: 'manager' });
    const membershipId = invite.body.member.membershipId;
    await b.agent.post(`/api/auth/invitations/${membershipId}/accept`).set(XHR);
    // (as a manager of A, B gets FORBIDDEN on team; that proves B can reach A)
    expect((await b.agent.get('/api/team').set(biz(a.businessId))).body.error.code).toBe('FORBIDDEN');

    const removed = await a.agent.delete(`/api/team/${membershipId}`).set(biz(a.businessId));
    expect(removed.status).toBe(200);
    expect(removed.body.member.status).toBe('removed');

    const there = await b.agent.get('/api/team').set(biz(a.businessId));
    expect(there.status).toBe(403);
    expect(there.body.error.code).toBe('ACCESS_REMOVED');
    expect((await b.agent.get('/api/team').set(biz(b.businessId))).status).toBe(200); // still signed in, own business fine
    expect((await b.agent.get('/api/auth/me')).body.businesses.map((x) => x.id)).toEqual([b.businessId]);
    expect((await a.agent.delete(`/api/team/${membershipId}`).set(biz(a.businessId))).body.error.code).toBe('MEMBER_REMOVED');
  });
});

describe("the owner resets a staff member's password", () => {
  test('their old sign-ins end, and the new temporary password must be changed', async () => {
    const o = await owner();
    const staff = await readyStaff(o);
    const reset = await o.agent.post(`/api/team/${staff.membershipId}/reset-password`).set(biz(o.businessId));
    expect(reset.status).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(reset.body.temporaryPassword).toMatch(TEMP);

    expect((await staff.agent.get('/api/auth/me')).status).toBe(401); // old sign-in ended
    expect((await signInAgent(ctx.app, ctx.config, staff.phone, staff.password)).res.status).toBe(401);
    const { agent, res } = await signInAgent(ctx.app, ctx.config, staff.phone, reset.body.temporaryPassword);
    expect(res.body.user.mustChangePassword).toBe(true);
    expect((await agent.get('/api/team').set(biz(o.businessId))).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const log = await db.getModels().ChangeLog.findAll({ where: { entityId: staff.membershipId } });
    expect(JSON.stringify(log)).not.toContain(reset.body.temporaryPassword);
    expect(log.some((row) => row.after?.event === 'password_reset')).toBe(true);
  });

  test('is refused (RESET_NOT_ALLOWED) for someone who also belongs to another business', async () => {
    const a = await owner();
    const b = await owner();
    const invite = await a.agent.post('/api/team').set(biz(a.businessId)).send({ name: 'Typed', phone: b.body.phone, role: 'manager' });
    await b.agent.post(`/api/auth/invitations/${invite.body.member.membershipId}/accept`).set(XHR);
    const res = await a.agent.post(`/api/team/${invite.body.member.membershipId}/reset-password`).set(biz(a.businessId));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('RESET_NOT_ALLOWED');
    expect((await signInAgent(ctx.app, ctx.config, b.body.phone, b.body.password)).res.status).toBe(200); // unchanged
  });
});

describe('roles and the owner row', () => {
  test('a role changes and is recorded; the owner can never be changed, removed or reset', async () => {
    const o = await owner();
    const { res } = await addStaff(o, 'associate');
    const id = res.body.member.membershipId;
    const changed = await o.agent.patch(`/api/team/${id}`).set(biz(o.businessId)).send({ role: 'manager' });
    expect(changed.body.member.role).toBe('manager');
    const log = await db.getModels().ChangeLog.findAll({ where: { entityId: id } });
    expect(log).toHaveLength(2); // added, then the role change
    expect(log.find((row) => row.before)).toMatchObject({ before: { role: 'associate' }, after: { role: 'manager' }, changedBy: o.userId });

    const ownerRow = (await o.agent.get('/api/team').set(biz(o.businessId))).body.members[0];
    expect(ownerRow.role).toBe('owner');
    for (const call of [
      () => o.agent.patch(`/api/team/${ownerRow.membershipId}`).send({ role: 'manager' }),
      () => o.agent.delete(`/api/team/${ownerRow.membershipId}`),
      () => o.agent.post(`/api/team/${ownerRow.membershipId}/reset-password`),
    ]) {
      const r = await call().set(biz(o.businessId));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('OWNER_CANNOT_CHANGE');
    }
  });

  test("another business's membership ID is 404", async () => {
    const a = await owner();
    const b = await owner();
    const { res } = await addStaff(b);
    const theirs = res.body.member.membershipId;
    for (const call of [
      () => a.agent.patch(`/api/team/${theirs}`).send({ role: 'manager' }),
      () => a.agent.delete(`/api/team/${theirs}`),
      () => a.agent.post(`/api/team/${theirs}/reset-password`),
    ]) {
      expect((await call().set(biz(a.businessId))).status).toBe(404);
    }
  });
});

describe('rate limits', () => {
  test('adding: 20 per hour per owner; resets: 10 per hour per owner', async () => {
    const limited = dbApp({ limiters: createAuthLimiters() });
    ctx = limited;
    const o = await owner();
    for (let i = 0; i < 20; i += 1) expect((await addStaff(o)).res.status).toBe(201);
    const extra = await addStaff(o);
    expect(extra.res.status).toBe(429);
    expect(extra.res.body.error.code).toBe('RATE_LIMITED');

    const staff = (await o.agent.get('/api/team').set(biz(o.businessId))).body.members.find((m) => m.role !== 'owner');
    for (let i = 0; i < 10; i += 1) {
      expect((await o.agent.post(`/api/team/${staff.membershipId}/reset-password`).set(biz(o.businessId))).status).toBe(200);
    }
    expect((await o.agent.post(`/api/team/${staff.membershipId}/reset-password`).set(biz(o.businessId))).status).toBe(429);
  }, 120000);
});
