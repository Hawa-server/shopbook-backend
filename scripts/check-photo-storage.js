// `npm run check:photo-storage` (BE6.5): checks that the photo storage in
// your .env works, for the manual R2 check. Set PHOTO_STORAGE=r2 and the four
// R2_ values for your DEVELOPMENT bucket in .env, then run it. It:
//   1. writes one small test photo under a fixed test key
//      (00000000-0000-4000-8000-000000000000/…), never a business's folder;
//   2. reads it back and compares the bytes;
//   3. removes it again.
// It prints only the storage kind and OK or the failing step: never a key
// or secret. Don't run it against production's bucket.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getConfigOrExit } = require('../src/config/env');
const { createPhotoStorage } = require('../src/lib/photoStorage');

const TEST_ID = '00000000-0000-4000-8000-000000000000';

// Runs the three steps and reports.
async function main() {
  const config = getConfigOrExit();
  const storage = createPhotoStorage(config);
  const bytes = fs.readFileSync(path.join(__dirname, '../tests/fixtures/photos/canvas.webp'));
  const key = `${TEST_ID}/${TEST_ID}/${createHash('sha256').update(bytes).digest('hex')}`;
  process.stdout.write(`Photo storage: ${storage.kind}\n`);
  await storage.put(key, bytes, 'image/webp');
  process.stdout.write('1. write: OK\n');
  const got = await storage.get(key);
  if (!got || Buffer.compare(got.bytes, bytes) !== 0) throw new Error('2. read: the bytes came back different (or not at all)');
  process.stdout.write('2. read back, same bytes: OK\n');
  await storage.remove(key);
  if (await storage.get(key)) throw new Error('3. remove: the test photo is still there');
  process.stdout.write('3. remove: OK\ncheck:photo-storage: OK\n');
}

main().catch((err) => { process.stderr.write(`check:photo-storage failed: ${err.message}\n`); process.exitCode = 1; });
