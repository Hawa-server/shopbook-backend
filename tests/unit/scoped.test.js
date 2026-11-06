// scoped(): every read and write gets businessId from the request (never
// from the caller), there's no destroy, update needs a where, and permanent
// records can never be updated. Uses stand-in models that record the calls.

const { scoped, ScopeError } = require('../../src/services/scoped');
const modelsModule = require('../../src/models');

// Stand-in models: each method records the options it was called with.
function fakeModels() {
  const calls = [];
  const models = {};
  for (const name of modelsModule.BUSINESS_MODELS) {
    models[name] = Object.fromEntries(['findOne', 'findAll', 'count', 'create', 'update', 'destroy'].map((method) => [
      method, async (...args) => { calls.push({ name, method, args }); return null; },
    ]));
  }
  return { models, calls };
}

const req = { business: { id: 'business-a' } };

describe('scoped()', () => {
  test('reads always add businessId from the request', async () => {
    const { models, calls } = fakeModels();
    const s = scoped(req, models);
    await s.Membership.findOne({ where: { id: 'm1' }, transaction: 't' });
    await s.Membership.findAll();
    await s.Location.count({ where: { type: 'shop' } });
    expect(calls.map((c) => c.args[0].where)).toEqual([
      { id: 'm1', businessId: 'business-a' },
      { businessId: 'business-a' },
      { type: 'shop', businessId: 'business-a' },
    ]);
    expect(calls[0].args[0].transaction).toBe('t');
  });

  test('a query that tries to choose its own businessId is refused, even nested', () => {
    const { models } = fakeModels();
    const s = scoped(req, models);
    expect(() => s.Membership.findOne({ where: { businessId: 'business-b' } })).toThrow(ScopeError);
    expect(() => s.Membership.findAll({ where: { userId: 'u', nested: { businessId: 'business-b' } } })).toThrow(ScopeError);
  });

  test('create sets businessId itself and refuses one given by the caller', async () => {
    const { models, calls } = fakeModels();
    const s = scoped(req, models);
    await s.ChangeLog.create({ id: 'c1', entity: 'membership' }, { transaction: 't' });
    expect(calls[0].args[0]).toEqual({ id: 'c1', entity: 'membership', businessId: 'business-a' });
    expect(() => s.ChangeLog.create({ id: 'c2', businessId: 'business-b' })).toThrow(ScopeError);
  });

  test('update always scopes the where, needs one, and never changes businessId', async () => {
    const { models, calls } = fakeModels();
    const s = scoped(req, models);
    await s.Membership.update({ role: 'manager' }, { where: { id: 'm1' }, transaction: 't' });
    expect(calls[0].args[1].where).toEqual({ id: 'm1', businessId: 'business-a' });
    expect(() => s.Membership.update({ role: 'manager' }, {})).toThrow(/needs a where/);
    expect(() => s.Membership.update({ businessId: 'business-b' }, { where: { id: 'm1' } })).toThrow(ScopeError);
  });

  test('there is no destroy', () => {
    const { models } = fakeModels();
    const s = scoped(req, models);
    for (const name of modelsModule.BUSINESS_MODELS) expect(s[name].destroy).toBeUndefined();
  });

  test('update refuses permanent-record models', () => {
    const { models } = fakeModels();
    modelsModule.PERMANENT_MODELS.push('ChangeLog'); // pretend, for this test only
    try {
      const s = scoped(req, models);
      expect(() => s.ChangeLog.update({ entity: 'x' }, { where: { id: 'c1' } })).toThrow(/permanent records are never changed/);
    } finally {
      modelsModule.PERMANENT_MODELS.pop();
    }
  });

  test('without req.business (no requireAuth) it refuses to work at all', () => {
    expect(() => scoped({}, fakeModels().models)).toThrow(/needs req.business/);
  });
});
