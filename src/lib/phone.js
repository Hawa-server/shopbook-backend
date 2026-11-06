// Phone numbers, written in the project (no library). People type the same
// number in many ways (024 123 4567, +233 24 123 4567, 00233…), so every
// number is turned into one international form, E.164 (+<country code>
// <number>, e.g. +233241234567), before it's stored or compared. Otherwise
// one person could end up with two accounts, or fail to sign in with the
// number they typed. WhatsApp links need E.164 too.
//
// The rules per country come from the country table (src/locale). Only
// supported countries' numbers are accepted (launch: Ghana).

const { COUNTRIES, DEFAULT_COUNTRY } = require('../locale');

// Checks a national number (without trunk prefix) against a country's rules.
function validNational(rules, national) {
  if (!rules.nationalNumberLengths.includes(national.length)) return false;
  if (rules.mobilePrefixes && !rules.mobilePrefixes.some((p) => national.startsWith(p))) return false;
  return true;
}

// Returns the number in E.164, or null if it isn't a valid mobile number of
// a supported country. `countryCode` says how to read a LOCAL number
// (0241234567 or 241234567): the business's country, or the country chosen
// on the sign-in screen. An international number (+233…, 00233…, 233…) is
// read by its own country code. Spaces, dashes, dots and brackets are ignored.
function normalizePhone(input, countryCode = DEFAULT_COUNTRY) {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  const international = compact.startsWith('+') ? compact.slice(1) : compact.startsWith('00') ? compact.slice(2) : null;
  if (international !== null) {
    for (const rules of Object.values(COUNTRIES)) {
      if (international.startsWith(rules.dialCode)) {
        const national = international.slice(rules.dialCode.length);
        return validNational(rules, national) ? `+${rules.dialCode}${national}` : null;
      }
    }
    return null; // a country we don't support
  }

  const rules = COUNTRIES[countryCode];
  if (!rules) return null;
  let national = compact;
  if (national.startsWith(rules.dialCode) && validNational(rules, national.slice(rules.dialCode.length))) {
    national = national.slice(rules.dialCode.length); // typed with the country code but no +
  } else if (rules.trunkPrefix && national.startsWith(rules.trunkPrefix)) {
    national = national.slice(rules.trunkPrefix.length);
  }
  return validNational(rules, national) ? `+${rules.dialCode}${national}` : null;
}

module.exports = { normalizePhone };
