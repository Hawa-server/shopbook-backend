// Product photo endpoints (BE6.5). Both are business endpoints, signed by
// the phone's key:
// - PUT /api/photos/:photoId  (owner, manager): the body is the image itself;
// - GET /api/photos/:photoId  (every member): the image back.
// The rules (file type from the bytes, 300 KB, no EXIF/XMP, never
// overwritten) are in src/services/photos.js.

const express = require('express');
const { AppError } = require('../lib/errors');
const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { requireDevice } = require('../middleware/requireDevice');
const { scoped } = require('../services/scoped');
const { uploadPhoto, downloadPhoto, DOWNLOAD_CACHE } = require('../services/photos');
const { MAX_BYTES } = require('../lib/imageCheck');

// Reads the image bytes (whatever Content-Type is claimed: the type is
// checked from the bytes) up to 300 KB, and keeps them as req.rawBody so the
// device signature covers exactly these bytes. A bigger body is refused
// before it's read in full.
function readImageBody() {
  const read = express.raw({ type: () => true, limit: MAX_BYTES, verify: (req, res, buf) => { req.rawBody = buf; } });
  return function readImage(req, res, next) {
    read(req, res, (err) => {
      if (err?.type === 'entity.too.large') return next(new AppError(413, 'PHOTO_TOO_LARGE', 'The photo must be at most 300 KB and 1600 px on each side.'));
      return next(err);
    });
  };
}

// Counts one upload towards 60 per hour per person.
function uploadLimit(deps) {
  return function limitUploads(req, res, next) {
    const { allowed, retryAfterSeconds } = deps.limiters.photoUploadByUser.consume(`user:${req.user.id}`);
    if (allowed) return next();
    res.set('Retry-After', String(retryAfterSeconds));
    return next(new AppError(429, 'RATE_LIMITED', 'Too many photo uploads. The app will try again later.'));
  };
}

// PUT: stores the photo (200 with its details, also for a repeat).
function upload(deps) {
  return async function handleUpload(req, res) {
    const photo = await uploadPhoto(deps, req, scoped(req, deps.getModels()));
    res.json({ photo });
  };
}

// GET: the image, cacheable by the phone for a year (it never changes).
function download(deps) {
  return async function handleDownload(req, res) {
    const { bytes, contentType } = await downloadPhoto(deps, req, scoped(req, deps.getModels()));
    res.set({
      'Content-Type': contentType,
      'Cache-Control': DOWNLOAD_CACHE,
      'Content-Security-Policy': "default-src 'none'", // opened on its own, it can't run anything
      'Content-Disposition': 'inline',
    });
    res.send(bytes);
  };
}

const photoRoutes = [
  {
    method: 'PUT', path: '/api/photos/:photoId', business: true, signed: true,
    build: (d) => [readImageBody(), requireSession(d), requireAuth(d), requireDevice(d), requireRole('owner', 'manager'), uploadLimit(d), upload(d)],
  },
  {
    method: 'GET', path: '/api/photos/:photoId', business: true, signed: true,
    build: (d) => [requireSession(d), requireAuth(d), requireDevice(d), download(d)],
  },
];

module.exports = { photoRoutes };
