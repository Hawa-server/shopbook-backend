// Checking request bodies with Zod. A body is never passed straight to the
// database: each endpoint names the fields it accepts and their rules, and
// anything that doesn't fit is answered 400 VALIDATION_FAILED with a message
// per field, so the app can show it under the right box.

const { z } = require('zod');
const { AppError } = require('./errors');

// Checks `body` against `schema` and returns the clean values, or throws
// 400 VALIDATION_FAILED with `fields` (field name → message). Extra fields
// are dropped (Zod objects strip unknown keys), never saved.
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const name = issue.path.join('.') || '_';
    if (!fields[name]) fields[name] = issue.message;
  }
  throw new AppError(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', fields);
}

// Throws 400 VALIDATION_FAILED for one field, for rules checked after Zod.
function fieldError(field, message) {
  return new AppError(400, 'VALIDATION_FAILED', 'Check the highlighted fields.', { [field]: message });
}

// Reusable field rules with plain messages.
const fieldRules = {
  // A person's or business's name: trimmed, 1 to 60 characters.
  name: (label) => z.string({ error: `Enter ${label}.` }).trim().min(1, `Enter ${label}.`).max(60, 'Use at most 60 characters.'),
  // An email address, trimmed and in lower case (how it's stored and compared).
  email: () => z.string({ error: 'Enter an email address.' }).trim().toLowerCase().max(254, 'This email address is too long.')
    .pipe(z.email('Enter a valid email address.')),
  // A password as typed; its rules are checked by passwords.js.
  password: () => z.string({ error: 'Enter a password.' }).max(1000, 'Use at most 128 characters.'),
  language: () => z.enum(['en', 'tw'], { error: 'Choose English or Twi.' }),
};

module.exports = { parseBody, fieldError, fieldRules };
