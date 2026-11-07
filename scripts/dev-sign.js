// Development helper: sign test requests from the command line, so signed
// business endpoints can be tried in Postman or curl. TEST KEYS ONLY:
// - it refuses to run when NODE_ENV is production;
// - its key is a throwaway test key in .dev-device-key.json (Git-ignored),
//   stored extractable (unlike the app's real, non-extractable keys).
//
// Commands (from the project folder):
//   npm run dev:sign -- new-key
//       makes a test key and device ID (refuses to overwrite without --force)
//   npm run dev:sign -- register-body --challenge <challenge> [--name "Postman"]
//       prints the JSON body for POST /api/devices (type your password into it)
//   npm run dev:sign -- headers --method GET --path /api/team --business <id> [--body '<json>'] [--server-time <ms>]
//       prints the four signing headers (and the exact body to send)

const fs = require('node:fs');
const path = require('node:path');
const { webcrypto, randomUUID, randomBytes, createHash } = require('node:crypto');

const KEY_FILE = path.resolve(__dirname, '../.dev-device-key.json');
const { subtle } = webcrypto;

// Reads --name value pairs from the command line.
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      const next = args[i + 1];
      out[args[i].slice(2)] = next === undefined || next.startsWith('--') ? true : (i += 1, next);
    }
  }
  return out;
}

// Loads the test key from the key file.
async function loadKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error('No test key yet: run "npm run dev:sign -- new-key" first.');
  const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const privateKey = await subtle.importKey('jwk', saved.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { ...saved, privateKey };
}

// Signs text (UTF-8): IEEE P1363, base64url, as the app does.
async function sign(privateKey, text) {
  return Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(text, 'utf8'))).toString('base64url');
}

// Runs one command.
async function main([command, ...rest]) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refused: dev-sign is for test keys only, never with NODE_ENV=production.');
  const opts = options(rest);

  if (command === 'new-key') {
    if (fs.existsSync(KEY_FILE) && !opts.force) throw new Error(`${KEY_FILE} exists. Use --force to replace it (the old test device must then be registered again).`);
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
    const pub = await subtle.exportKey('jwk', pair.publicKey);
    const saved = { deviceId: randomUUID(), privateJwk, publicJwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
    fs.writeFileSync(KEY_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
    console.log(`Test key saved (Git-ignored). Device ID: ${saved.deviceId}`);
    return;
  }

  if (command === 'register-body') {
    if (!opts.challenge) throw new Error('Give --challenge (from POST /api/devices/challenge).');
    const key = await loadKey();
    console.log(JSON.stringify({
      deviceId: key.deviceId,
      name: opts.name || 'Postman (test key)',
      publicKey: key.publicJwk,
      challenge: opts.challenge,
      challengeSignature: await sign(key.privateKey, opts.challenge),
      currentPassword: 'TYPE-YOUR-PASSWORD-HERE',
    }, null, 2));
    return;
  }

  if (command === 'headers') {
    for (const required of ['method', 'path', 'business']) if (!opts[required]) throw new Error(`Give --${required}.`);
    const key = await loadKey();
    const bodyText = typeof opts.body === 'string' ? opts.body : '';
    const signedAt = String(opts['server-time'] ? Number(opts['server-time']) : Date.now());
    const nonce = randomBytes(16).toString('base64url');
    const bodyHash = createHash('sha256').update(Buffer.from(bodyText, 'utf8')).digest('hex');
    const text = [opts.method.toUpperCase(), opts.path, bodyHash, key.deviceId, opts.business.toLowerCase(), signedAt, nonce].join('\n');
    console.log(`X-Business: ${opts.business.toLowerCase()}`);
    console.log(`X-Device-Id: ${key.deviceId}`);
    console.log(`X-Signed-At: ${signedAt}`);
    console.log(`X-Nonce: ${nonce}`);
    console.log(`X-Signature: ${await sign(key.privateKey, text)}`);
    if (bodyText) console.log(`\nSend exactly this body (raw, application/json):\n${bodyText}`);
    console.log('\nEach set of headers works once (the nonce) and for 5 minutes.');
    return;
  }

  throw new Error('Commands: new-key | register-body --challenge <c> | headers --method <M> --path <p> --business <id> [--body <json>]');
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
