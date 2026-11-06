// The rate limits for the account endpoints, from the server plan's Security
// section. Made in one place so each limit's numbers are easy to find, and
// so tests can make a fresh set (in-memory counts; see rateLimiter.js).

const { createRateLimiter } = require('../lib/rateLimiter');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Makes every account limiter. Keys: an IP address, a login (phone or email
// as typed, normalised), or a user ID. `unlimited` is for tests that make
// many accounts from one address; the rate-limit tests themselves leave it off.
function createAuthLimiters({ now, unlimited = false } = {}) {
  const make = (name, windowMs, max) => createRateLimiter({
    name, windowMs, max: unlimited ? Number.MAX_SAFE_INTEGER : max, ...(now ? { now } : {}),
  });
  return {
    // Sign-in: 10 per 15 minutes per login and per IP (every attempt counts).
    signinByIp: make('signin-ip', 15 * MINUTE, 10),
    signinByLogin: make('signin-login', 15 * MINUTE, 10),
    // Sign-up: 5 per hour per IP.
    signupByIp: make('signup-ip', HOUR, 5),
    // Forgot password and "send the link again": 3 per hour per account, 10 per hour per IP.
    emailByAccount: make('email-account', HOUR, 3),
    emailByIp: make('email-ip', HOUR, 10),
    // Checking the current password (change password, phone, email): the same
    // limit as sign-in, per person, so it can't be used to guess passwords.
    passwordCheckByUser: make('password-check-user', 15 * MINUTE, 10),
    // Adding team members: 20 per hour per owner, 30 per hour per IP.
    teamAddByOwner: make('team-add-owner', HOUR, 20),
    teamAddByIp: make('team-add-ip', HOUR, 30),
    // The owner resetting a staff member's password: 10 per hour per owner, 20 per IP.
    teamResetByOwner: make('team-reset-owner', HOUR, 10),
    teamResetByIp: make('team-reset-ip', HOUR, 20),
    // Registering a phone: 5 per hour per user and per IP; challenges 20 per hour per user.
    deviceRegisterByUser: make('device-register-user', HOUR, 5),
    deviceRegisterByIp: make('device-register-ip', HOUR, 5),
    deviceChallengeByUser: make('device-challenge-user', HOUR, 20),
    // Failed signatures: 20 per 15 minutes per device, then that device is locked for 15 minutes.
    deviceSignatureFailures: make('device-signature-failures', 15 * MINUTE, 20),
  };
}

module.exports = { createAuthLimiters };
