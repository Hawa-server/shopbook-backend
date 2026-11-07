// Housekeeping deletes: the short, explicit list of deletes allowed outside
// deleteBusinessData. Business RECORDS are never deleted except by
// deleteBusinessData (a closed business after 30 days, or a practice reset).
// The only other deletes are clean-ups of NON-record tables that hold
// short-lived technical data, such as expired one-time numbers.
//
// The rules:
// - only non-record tables (nonces, and expired one-time tokens if needed);
// - each entry says which table and why;
// - adding anything to this list needs the project owner's OK (a test lists
//   exactly what's allowed, so a change can't slip in unnoticed).

const { Op } = require('sequelize');

const HOUSEKEEPING_DELETES = Object.freeze([
  Object.freeze({
    table: 'DeviceRequestNonce',
    why: "Each signed request deletes that device's expired one-time numbers (server plan, \"Nonce timing\"), so no background job is needed. Approved by the owner for BE5.",
  }),
]);

// Deletes ONE device's expired nonces (they're useless after 10 minutes),
// inside `transaction`. Nothing else is ever deleted here.
function deleteExpiredNonces(models, transaction, { businessId, deviceId, now }) {
  return models.DeviceRequestNonce.destroy({
    where: { businessId, deviceId, expiresAt: { [Op.lt]: now } },
    transaction,
  });
}

module.exports = { HOUSEKEEPING_DELETES, deleteExpiredNonces };
