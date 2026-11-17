// The privacy notice and terms: Markdown files in legal/ (English and Twi),
// read once when the server starts. TERMS_VERSION is the version a person
// accepts; changing the texts in a way people must agree to again means
// raising it, and then everyone is asked to accept the new version
// (403 TERMS_REQUIRED until they do).
//
// The texts write the product's name as {{productName}}; it's filled in from
// src/brand.js when they're read, so the name lives in one place.

const fs = require('node:fs');
const path = require('node:path');
const { PRODUCT_NAME } = require('./brand');

const TERMS_VERSION = '1';
const LEGAL_DIR = path.resolve(__dirname, '../legal');

// Reads one document (privacy or terms) in one language, with the product's
// name filled in.
function read(document, language) {
  const text = fs.readFileSync(path.join(LEGAL_DIR, `${document}.${language}.md`), 'utf8');
  return text.replaceAll('{{productName}}', PRODUCT_NAME);
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
