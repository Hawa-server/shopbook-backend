// Unit tests for the account helpers: Ghana phone numbers, password rules
// and hashing, one-time tokens, and the email adapter's three modes (with a
// fake fetch for Brevo, so nothing is really sent).

const { passwordProblem, hashPassword, verifyPassword } = require('../../src/lib/passwords');
const { createToken, hashToken, sameHash } = require('../../src/lib/tokens');
const { createEmailSender, BREVO_URL } = require('../../src/lib/email');
const { renderEmail, maskEmail } = require('../../src/emails/templates');
const { createLogger } = require('../../src/lib/logger');
const { testConfig } = require('../helpers/testApp');

// Phone numbers: see tests/unit/locale.test.js (normalizePhone, BE4.5).

describe('passwords', () => {
  test('rules: at least 8, at most 128, not on the common list (any case)', () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem('PASSWORD123')).toMatch(/too common/);
    expect(passwordProblem('12345678')).toMatch(/too common/);
    expect(passwordProblem('kente-cloth-2026')).toBeNull();
    expect(passwordProblem('a long passphrase with spaces is fine')).toBeNull();
  });

  test('hashes with argon2id and checks correctly', async () => {
    const hash = await hashPassword('kente-cloth-2026');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'kente-cloth-2026')).toBe(true);
    expect(await verifyPassword(hash, 'kente-cloth-2027')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('tokens', () => {
  test('32 random bytes in the link, only the SHA-256 stored', () => {
    const { token, tokenHash } = createToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(tokenHash);
    expect(createToken().token).not.toBe(token);
    expect(sameHash(tokenHash, hashToken(token))).toBe(true);
    expect(sameHash(tokenHash, hashToken(`${token}x`))).toBe(false);
  });
});

describe('email adapter', () => {
  const data = { name: 'Ama', link: 'https://app.example.test/reset-password?token=SECRET-TOKEN' };

  // Collects the logger's lines for checking.
  function collectingLogger() {
    const lines = [];
    return { lines, logger: createLogger({ level: 'debug', write: (line) => lines.push(line) }) };
  }

  test('tests: kept in memory, nothing printed or sent', async () => {
    const fetchImpl = jest.fn();
    const sender = createEmailSender({ config: testConfig(), logger: createLogger({ level: 'silent' }), fetchImpl });
    expect(await sender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' })).toBe(true);
    expect(sender.sentInTests).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('development: printed in full (link included), nothing sent', async () => {
    const printed = [];
    const fetchImpl = jest.fn();
    const sender = createEmailSender({
      config: testConfig({ NODE_ENV: 'development' }), logger: createLogger({ level: 'silent' }), fetchImpl, print: (t) => printed.push(t),
    });
    await sender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' });
    expect(printed.join('')).toContain('SECRET-TOKEN');
    expect(printed.join('')).toContain('development only, not sent');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // A production-like config (a real file stands in for the CA certificate).
  function productionConfig() {
    return testConfig({
      NODE_ENV: 'production', DB_SSL_CA_PATH: __filename, TRUST_PROXY: '3', JWT_SECRET: 'x'.repeat(40),
      APP_URL: 'https://app.example.test', EMAIL_API_KEY: 'brevo-key-for-test', EMAIL_FROM_ADDRESS: 'shop@example.test', EMAIL_FROM_NAME: 'Shop Book',
    });
  }

  test('production: sent through Brevo; the log has only the template and user ID', async () => {
    const { lines, logger } = collectingLogger();
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 201 }));
    const sender = createEmailSender({ config: productionConfig(), logger, fetchImpl });
    expect(await sender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' })).toBe(true);

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(BREVO_URL);
    expect(options.headers['api-key']).toBe('brevo-key-for-test');
    const body = JSON.parse(options.body);
    expect(body.to).toEqual([{ email: 'ama@example.test' }]);
    expect(body.sender).toEqual({ name: 'Shop Book', email: 'shop@example.test' });
    expect(body.textContent).toContain('SECRET-TOKEN');

    expect(lines.map((l) => JSON.parse(l))).toEqual([expect.objectContaining({ event: 'email_sent', template: 'reset_password', userId: 'u1' })]);
    expect(lines.join('')).not.toMatch(/ama@example\.test|SECRET-TOKEN/);
  });

  test('production: a refusal or a network error answers false and is logged without the address or link', async () => {
    for (const fetchImpl of [async () => ({ ok: false, status: 429 }), async () => { throw new TypeError('fetch failed'); }]) {
      const { lines, logger } = collectingLogger();
      const sender = createEmailSender({ config: productionConfig(), logger, fetchImpl });
      expect(await sender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' })).toBe(false);
      expect(JSON.parse(lines[0]).event).toBe('email_failed');
      expect(lines.join('')).not.toMatch(/ama@example\.test|SECRET-TOKEN/);
    }
  });

  test("production: Brevo's reason code is logged, but never its message", async () => {
    const { lines, logger } = collectingLogger();
    const fetchImpl = async () => ({
      ok: false, status: 403, json: async () => ({ code: 'unauthorized', message: 'Unauthorised IP for ama@example.test' }),
    });
    const sender = createEmailSender({ config: productionConfig(), logger, fetchImpl });
    await sender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' });
    expect(JSON.parse(lines[0])).toMatchObject({ event: 'email_failed', httpStatus: 403, providerCode: 'unauthorized' });
    expect(lines.join('')).not.toMatch(/ama@example\.test|Unauthorised IP/);

    // A code that isn't a plain word (it could hide something) is left out.
    const odd = collectingLogger();
    const oddSender = createEmailSender({ config: productionConfig(), logger: odd.logger, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 'x@y.z' }) }) });
    await oddSender.sendEmail({ to: 'ama@example.test', template: 'reset_password', data, userId: 'u1' });
    expect(JSON.parse(odd.lines[0]).providerCode).toBeUndefined();
  });

  test('every template has English and Twi, and masking hides the address', () => {
    for (const template of ['confirm_email', 'change_email', 'reset_password']) {
      for (const language of ['en', 'tw']) expect(renderEmail(template, language, data).text).toContain(data.link);
    }
    expect(renderEmail('email_changed', 'en', { name: 'Ama', newEmailMasked: 'ne***@x.test' }).text).toContain('ne***@x.test');
    expect(maskEmail('ama.mensah@gmail.com')).toBe('am***@gmail.com');
  });
});
