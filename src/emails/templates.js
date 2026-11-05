// The account emails, in English and Twi. Each template takes the person's
// name and a link (or a masked address) and returns a subject and plain text.
// Plain text only: it reads well on every phone and can't hide a link
// behind different wording.
//
// [DRAFT: to be checked] The Twi ('tw') versions are NOT translated yet: they
// repeat the English text until a Twi speaker writes and checks them
// (backlog, "Still to decide" 4). Replace each `tw` entry when ready.

const templates = {
  // Sent at sign-up, and by "Send the link again", to confirm the address.
  confirm_email: {
    en: ({ name, link }) => ({
      subject: 'Confirm your email for Shop Book',
      text: `Hello ${name},\n\nTap this link to confirm your email address for Shop Book:\n\n${link}\n\nThe link works once and expires in 24 hours.\n\nIf you didn't sign up for Shop Book, you can ignore this email.`,
    }),
  },

  // Sent to a NEW address when someone asks to change their email.
  change_email: {
    en: ({ name, link }) => ({
      subject: 'Confirm your new email for Shop Book',
      text: `Hello ${name},\n\nTap this link to make this your Shop Book email address:\n\n${link}\n\nThe link works once and expires in 24 hours. Until you tap it, your old email stays in use.\n\nIf you didn't ask for this, you can ignore this email.`,
    }),
  },

  // Sent to the OLD address when someone asks to change their email, so a
  // person whose account was taken over finds out.
  email_changed: {
    en: ({ name, newEmailMasked }) => ({
      subject: 'Your Shop Book email is being changed',
      text: `Hello ${name},\n\nSomeone signed in to your Shop Book account asked to change its email to ${newEmailMasked}.\n\nIf this was you, there's nothing more to do.\n\nIf it wasn't you, sign in to Shop Book and change your password straight away, or ask your shop owner for help.`,
    }),
  },

  // Sent by "Forgot password" to a confirmed email.
  reset_password: {
    en: ({ name, link }) => ({
      subject: 'Reset your Shop Book password',
      text: `Hello ${name},\n\nTap this link to choose a new Shop Book password:\n\n${link}\n\nThe link works once and expires in 30 minutes. Choosing a new password signs you out on every other phone.\n\nIf you didn't ask for this, you can ignore this email: your password stays the same.`,
    }),
  },
};

// Until the Twi texts exist, Twi uses the English ones (see the note at the top).
for (const template of Object.values(templates)) template.tw = template.en;

// Returns { subject, text } for a template in a language (English if unknown).
function renderEmail(template, language, data) {
  const versions = templates[template];
  if (!versions) throw new Error(`Unknown email template: ${template}`);
  return (versions[language] ?? versions.en)(data);
}

// Shows an address without giving it away, for the notice to the old address:
// "ama.mensah@gmail.com" → "am***@gmail.com".
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

module.exports = { renderEmail, maskEmail, TEMPLATE_NAMES: Object.keys(templates) };
