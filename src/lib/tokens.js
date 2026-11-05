// One-time tokens for email links (confirm email, reset password, change
// email). The link carries 32 random bytes; the database keeps only their
// SHA-256 hash. So even someone with a copy of the database can't open a
// link: they'd need the token itself, which exists only in the email.

const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

// Makes a new token: `token` goes in the email link, `tokenHash` in the database.
function createToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

// The SHA-256 of a token, as 64 lowercase hex characters.
function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

// Compares two hashes in constant time (the time taken doesn't depend on how
// many characters match), so timing can't be used to guess a hash bit by bit.
function sameHash(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = { createToken, hashToken, sameHash };
