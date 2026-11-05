// Sending account emails (no SMTP, no Nodemailer: Render's free plan blocks
// SMTP). One function, sendEmail(), behaves differently by environment:
// - tests:        the email is kept in memory (`sentInTests`) for tests to read;
// - development:  the whole email, link included, is printed in the terminal,
//                 so you can click the link; nothing is sent;
// - production:   it's sent through Brevo's HTTPS API with fetch, and only the
//                 template name and user ID are logged, never the address or link.
// It never throws: it answers true (sent) or false (not sent). Emails are only
// sent AFTER the database change has committed, so a failed email never undoes
// anything; the person can always ask for the link again.

const { renderEmail } = require('../emails/templates');
const { describeError } = require('./logger');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

// Brevo's short reason code from a refusal (e.g. "unauthorized",
// "permission_denied"), so the log says WHY an email wasn't sent. Only the
// `code` field is kept, and only if it's a plain lowercase word: Brevo's
// `message` can mention addresses, so it's never logged.
async function providerCode(response) {
  try {
    const body = await response.json();
    return typeof body?.code === 'string' && /^[a-z_]{1,40}$/.test(body.code) ? body.code : undefined;
  } catch {
    return undefined;
  }
}

// Makes the sender. `fetchImpl` and `print` can be replaced in tests.
function createEmailSender({ config, logger, fetchImpl = fetch, print = (text) => process.stdout.write(text) }) {
  const sentInTests = [];

  // Sends one email. `to` is the address, `template` its name, `data` the
  // values it needs (name, link…), `userId` only for the log line.
  async function sendEmail({ to, template, language = 'en', data, userId }) {
    const { subject, text } = renderEmail(template, language, data);

    if (config.NODE_ENV === 'test') {
      sentInTests.push({ to, template, language, subject, text, data, userId });
      return true;
    }

    if (config.NODE_ENV === 'development') {
      print(`\n----- EMAIL (development only, not sent) -----\nTo: ${to}\nSubject: ${subject}\n\n${text}\n----------------------------------------------\n`);
      return true;
    }

    try {
      const response = await fetchImpl(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': config.EMAIL_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: config.EMAIL_FROM_NAME, email: config.EMAIL_FROM_ADDRESS },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        logger.error('email_failed', { template, userId, httpStatus: response.status, providerCode: await providerCode(response) });
        return false;
      }
      logger.info('email_sent', { template, userId });
      return true;
    } catch (err) {
      logger.error('email_failed', { template, userId, errorName: describeError(err).errorName });
      return false;
    }
  }

  return { sendEmail, sentInTests };
}

module.exports = { createEmailSender, BREVO_URL };
