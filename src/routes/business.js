// Locale endpoints (BE4.5):
// - GET /api/reference: the supported countries, currencies, languages and
//   payment methods, with names and money-writing rules. Public (the
//   sign-up screen needs it before anyone is signed in).
// - PATCH /api/business/locale: the owner changes the business's country,
//   currency or time zone, only until the first money record (then 409
//   CURRENCY_LOCKED).

const { z } = require('zod');
const locale = require('../locale');
const { parseBody, fieldRules } = require('../lib/validation');
const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { updateLocale } = require('../services/business');

// GET /api/reference: the reference tables, the same for everyone.
function reference() {
  return function handleReference(req, res) {
    res.json(locale.referenceData());
  };
}

// PATCH /api/business/locale: { country?, currency?, timezone? }, at least one.
function changeLocale(deps) {
  const schema = z.object({
    country: fieldRules.country().optional(),
    currency: z.string().trim().toUpperCase().optional(),
    timezone: z.string().trim().max(40).optional(),
  }).refine((b) => b.country || b.currency || b.timezone, { message: 'Give a country, currency or time zone to change.' });

  return async function handleChangeLocale(req, res) {
    const body = parseBody(schema, req.body);
    const models = deps.getModels();
    const now = new Date(deps.now());
    const business = await deps.runTransaction((transaction) => updateLocale(models, transaction, {
      businessId: req.business.id, changedBy: req.user.id, now, changes: body,
    }));
    res.json({
      country: business.country,
      currency: locale.currencyForPhone(business.currency),
      timezone: business.timezone,
      localeLocked: Boolean(business.moneyRecordedAt),
    });
  };
}

const businessRoutes = [
  { method: 'GET', path: '/api/reference', business: false, build: () => [reference()] },
  { method: 'PATCH', path: '/api/business/locale', business: true, build: (d) => [requireSession(d), requireAuth(d), requireRole('owner'), changeLocale(d)] },
];

module.exports = { businessRoutes };
