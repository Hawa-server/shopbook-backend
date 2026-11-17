// The photo storage adapters (BE6.5) without the network: R2 requests are
// checked against a fake fetch (address, method, AWS signature present,
// answers mapped right), the disk adapter writes to a temporary folder, and
// every adapter refuses a key that isn't <uuid>/<uuid>/<sha256>.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { r2Storage, diskStorage, memoryStorage } = require('../../src/lib/photoStorage');

const KEY = `${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}/${'2'.repeat(8)}-2222-4222-8222-${'2'.repeat(12)}/${'a'.repeat(64)}`;
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const R2 = { accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'key-id', secretAccessKey: 'secret', bucket: 'tabova-photos' };

// A fake fetch that records requests and answers with `responses` in turn.
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (request) => {
    calls.push({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body: request.body ? Buffer.from(await request.arrayBuffer()) : null });
    return responses.shift();
  };
  return { calls, fetchImpl };
}

describe('R2', () => {
  test('put sends the bytes to the bucket address, signed', async () => {
    const { calls, fetchImpl } = fakeFetch([new Response(null, { status: 200 })]);
    await r2Storage(R2, fetchImpl).put(KEY, BYTES, 'image/jpeg');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(`https://${R2.accountId}.r2.cloudflarestorage.com/tabova-photos/${KEY}`);
    expect(calls[0].headers['content-type']).toBe('image/jpeg');
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/auto\/s3\/aws4_request/);
    expect(calls[0].headers.authorization).not.toContain('secret');
    expect(Buffer.compare(calls[0].body, BYTES)).toBe(0);
  });

  test('get returns the bytes, or null for 404; failures throw', async () => {
    const { fetchImpl } = fakeFetch([
      new Response(BYTES, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      new Response('<Error/>', { status: 404 }),
      new Response('', { status: 500 }),
    ]);
    const storage = r2Storage(R2, fetchImpl);
    const got = await storage.get(KEY);
    expect([Buffer.compare(got.bytes, BYTES), got.contentType]).toEqual([0, 'image/jpeg']);
    expect(await storage.get(KEY)).toBeNull();
    await expect(storage.get(KEY)).rejects.toThrow('R2 get failed (HTTP 500)');
  });

  test('a failed put throws (so no Photo row is written); remove accepts 204 and 404', async () => {
    const { calls, fetchImpl } = fakeFetch([new Response('', { status: 403 }), new Response(null, { status: 204 }), new Response(null, { status: 404 })]);
    const storage = r2Storage(R2, fetchImpl);
    await expect(storage.put(KEY, BYTES, 'image/jpeg')).rejects.toThrow('R2 put failed (HTTP 403)');
    await storage.remove(KEY);
    await storage.remove(KEY);
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE', 'DELETE']);
  });
});

describe('disk (development)', () => {
  test('put, get, remove in a folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'));
    const storage = diskStorage(root);
    await storage.put(KEY, BYTES, 'image/webp');
    const got = await storage.get(KEY);
    expect([Buffer.compare(got.bytes, BYTES), got.contentType]).toEqual([0, 'image/webp']);
    await storage.remove(KEY);
    expect(await storage.get(KEY)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('keys', () => {
  test.each(['../../etc/passwd', `${KEY}/..`, KEY.toUpperCase(), 'a/b/c', ''])('refuses %j', async (key) => {
    for (const storage of [memoryStorage(), diskStorage(os.tmpdir()), r2Storage(R2, async () => { throw new Error('must not be called'); })]) {
      await expect(storage.put(key, BYTES, 'image/jpeg')).rejects.toThrow('photoStorage: invalid key');
      await expect(storage.get(key)).rejects.toThrow('photoStorage: invalid key');
    }
  });
});
