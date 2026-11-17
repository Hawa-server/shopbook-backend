// BE6.5: product photos, through the real endpoints on the test database
// with the in-memory photo storage. Covers: real WebP and JPEG (made by a
// real canvas in Chrome, like the app makes them) stored and downloaded
// byte for byte; every refusal (wrong type, too large, EXIF/XMP) storing
// nothing; repeats and PHOTO_ID_TAKEN; roles; the signature covering the
// bytes; product.upsert accepting a photo that hasn't arrived yet; a failed
// storage write leaving no row; a lost file healed by uploading again; and
// the approved clean-up rule (unused for 30 days, at most 20, this business
// only, file first then row).

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = require('../../src/db');
const { createAuthLimiters } = require('../../src/routes/limiters');
const { resetDatabase, dbApp, signUpOwner, signInAgent, signupBody } = require('../helpers/dbApp');

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };
const biz = (businessId) => ({ ...XHR, 'X-Business': businessId });
const FIXTURES = path.join(__dirname, '../fixtures/photos');
const file = (name) => fs.readFileSync(path.join(FIXTURES, name));
const DAY = 24 * 60 * 60 * 1000;

// One JPEG comment segment (FF FE + length + text); at most 65,533 bytes of text.
function commentSegment(bytes) {
  const header = Buffer.from([0xff, 0xfe, 0, 0]);
  header.writeUInt16BE(bytes.length + 2, 2);
  return Buffer.concat([header, bytes]);
}

// A different, still valid JPEG: the canvas JPEG with comment segments
// added (a comment is harmless, unlike EXIF). Used for unique photos and,
// with `totalBytes`, for an exact file size.
function jpegWithComment(text, totalBytes) {
  const base = file('canvas.jpg');
  const segments = [commentSegment(Buffer.from(text, 'latin1'))];
  let size = base.length + segments[0].length;
  while (totalBytes && size < totalBytes) {
    const room = totalBytes - size - 4; // a segment's own 4 header bytes
    const text = Math.min(Math.max(room, 0), 60000);
    segments.push(commentSegment(Buffer.alloc(text, 0x20)));
    size += text + 4;
  }
  return Buffer.concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
}

let ctx;
let shop;
beforeAll(async () => {
  await resetDatabase();
  ctx = dbApp();
  shop = await team(ctx);
}, 120000);
afterAll(() => db.closeDatabase());

// An owner, a manager and an associate of one business, each with a phone.
async function team(c) {
  const { agent, res } = await signUpOwner(c.app, c.config);
  const businessId = res.body.businesses[0].id;
  const device = await agent.registerIn(businessId);
  const owner = { phone: agent, businessId, userId: res.body.user.id, deviceId: device.deviceId };
  const staff = async (role) => {
    const phoneNumber = signupBody().phone;
    const added = await owner.phone.post('/api/team').set(biz(businessId)).send({ name: `A ${role}`, phone: phoneNumber, role });
    const signed = await signInAgent(c.app, c.config, phoneNumber, added.body.temporaryPassword);
    await signed.agent.post('/api/auth/change-password').set(XHR).send({ currentPassword: added.body.temporaryPassword, newPassword: `${role}-pass-2026` });
    signed.agent.setPassword(`${role}-pass-2026`);
    await signed.agent.post('/api/auth/accept-terms').set(XHR).send({ version: '1' });
    const d = await signed.agent.registerIn(businessId);
    return { phone: signed.agent, businessId, deviceId: d.deviceId, userId: signed.res.body.user.id };
  };
  return { owner, manager: await staff('manager'), associate: await staff('associate'), businessId };
}

const upload = (who, bytes, photoId = randomUUID(), contentType = 'image/jpeg') =>
  who.phone.put(`/api/photos/${photoId}`).set({ ...biz(who.businessId), 'Content-Type': contentType }).send(bytes);
const download = (who, photoId) => who.phone.get(`/api/photos/${photoId}`).set(biz(who.businessId));
const push = (who, ops) => who.phone.post('/api/sync/push').set(biz(who.businessId)).send({ deviceId: who.deviceId, operations: ops });
const op = (type, payload) => ({ opId: randomUUID(), type, recordedOnline: true, payload });
const storage = () => ctx.deps.photoStorage;
const photoRows = (businessId = shop.businessId) => db.getModels().Photo.count({ where: { businessId } });

describe('uploading and downloading', () => {
  test.each([
    ['a canvas JPEG', 'canvas.jpg', 'image/jpeg', 600, 450],
    ['a canvas WebP (extended format with a colour profile)', 'canvas.webp', 'image/webp', 600, 450],
    ['a simple lossy WebP', 'simple-lossy.webp', 'image/webp', 600, 450],
    ['a lossless WebP', 'small-lossless.webp', 'image/webp', 300, 225],
  ])('%s is stored and comes back byte for byte', async (_label, name, contentType, width, height) => {
    const bytes = file(name);
    const photoId = randomUUID();
    const res = await upload(shop.owner, bytes, photoId, contentType);
    expect(res.status).toBe(200);
    expect(res.body.photo).toEqual({ photoId, contentType, byteSize: bytes.length, width, height, uploadedAt: expect.any(String) });

    const got = await download(shop.associate, photoId);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe(contentType);
    expect(got.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(got.headers['content-security-policy']).toBe("default-src 'none'");
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.body, bytes)).toBe(0);
  });

  test('the type comes from the bytes, not the Content-Type header', async () => {
    const res = await upload(shop.owner, file('canvas.webp'), randomUUID(), 'application/octet-stream');
    expect([res.status, res.body.photo.contentType]).toEqual([200, 'image/webp']);
  });

  test('exactly 300 KB is accepted', async () => {
    const bytes = jpegWithComment('pad', 300 * 1024);
    expect(bytes.length).toBe(307200);
    expect((await upload(shop.manager, bytes)).status).toBe(200);
  });
});

describe('refused photos store nothing', () => {
  test.each([
    ['a PNG', () => file('photo.png'), 'image/png', 415, 'PHOTO_TYPE_NOT_ALLOWED'],
    ['an SVG (it can carry script)', () => file('drawing.svg'), 'image/jpeg', 415, 'PHOTO_TYPE_NOT_ALLOWED'],
    ['a PNG renamed to .jpg', () => file('png-renamed.jpg'), 'image/jpeg', 415, 'PHOTO_TYPE_NOT_ALLOWED'],
    ['an empty body', () => Buffer.alloc(0), 'image/jpeg', 415, 'PHOTO_TYPE_NOT_ALLOWED'],
    ['a 301 KB image', () => jpegWithComment('pad', 301 * 1024), 'image/jpeg', 413, 'PHOTO_TOO_LARGE'],
    ['a 2,000 px image', () => file('too-wide.jpg'), 'image/jpeg', 413, 'PHOTO_TOO_LARGE'],
    ['a JPEG with EXIF GPS data', () => file('exif-gps.jpg'), 'image/jpeg', 415, 'PHOTO_HAS_METADATA'],
    ['a JPEG with XMP data', () => file('xmp.jpg'), 'image/jpeg', 415, 'PHOTO_HAS_METADATA'],
    ['a WebP with an EXIF chunk', () => file('exif.webp'), 'image/webp', 415, 'PHOTO_HAS_METADATA'],
    ['a WebP with an XMP chunk', () => file('xmp.webp'), 'image/webp', 415, 'PHOTO_HAS_METADATA'],
  ])('%s', async (_label, bytes, contentType, status, code) => {
    const rowsBefore = await photoRows();
    const filesBefore = storage().objects.size;
    const photoId = randomUUID();
    const res = await upload(shop.owner, bytes(), photoId, contentType);
    expect([res.status, res.body.error.code]).toEqual([status, code]);
    expect(await photoRows()).toBe(rowsBefore);
    expect(storage().objects.size).toBe(filesBefore);
    expect((await download(shop.owner, photoId)).status).toBe(404);
  });

  test('a JSON body is not a photo', async () => {
    const res = await shop.owner.phone.put(`/api/photos/${randomUUID()}`).set(biz(shop.businessId)).send({ image: 'nope' });
    expect([res.status, res.body.error.code]).toEqual([415, 'PHOTO_TYPE_NOT_ALLOWED']);
  });
});

describe('repeats and photo IDs', () => {
  test('the same upload twice is 200 both times, with one row', async () => {
    const photoId = randomUUID();
    const first = await upload(shop.owner, file('canvas.jpg'), photoId);
    const second = await upload(shop.owner, file('canvas.jpg'), photoId);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body).toEqual(first.body);
    expect(await db.getModels().Photo.count({ where: { id: photoId } })).toBe(1);
  });

  test('different bytes for a used photoId: 409 PHOTO_ID_TAKEN, and the photo is unchanged', async () => {
    const photoId = randomUUID();
    await upload(shop.owner, file('canvas.jpg'), photoId);
    const res = await upload(shop.manager, file('canvas.webp'), photoId, 'image/webp');
    expect([res.status, res.body.error.code]).toEqual([409, 'PHOTO_ID_TAKEN']);
    const got = await download(shop.owner, photoId);
    expect(Buffer.compare(got.body, file('canvas.jpg'))).toBe(0);
  });

  test('an address that is not a photo ID is 404', async () => {
    expect((await download(shop.owner, 'not-a-uuid')).status).toBe(404);
    expect((await upload(shop.owner, file('canvas.jpg'), '../../etc')).status).toBe(404);
  });
});

describe('who may upload, and the signature', () => {
  test("an associate can't upload (403) but can download", async () => {
    const res = await upload(shop.associate, file('canvas.jpg'));
    expect([res.status, res.body.error.code]).toEqual([403, 'FORBIDDEN']);
    const photoId = randomUUID();
    await upload(shop.manager, file('canvas.jpg'), photoId);
    expect((await download(shop.associate, photoId)).status).toBe(200);
  });

  test('the signature covers the exact bytes: changed bytes are refused and nothing is stored', async () => {
    const photoId = randomUUID();
    const res = await shop.owner.phone.put(`/api/photos/${photoId}`).set({ ...biz(shop.businessId), 'Content-Type': 'image/jpeg' })
      .send(file('canvas.jpg')).signing({ bodyOverride: jpegWithComment('swapped') });
    expect([res.status, res.body.error.code]).toEqual([401, 'DEVICE_SIGNATURE_INVALID']);
    expect(await db.getModels().Photo.count({ where: { id: photoId } })).toBe(0);
  });
});

describe('photos and products', () => {
  test('product.upsert accepts a photo that has not arrived yet; the pull carries photoId; the upload then makes it downloadable', async () => {
    const productId = randomUUID();
    const photoId = randomUUID();
    const res = await push(shop.manager, [op('product.upsert', { productId, baseVersion: null, fields: { name: 'Kente cloth', type: 'fabric', unit: 'yard', retailMinor: 5000, photoId } })]);
    expect(res.body.results[0].status).toBe('saved');
    expect((await download(shop.associate, photoId)).status).toBe(404); // the app shows a placeholder

    const pulled = await shop.associate.phone.get('/api/sync/pull?since=0').set(biz(shop.businessId));
    expect(pulled.body.rows.find((r) => r.type === 'product' && r.data.id === productId).data.photoId).toBe(photoId);

    await upload(shop.manager, file('canvas.webp'), photoId, 'image/webp');
    expect((await download(shop.associate, photoId)).status).toBe(200);
  });

  test('changing the photo is an ordinary edit: new version, a PriceVersion row with the same prices, history, and the clean-up clock', async () => {
    const productId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    await upload(shop.owner, file('canvas.jpg'), first);
    await upload(shop.owner, file('canvas.webp'), second, 'image/webp');
    await push(shop.owner, [op('product.upsert', { productId, baseVersion: null, fields: { name: 'Wax print', type: 'fabric', unit: 'piece', retailMinor: 9000, costMinor: 6000, photoId: first } })]);
    const edit = await push(shop.owner, [op('product.upsert', { productId, baseVersion: 1, fields: { photoId: second } })]);
    expect(edit.body.results[0]).toMatchObject({ status: 'saved', result: { version: 2 } });

    const versions = await db.getModels().PriceVersion.findAll({ where: { productId }, order: [['version', 'ASC']], raw: true });
    expect(versions.map((v) => [v.version, Number(v.retailMinor), Number(v.costMinor)])).toEqual([[1, 9000, 6000], [2, 9000, 6000]]);
    const photos = await db.getModels().Photo.findAll({ where: { id: [first, second] }, raw: true });
    expect(photos.find((p) => p.id === first).releasedAt).not.toBeNull();
    expect(photos.find((p) => p.id === second).releasedAt).toBeNull();
    const history = await shop.owner.phone.get(`/api/products/${productId}/history`).set(biz(shop.businessId));
    expect(JSON.stringify(history.body)).toContain(second);

    // Removing the photo: photoId null.
    const removed = await push(shop.owner, [op('product.upsert', { productId, baseVersion: 2, fields: { photoId: null } })]);
    expect(removed.body.results[0].status).toBe('saved');
    expect((await db.getModels().Product.findByPk(productId)).photoId).toBeNull();
  });

  test("an associate can't set a product's photo", async () => {
    const res = await push(shop.associate, [op('product.upsert', { productId: randomUUID(), baseVersion: null, fields: { name: 'X', type: 'other', unit: 'piece', retailMinor: 100, photoId: randomUUID() } })]);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'FORBIDDEN' } });
  });
});

describe('when storage fails', () => {
  test('a failed file write answers 503 and leaves no row; the retry works', async () => {
    const photoId = randomUUID();
    storage().switches.failNextPut = true;
    const res = await upload(shop.owner, file('canvas.jpg'), photoId);
    expect([res.status, res.body.error.code]).toEqual([503, 'PHOTO_STORAGE_UNAVAILABLE']);
    expect(await db.getModels().Photo.count({ where: { id: photoId } })).toBe(0);
    expect((await upload(shop.owner, file('canvas.jpg'), photoId)).status).toBe(200);
  });

  test('a lost file answers 404, and uploading the same photo again heals it', async () => {
    const photoId = randomUUID();
    await upload(shop.owner, file('canvas.jpg'), photoId);
    const row = await db.getModels().Photo.findByPk(photoId);
    storage().objects.delete(row.storageKey);
    expect((await download(shop.owner, photoId)).status).toBe(404);
    expect((await upload(shop.owner, file('canvas.jpg'), photoId)).status).toBe(200);
    expect((await download(shop.owner, photoId)).status).toBe(200);
  });

  test('a failed file read answers 503', async () => {
    const photoId = randomUUID();
    await upload(shop.owner, file('canvas.jpg'), photoId);
    storage().switches.failNextGet = true;
    const res = await download(shop.owner, photoId);
    expect([res.status, res.body.error.code]).toEqual([503, 'PHOTO_STORAGE_UNAVAILABLE']);
  });
});

describe('the clean-up rule (approved 11 Nov 2026)', () => {
  // A separate app and business with its own clock, so ages are exact.
  let c;
  let owner;
  let other;
  beforeAll(async () => {
    c = dbApp();
    owner = (await team(c)).owner;
    other = (await team(c)).owner;
  }, 120000);

  const up = (who, bytes, photoId = randomUUID()) => who.phone.put(`/api/photos/${photoId}`)
    .set({ ...biz(who.businessId), 'Content-Type': 'image/jpeg' }).send(bytes).then((res) => { expect(res.status).toBe(200); return photoId; });
  const exists = async (photoId) => (await c.deps.getModels().Photo.count({ where: { id: photoId } })) === 1;
  const fileExists = async (photoId, key) => c.deps.photoStorage.objects.has(key);

  test('deletes photos unused for 30 days (file and row), keeps the rest, this business only', async () => {
    const start = c.clock.now();
    const unusedOld = await up(owner, jpegWithComment('unused-old'));
    const usedOld = await up(owner, jpegWithComment('used-old'));
    const releasedRecently = await up(owner, jpegWithComment('released-recently'));
    const otherBusinessOld = await up(other, jpegWithComment('other-old'));
    await push(owner, [op('product.upsert', { productId: randomUUID(), baseVersion: null, fields: { name: 'Uses a photo', type: 'other', unit: 'piece', retailMinor: 100, costMinor: 50, photoId: usedOld } })]);
    const releasing = randomUUID();
    await push(owner, [op('product.upsert', { productId: releasing, baseVersion: null, fields: { name: 'Lets go later', type: 'other', unit: 'piece', retailMinor: 100, costMinor: 50, photoId: releasedRecently } })]);
    const keyOf = async (id) => (await c.deps.getModels().Photo.findByPk(id)).storageKey;
    const unusedKey = await keyOf(unusedOld);

    c.clock.set(start + 25 * DAY);
    await push(owner, [op('product.upsert', { productId: releasing, baseVersion: 1, fields: { photoId: null } })]); // unused from day 25
    const unusedRecent = await up(owner, jpegWithComment('unused-recent')); // uploaded day 25
    await c.deps.background.idle();
    expect(await exists(unusedOld)).toBe(true); // only 25 days

    c.clock.set(start + 31 * DAY);
    await up(owner, jpegWithComment('trigger-1'));
    await c.deps.background.idle();
    expect(await exists(unusedOld)).toBe(false);
    expect(await fileExists(unusedOld, unusedKey)).toBe(false);
    expect(await exists(usedOld)).toBe(true); // a product uses it
    expect(await exists(releasedRecently)).toBe(true); // unused only since day 25
    expect(await exists(unusedRecent)).toBe(true); // uploaded day 25
    expect(await exists(otherBusinessOld)).toBe(true); // another business: never touched by this business's upload
  });

  test('at most 20 per upload, oldest first', async () => {
    const ids = [];
    for (let i = 0; i < 22; i += 1) ids.push(await up(owner, jpegWithComment(`batch-${i}`)));
    await c.deps.background.idle();
    // Age them 40 days in the database (moving the clock that far would end the test's session).
    await c.deps.getModels().Photo.update({ uploadedAt: new Date(c.clock.now() - 40 * DAY) }, { where: { id: ids } });
    await up(owner, jpegWithComment('trigger-2'));
    await c.deps.background.idle();
    const left = [];
    for (const id of ids) if (await exists(id)) left.push(id);
    expect(left.length).toBe(2);
  });

  test("a row whose photo a product picked again isn't deleted, even after its file was removed", async () => {
    // The DELETE re-checks "no product uses it": simulate the product
    // picking the photo between the file removal and the row delete.
    const { cleanUpUnusedPhotos } = require('../../src/services/housekeeping');
    const start = c.clock.now();
    const photoId = await up(owner, jpegWithComment('picked-again'));
    const storageThatRaces = {
      async remove(key) {
        c.deps.photoStorage.objects.delete(key);
        await push(owner, [op('product.upsert', { productId: randomUUID(), baseVersion: null, fields: { name: 'Picked again', type: 'other', unit: 'piece', retailMinor: 100, costMinor: 50, photoId } })]);
      },
    };
    await c.deps.background.idle();
    await cleanUpUnusedPhotos({ sequelize: db.getSequelize(), storage: storageThatRaces }, { businessId: owner.businessId, now: new Date(start + 60 * DAY) });
    expect(await exists(photoId)).toBe(true); // the row stays: the phone's re-upload restores the file
  });
});

describe('rate limit', () => {
  test('61st upload in an hour: 429 RATE_LIMITED', async () => {
    const c = dbApp({ limiters: createAuthLimiters() });
    const { owner } = await team(c);
    const bytes = file('canvas.jpg');
    const photoId = randomUUID();
    for (let i = 0; i < 60; i += 1) {
      const res = await owner.phone.put(`/api/photos/${photoId}`).set({ ...biz(owner.businessId), 'Content-Type': 'image/jpeg' }).send(bytes);
      expect(res.status).toBe(200);
    }
    const res = await owner.phone.put(`/api/photos/${photoId}`).set({ ...biz(owner.businessId), 'Content-Type': 'image/jpeg' }).send(bytes);
    expect([res.status, res.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(res.headers['retry-after']).toBeDefined();
  }, 60000);
});
