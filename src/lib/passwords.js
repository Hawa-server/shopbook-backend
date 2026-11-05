// Passwords: the rules for a new one, and hashing with argon2id.
// A password is never stored or logged, only its argon2id hash. argon2id is
// deliberately slow and memory-hungry, so someone who copied the database
// can't try billions of guesses per second.

const fs = require('node:fs');
const path = require('node:path');
const argon2 = require('argon2');

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

// The most common passwords, one per line, in a plain file kept in the
// repository (no package). Compared in lower case.
const COMMON = new Set(
  fs.readFileSync(path.join(__dirname, 'common-passwords.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith('#')),
);

// Checks a new password against the rules. Returns null if it's acceptable,
// otherwise a message to show under the password field.
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (password.length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`;
  if (COMMON.has(password.toLowerCase())) return 'This password is too common. Choose another one.';
  return null;
}

// Hashes a password with argon2id and the library's default settings.
function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

// True if `password` matches `hash`. A malformed hash counts as no match.
async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// A real hash of a random password, made once. Sign-in checks against it when
// the account doesn't exist, so "unknown phone number" takes as long as
// "wrong password" and the timing doesn't reveal who has an account.
let dummyHash;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(`no-account-${Math.random()}`);
  return dummyHash;
}

module.exports = { passwordProblem, hashPassword, verifyPassword, getDummyHash, MIN_LENGTH, MAX_LENGTH };
