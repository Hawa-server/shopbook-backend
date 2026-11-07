// Changes to the Business row itself (its locale facts). The Business table
// is keyed by its own id, not by a businessId column, so scoped() doesn't
// cover it; this service is where those few changes live, always for the
// business requireAuth chose (never one named by the request).

const { AppError } = require('../lib/errors');
const locale = require('../locale');
const { recordChange } = require('./changeLog');
const { stampSequence } = require('../sync/runOperation');

// Changes a business's country, currency and/or time zone, inside
// `transaction`, and records it in the ChangeLog. Refused with 409
// CURRENCY_LOCKED once the business has its first money record
// (moneyRecordedAt): from then on amounts and business days would mean
// something else. Changing the country also resets the currency, time zone
// and payment methods to that country's defaults, unless given.
async function updateLocale(models, transaction, { businessId, changedBy, now, changes }) {
  const business = await models.Business.findByPk(businessId, { transaction });
  if (business.moneyRecordedAt) {
    throw new AppError(409, 'CURRENCY_LOCKED', "The country, currency and time zone can't change once money has been recorded.");
  }

  const countryCode = changes.country ?? business.country;
  const rules = locale.country(countryCode);
  const next = {
    country: countryCode,
    currency: changes.currency ?? (changes.country ? rules.currency : business.currency),
    timezone: changes.timezone ?? (changes.country ? rules.timezones[0] : business.timezone),
  };
  if (!locale.isCurrency(next.currency)) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', { currency: 'Choose a supported currency.' });
  }
  if (!rules.timezones.includes(next.timezone)) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', { timezone: "Choose one of this country's time zones." });
  }

  const before = { country: business.country, currency: business.currency, timezone: business.timezone };
  await business.update(next, { transaction });
  const countryChanged = Boolean(changes.country && changes.country !== before.country);
  if (countryChanged) {
    await models.BusinessSettings.update({ paymentMethods: [...rules.paymentMethods] }, { where: { businessId }, transaction });
  }
  await recordChange(models, transaction, {
    businessId, entity: 'business', entityId: businessId, changedBy, changedAt: now, before, after: next,
  });
  // The settings row changed (payment methods): phones must pull it again. Last step.
  if (countryChanged) await stampSequence(models, transaction, businessId, [{ model: 'BusinessSettings', where: {} }]);
  return business;
}

module.exports = { updateLocale };
