// scoped(): the ONLY way route handlers read or write business tables.
//
// Business isolation rule: every query on business data is limited to the
// signed-in person's business, taken from the database by requireAuth
// (req.business), never from the request. scoped() makes that automatic:
// every read and write it does adds `businessId = req.business.id`, and it
// refuses any attempt to choose a businessId yourself. A handler therefore
// can't forget the scope, and can't widen it.
//
// What it offers per business model: findOne, findAll, count, create, update.
// Deliberately NO destroy: business records are only ever deleted by
// deleteBusinessData (a closed business after 30 days, a practice reset).
// update also refuses permanent records (sales, repayments…), which are
// never changed (PERMANENT_MODELS in src/models/index.js).

const { BUSINESS_MODELS, PERMANENT_MODELS } = require('../models');

// Thrown for a programming mistake (never shown to the phone as such: it
// becomes a 500 with a reference, and the log says what was wrong).
class ScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScopeError';
  }
}

// True if `where` (or anything nested in it) names businessId: a handler
// trying to pick the business itself.
function mentionsBusinessId(where) {
  if (!where || typeof where !== 'object') return false;
  if (Array.isArray(where)) return where.some(mentionsBusinessId);
  return Reflect.ownKeys(where).some((key) => key === 'businessId' || mentionsBusinessId(where[key]));
}

// Adds the business scope to a where clause, refusing one that sets its own.
function scopeWhere(where, businessId, modelName) {
  if (mentionsBusinessId(where)) throw new ScopeError(`scoped(${modelName}): businessId comes from the request, not from the query`);
  return { ...(where ?? {}), businessId };
}

// Returns { Membership: {…}, Location: {…}, … } for the business requireAuth
// chose for this request. Each model gets the five scoped methods.
function scoped(req, models) {
  const businessId = req.business?.id;
  if (!businessId) throw new ScopeError('scoped() needs req.business (put requireAuth before the handler)');

  const result = {};
  for (const name of BUSINESS_MODELS) {
    const Model = models[name];
    result[name] = {
      // Reads: the same options as Sequelize, with the scope added.
      findOne: (options = {}) => Model.findOne({ ...options, where: scopeWhere(options.where, businessId, name) }),
      findAll: (options = {}) => Model.findAll({ ...options, where: scopeWhere(options.where, businessId, name) }),
      count: (options = {}) => Model.count({ ...options, where: scopeWhere(options.where, businessId, name) }),

      // create: sets businessId itself; refuses a value that tries to set it.
      create(values, options = {}) {
        if ('businessId' in values) throw new ScopeError(`scoped(${name}).create: businessId comes from the request`);
        return Model.create({ ...values, businessId }, options);
      },

      // update: always within the business, and only with an explicit where
      // (so it can never change every row of the business by accident).
      update(values, options = {}) {
        if (PERMANENT_MODELS.includes(name)) throw new ScopeError(`scoped(${name}).update: permanent records are never changed`);
        if ('businessId' in values) throw new ScopeError(`scoped(${name}).update: businessId can't be changed`);
        if (!options.where || Reflect.ownKeys(options.where).length === 0) throw new ScopeError(`scoped(${name}).update needs a where`);
        return Model.update(values, { ...options, where: scopeWhere(options.where, businessId, name) });
      },
    };
  }
  return result;
}

module.exports = { scoped, ScopeError };
