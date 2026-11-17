// Product photos (BE6.5): uploading and downloading the files. Photos are
// NOT permanent records and are never needed to keep the books right, so
// this is kept simple and private:
// - the phone resizes and re-saves the photo, gives it a photoId (UUID), and
//   uploads it SEPARATELY from sync, retrying until it succeeds;
//   product.upsert only refers to it by photoId;
// - the server checks the real file type from the bytes (src/lib/imageCheck.js),
//   stores the file under <businessId>/<photoId>/<sha256> (built here from
//   the business requireAuth chose and a checked UUID: never from the
//   request), and THEN writes the Photo row, so a row never points at a file
//   that was never stored;
// - a photo is never overwritten: the same bytes again are "already there"
//   (200, and the file is written again, which heals a lost file); different
//   bytes for a photoId that's already used answer 409 PHOTO_ID_TAKEN. The
//   SHA-256 is part of the storage key, so even two uploads racing with
//   different bytes can't overwrite each other's file.

const { createHash } = require('node:crypto');
const { AppError } = require('../lib/errors');
const { inspectImage, PhotoError } = require('../lib/imageCheck');
const { cleanUpUnusedPhotos } = require('./housekeeping');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Downloads may be kept by the phone's browser for a year: a photoId's bytes
// never change (a new photo always gets a new ID). `private`: never in a
// shared cache.
const DOWNLOAD_CACHE = 'private, max-age=31536000, immutable';

// The photoId from the address, lower case, or 404 if it isn't a UUID (an
// address that can't be a photo is answered like one that doesn't exist).
function photoIdFrom(req) {
  const id = String(req.params.photoId).toLowerCase();
  if (!UUID.test(id)) throw new AppError(404, 'NOT_FOUND', 'Not found');
  return id;
}

// What the phone gets back about a stored photo.
function photoView(row) {
  return {
    photoId: row.id, contentType: row.contentType, byteSize: row.byteSize,
    width: row.width, height: row.height, uploadedAt: row.uploadedAt,
  };
}

const taken = () => new AppError(409, 'PHOTO_ID_TAKEN', 'This photo ID is already used. Make a new photo ID and upload again.');
const storageDown = () => new AppError(503, 'PHOTO_STORAGE_UNAVAILABLE', "Couldn't store the photo right now. The app will try again.");

// PUT /api/photos/:photoId. `s` is scoped() for the request's business.
async function uploadPhoto(deps, req, s) {
  const photoId = photoIdFrom(req);
  const bytes = Buffer.isBuffer(req.body) ? req.body : null;
  let info;
  try {
    info = inspectImage(bytes);
  } catch (err) {
    if (err instanceof PhotoError) throw new AppError(err.code === 'PHOTO_TOO_LARGE' ? 413 : 415, err.code, err.message);
    throw err;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `${req.business.id}/${photoId}/${sha256}`;
  const models = deps.getModels();

  // Already uploaded to this business: the same bytes are a repeat (the
  // phone didn't get the first answer); write the file again in case it was
  // lost, and answer as before. Different bytes: never overwritten.
  const existing = await s.Photo.findOne({ where: { id: photoId } });
  if (existing) {
    if (existing.sha256 !== sha256) throw taken();
    await storeOrFail(deps, storageKey, bytes, info.contentType);
    return photoView(existing);
  }
  // Used by another business (random UUIDs: in practice never): the same
  // answer as different bytes, saying nothing about the other business.
  if (await models.Photo.count({ where: { id: photoId } }) > 0) throw taken();

  // File first, then the row (a failed file write leaves no row).
  await storeOrFail(deps, storageKey, bytes, info.contentType);
  const row = {
    id: photoId, contentType: info.contentType, byteSize: bytes.length, width: info.width, height: info.height,
    sha256, storageKey, uploadedBy: req.user.id, uploadedAt: new Date(deps.now()), releasedAt: null,
  };
  try {
    await deps.runTransaction((transaction) => s.Photo.create(row, { transaction }));
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    // Two uploads of the same photo at once: the other one saved the row.
    const winner = await s.Photo.findOne({ where: { id: photoId } });
    if (winner && winner.sha256 === sha256) return photoView(winner);
    throw taken();
  }

  // The approved clean-up rule, for this business, after answering.
  deps.background.run('photo_cleanup', () => cleanUpUnusedPhotos(
    { sequelize: models.Photo.sequelize, storage: deps.photoStorage },
    { businessId: req.business.id, now: new Date(deps.now()) },
  ));
  return photoView(row);
}

// Writes the file; a storage failure becomes 503 (the phone retries later).
async function storeOrFail(deps, key, bytes, contentType) {
  try {
    await deps.photoStorage.put(key, bytes, contentType);
  } catch (err) {
    deps.logger.error('photo_storage_failed', { action: 'put', errorName: err.name });
    throw storageDown();
  }
}

// GET /api/photos/:photoId: { bytes, contentType } of this business's photo.
// Another business's photo, an unknown ID, one not uploaded yet, or a row
// whose file is missing: all the same 404 (the phone that has the photo
// uploads it again).
async function downloadPhoto(deps, req, s) {
  const photoId = photoIdFrom(req);
  const row = await s.Photo.findOne({ where: { id: photoId } });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Not found');
  let file;
  try {
    file = await deps.photoStorage.get(row.storageKey);
  } catch (err) {
    deps.logger.error('photo_storage_failed', { action: 'get', errorName: err.name });
    throw new AppError(503, 'PHOTO_STORAGE_UNAVAILABLE', "Couldn't load the photo right now. Try again later.");
  }
  if (!file) {
    deps.logger.warn('photo_file_missing', { photoId });
    throw new AppError(404, 'NOT_FOUND', 'Not found');
  }
  return { bytes: file.bytes, contentType: row.contentType };
}

module.exports = { uploadPhoto, downloadPhoto, DOWNLOAD_CACHE };
