// Device signatures (BE5 Part A). Every business request from a phone is
// signed with that phone's own private key (made on the phone, never able to
// leave it). The server checks the signature with the public key stored at
// registration. A copied sign-in cookie alone is therefore useless on another
// machine: it has no key to sign with.
//
// Exact formats (the phone builds the same text, byte for byte):
//   the seven items, each on its own line, joined with "\n", UTF-8:
//     1. method in capitals                      GET
//     2. path and query string exactly as sent    /api/sync/pull?since=120&limit=500
//     3. SHA-256 of the raw body, lowercase hex   (of zero bytes for an empty body)
//     4. device ID, lowercase UUID
//     5. business ID, lowercase UUID
//     6. timestamp: integer milliseconds since 1970 (server-corrected)
//     7. nonce: 16 random bytes in base64url
//   signature: ECDSA P-256 with SHA-256, IEEE P1363 format (64 bytes, r‖s),
//   sent as base64url, which is what Web Crypto's sign() produces.
//
// Honest limits: this stops a stolen cookie being used elsewhere. It does NOT
// stop malicious script running inside the app from asking the browser to
// sign; the app's strict Content-Security-Policy is what prevents that.

const { createHash, createPublicKey, verify } = require('node:crypto');

const BASE64URL = /^[A-Za-z0-9_-]+$/;

// SHA-256 of some bytes (a Buffer, or nothing for an empty body), lowercase hex.
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes ?? Buffer.alloc(0)).digest('hex');
}

// The exact text a request's signature covers.
function signingText({ method, pathWithQuery, bodyHash, deviceId, businessId, signedAt, nonce }) {
  return [method.toUpperCase(), pathWithQuery, bodyHash, deviceId, businessId, String(signedAt), nonce].join('\n');
}

// Checks that `jwk` is an ECDSA P-256 PUBLIC key (no private part) whose point
// is really on the curve. Returns a KeyObject, or null if it isn't valid.
function publicKeyFromJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) return null;
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || !BASE64URL.test(jwk.x) || !BASE64URL.test(jwk.y)) return null;
  if (Buffer.from(jwk.x, 'base64url').length !== 32 || Buffer.from(jwk.y, 'base64url').length !== 32) return null;
  try {
    // Node (OpenSSL) refuses a point that isn't on the P-256 curve.
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch {
    return null;
  }
}

// True if `signatureB64url` is a valid P1363 signature of `text` by `jwk`.
function verifySignature(jwk, text, signatureB64url) {
  const key = publicKeyFromJwk(jwk);
  if (!key || typeof signatureB64url !== 'string' || !BASE64URL.test(signatureB64url)) return false;
  const signature = Buffer.from(signatureB64url, 'base64url');
  if (signature.length !== 64) return false;
  try {
    return verify('sha256', Buffer.from(text, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}

module.exports = { sha256Hex, signingText, publicKeyFromJwk, verifySignature };
