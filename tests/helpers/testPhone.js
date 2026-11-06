// A test "phone": wraps a supertest agent (which keeps the sign-in cookie,
// like a phone's browser) and signs every business request exactly as the
// app will (src/lib/deviceSigning.js), with a non-extractable P-256 key made
// by Web Crypto, the same API the browser uses.
//
// The first time it's used in a business, it registers itself there (asks
// for a challenge, signs it, sends its public key and the password). If that
// isn't possible (not a member yet, password not changed, terms not
// accepted…), the request is sent unsigned, and the server's own answer
// (404, 403 …) comes back, since those checks run before the signature.
//
// Usage (same shape as a supertest agent):
//   const phone = testPhone(agent, { password, now: clock.now });
//   await phone.get('/api/team').set({ 'X-Business': businessId });
//   await phone.post('/api/team').set({ 'X-Business': businessId }).send({ … });

const { randomUUID, webcrypto, randomBytes, createHash } = require('node:crypto');

const { subtle } = webcrypto;
const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

// Makes a key pair like the app does: private key NOT extractable.
async function makeKey() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

// Signs some text (UTF-8) with a private key: P1363 bytes, base64url.
async function sign(privateKey, text) {
  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(text, 'utf8'));
  return Buffer.from(signature).toString('base64url');
}

// The four signing headers for one request.
async function signingHeaders({ key, deviceId, businessId, method, pathWithQuery, bodyText, signedAt, nonce }) {
  const bodyHash = createHash('sha256').update(Buffer.from(bodyText ?? '', 'utf8')).digest('hex');
  const usedNonce = nonce ?? randomBytes(16).toString('base64url');
  const text = [method.toUpperCase(), pathWithQuery, bodyHash, deviceId, businessId, String(signedAt), usedNonce].join('\n');
  return {
    'X-Device-Id': deviceId,
    'X-Signed-At': String(signedAt),
    'X-Nonce': usedNonce,
    'X-Signature': await sign(key.privateKey, text),
  };
}

// Wraps `agent`. `password` is used to register; `now` is the app's clock.
function testPhone(agent, { password, now = Date.now, name = 'Test phone' } = {}) {
  const devices = new Map(); // businessId → { deviceId, key, deviceCode } | null (couldn't register)
  const state = { password };

  // Registers this phone in a business. Returns the device, or null.
  async function registerIn(businessId) {
    if (devices.has(businessId)) return devices.get(businessId);
    const challenge = await agent.post('/api/devices/challenge').set({ ...XHR, 'X-Business': businessId });
    if (challenge.status !== 200) { devices.delete(businessId); return null; }
    const key = await makeKey();
    const deviceId = randomUUID();
    const res = await agent.post('/api/devices').set({ ...XHR, 'X-Business': businessId }).send({
      deviceId, name, publicKey: key.publicJwk, challenge: challenge.body.challenge,
      challengeSignature: await sign(key.privateKey, challenge.body.challenge), currentPassword: state.password,
    });
    if (res.status !== 201) return null;
    const device = { deviceId, key, deviceCode: res.body.device.deviceCode };
    devices.set(businessId, device);
    return device;
  }

  // One request: collects headers and body, then signs and sends on await.
  function request(method, url) {
    const headers = {};
    let body;
    let extra = {};
    const builder = {
      set(h) { Object.assign(headers, h); return builder; },
      send(b) { body = b; return builder; },
      // Overrides for tests: { signedAt, nonce, tamper(fields) }
      signing(options) { extra = options; return builder; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };

    async function run() {
      const businessId = headers['X-Business'];
      const bodyText = body === undefined ? '' : JSON.stringify(body);
      let signed = {};
      const device = businessId ? await registerIn(businessId) : null;
      if (device) {
        signed = await signingHeaders({
          key: device.key, deviceId: device.deviceId, businessId,
          method, pathWithQuery: url, bodyText,
          signedAt: extra.signedAt ?? now(), nonce: extra.nonce,
        });
        if (extra.tamper) signed = extra.tamper(signed);
      }
      let req = agent[method.toLowerCase()](url).set({ ...XHR, ...headers, ...signed });
      if (bodyText) req = req.set('Content-Type', 'application/json').send(extra.bodyOverride ?? bodyText);
      return req;
    }
    return builder;
  }

  return {
    agent,
    get: (url) => request('GET', url),
    post: (url) => request('POST', url),
    patch: (url) => request('PATCH', url),
    delete: (url) => request('DELETE', url),
    registerIn,
    device: (businessId) => devices.get(businessId),
    setPassword(p) { state.password = p; },
    forget(businessId) { devices.delete(businessId); },
  };
}

module.exports = { testPhone, makeKey, sign, signingHeaders };
