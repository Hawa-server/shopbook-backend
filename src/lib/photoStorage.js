// Where photo files are kept (BE6.5), behind one small interface, like the
// email sender: put(key, bytes, contentType), get(key) → { bytes,
// contentType } or null, remove(key).
// - production:  Cloudflare R2 (S3-compatible), a PRIVATE bucket. Requests
//                are signed with AWS Signature V4 by `aws4fetch` and sent with
//                Node's own fetch. The bucket's address never reaches a phone:
//                downloads go through the API.
// - development: a local folder (PHOTO_DISK_PATH, Git-ignored), so you can
//                work without Cloudflare.
// - tests:       memory, with switches to make the next write fail.
//
// Keys are always built by the server as <businessId>/<photoId>/<sha256>
// from IDs it has checked (src/services/photos.js), never taken from a
// request; every adapter refuses any other shape anyway, so a bad key can't
// reach outside the business's folder.
//
// remove() is called ONLY by the approved clean-up rule
// (src/services/housekeeping.js) and, later, deleteBusinessData; a code-rule
// test checks that.

const fs = require('node:fs/promises');
const path = require('node:path');
const { AwsClient } = require('aws4fetch');

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{64}$/;

// Refuses a key that isn't exactly <uuid>/<uuid>/<sha256> (a programming mistake).
function checkKey(key) {
  if (!KEY.test(key)) throw new Error('photoStorage: invalid key');
}

// In memory (tests). `failNextPut` / `failNextGet` make the next call fail,
// to test that a failed write leaves no Photo row.
function memoryStorage() {
  const objects = new Map();
  const switches = { failNextPut: false, failNextGet: false };
  return {
    kind: 'memory',
    objects,
    switches,
    async put(key, bytes, contentType) {
      checkKey(key);
      if (switches.failNextPut) { switches.failNextPut = false; throw new Error('storage unavailable (test)'); }
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
    },
    async get(key) {
      checkKey(key);
      if (switches.failNextGet) { switches.failNextGet = false; throw new Error('storage unavailable (test)'); }
      return objects.get(key) ?? null;
    },
    async remove(key) {
      checkKey(key);
      objects.delete(key);
    },
  };
}

// A local folder (development). The content type is kept beside each file.
function diskStorage(root) {
  const fileOf = (key) => path.join(root, ...key.split('/'));
  return {
    kind: 'disk',
    async put(key, bytes, contentType) {
      checkKey(key);
      const file = fileOf(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      await fs.writeFile(`${file}.type`, contentType);
    },
    async get(key) {
      checkKey(key);
      const file = fileOf(key);
      try {
        return { bytes: await fs.readFile(file), contentType: (await fs.readFile(`${file}.type`, 'utf8')).trim() };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(key) {
      checkKey(key);
      const file = fileOf(key);
      await fs.rm(file, { force: true });
      await fs.rm(`${file}.type`, { force: true });
    },
  };
}

// Cloudflare R2 (production). Each request has a 10-second limit; a failure
// throws, and the caller answers 503 so the phone retries later.
function r2Storage({ accountId, accessKeyId, secretAccessKey, bucket }, fetchImpl = fetch) {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const base = `https://${accountId}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}`;
  // Signs a request with aws4fetch, then sends it with fetch (replaceable in tests).
  async function send(method, key, init = {}) {
    const signed = await client.sign(`${base}/${key}`, { method, ...init });
    return fetchImpl(signed, { signal: AbortSignal.timeout(10000) });
  }
  return {
    kind: 'r2',
    async put(key, bytes, contentType) {
      checkKey(key);
      const res = await send('PUT', key, { body: bytes, headers: { 'content-type': contentType } });
      if (!res.ok) throw new Error(`R2 put failed (HTTP ${res.status})`);
    },
    async get(key) {
      checkKey(key);
      const res = await send('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get failed (HTTP ${res.status})`);
      return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
    },
    async remove(key) {
      checkKey(key);
      const res = await send('DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (HTTP ${res.status})`);
    },
  };
}

// Makes the storage chosen by the config (PHOTO_STORAGE; see src/config/env.js).
function createPhotoStorage(config, { fetchImpl } = {}) {
  if (config.PHOTO_STORAGE === 'r2') {
    return r2Storage({
      accountId: config.R2_ACCOUNT_ID, accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY, bucket: config.R2_BUCKET,
    }, fetchImpl);
  }
  if (config.PHOTO_STORAGE === 'disk') return diskStorage(path.resolve(config.PHOTO_DISK_PATH));
  return memoryStorage();
}

module.exports = { createPhotoStorage, memoryStorage, diskStorage, r2Storage };
