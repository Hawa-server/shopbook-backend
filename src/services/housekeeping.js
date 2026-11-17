// Housekeeping deletes: the short, explicit list of deletes allowed outside
// deleteBusinessData. Business RECORDS are never deleted except by
// deleteBusinessData (a closed business after 30 days, or a practice reset).
// The only other deletes are clean-ups of NON-record tables that hold
// short-lived technical data, such as expired one-time numbers.
//
// The rules:
// - only non-record tables (nonces, unused product photos);
// - each entry says which table and why;
// - adding anything to this list needs the project owner's OK (a test lists
//   exactly what's allowed, so a change can't slip in unnoticed).

const { Op } = require('sequelize');

const HOUSEKEEPING_DELETES = Object.freeze([
  Object.freeze({
    table: 'DeviceRequestNonce',
    why: "Each signed request deletes that device's expired one-time numbers (server plan, \"Nonce timing\"), so no background job is needed. Approved by the owner for BE5.",
  }),
  Object.freeze({
    table: 'Photo',
    why: 'Product photos are not permanent records. After each upload, at most 20 of THAT business\'s photos that no product uses, unused for 30 days, are deleted: the file in storage first, then the row. Approved by the owner for BE6.5 (11 Nov 2026).',
  }),
]);

// The photo clean-up rule's numbers (approved; change only with the owner's OK).
const PHOTO_UNUSED_DAYS = 30;
const PHOTO_CLEANUP_BATCH = 20;

// Deletes ONE device's expired nonces (they're useless after 10 minutes),
// inside `transaction`. Nothing else is ever deleted here.
function deleteExpiredNonces(models, transaction, { businessId, deviceId, now }) {
  return models.DeviceRequestNonce.destroy({
    where: { businessId, deviceId, expiresAt: { [Op.lt]: now } },
    transaction,
  });
}

// The photo clean-up rule (BE6.5), run after an upload, for that business
// only. A photo is "unused" when no product points at it; it has been unused
// since releasedAt (when a product last let go of it) or, if no product ever
// used it, since uploadedAt. After 30 days unused it's deleted:
//   1. the FILE first, so a failure leaves at worst a row without a file
//      (the download answers 404 and the phone that still has the photo
//      uploads it again: that heals it), never a file nobody can find;
//   2. then the ROW, only if it's STILL unused at that moment (the DELETE
//      re-checks both conditions), so a product that picked the photo again
//      meanwhile keeps its row.
// At most 20 per run, oldest first, so an upload never waits on a big
// clean-up. Returns how many rows were deleted. `storage` is the photo
// storage (src/lib/photoStorage.js); `now` a Date.
async function cleanUpUnusedPhotos({ sequelize, storage }, { businessId, now }) {
  const cutoff = new Date(now.getTime() - PHOTO_UNUSED_DAYS * 24 * 60 * 60 * 1000);
  const unused = `COALESCE(ph.releasedAt, ph.uploadedAt) < ?
    AND NOT EXISTS (SELECT 1 FROM Product p WHERE p.businessId = ph.businessId AND p.photoId = ph.id)`;
  const [candidates] = await sequelize.query(
    `SELECT ph.id, ph.storageKey FROM Photo ph WHERE ph.businessId = ? AND ${unused} ORDER BY ph.uploadedAt, ph.id LIMIT ${PHOTO_CLEANUP_BATCH}`,
    { replacements: [businessId, cutoff] },
  );
  let deleted = 0;
  for (const photo of candidates) {
    await storage.remove(photo.storageKey);
    const [result] = await sequelize.query(
      `DELETE ph FROM Photo ph WHERE ph.businessId = ? AND ph.id = ? AND ${unused}`,
      { replacements: [businessId, photo.id, cutoff] },
    );
    deleted += result.affectedRows ?? 0;
  }
  return deleted;
}

module.exports = { HOUSEKEEPING_DELETES, deleteExpiredNonces, cleanUpUnusedPhotos, PHOTO_UNUSED_DAYS, PHOTO_CLEANUP_BATCH };
