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
//
// Empty for now. In BE5 the nonce clean-up joins it: each signed request
// deletes that device's expired DeviceRequestNonce rows (server plan,
// "Nonce timing"), so no background job is needed.

const HOUSEKEEPING_DELETES = Object.freeze([]);

module.exports = { HOUSEKEEPING_DELETES };
