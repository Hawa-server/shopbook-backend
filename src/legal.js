// The privacy notice and terms: Markdown files in legal/ (English and Twi),
// read once when the server starts. TERMS_VERSION is the version a person
// accepts; changing the texts in a way people must agree to again means
// raising it, and then everyone is asked to accept the new version
// (403 TERMS_REQUIRED until they do).

const fs = require('node:fs');
const path = require('node:path');

const TERMS_VERSION = '1';
const LEGAL_DIR = path.resolve(__dirname, '../legal');

// Reads one document (privacy or terms) in one language.
function read(document, language) {
  return fs.readFileSync(path.join(LEGAL_DIR, `${document}.${language}.md`), 'utf8');
}

const documents = Object.freeze({
  en: { privacy: read('privacy', 'en'), terms: read('terms', 'en') },
  tw: { privacy: read('privacy', 'tw'), terms: read('terms', 'tw') },
});

// The answer for GET /api/legal/current.
function currentLegal() {
  return { version: TERMS_VERSION, documents };
}

module.exports = { TERMS_VERSION, currentLegal };
