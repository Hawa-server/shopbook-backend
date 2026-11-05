// Ghana mobile numbers, written in the project (no library). People type the
// same number in many ways (024 123 4567, 24-123-4567, +233 24 123 4567), so
// every number is turned into one form, +233XXXXXXXXX, before it's stored or
// compared. Otherwise one person could end up with two accounts, or fail to
// sign in with the number they actually typed.

// The first two digits after +233 that belong to mobile networks (MTN,
// Telecel, AT and others). Update this list if Ghana adds new prefixes.
const MOBILE_PREFIXES = new Set(['20', '23', '24', '25', '26', '27', '28', '50', '53', '54', '55', '56', '57', '59']);

// Returns the number as +233XXXXXXXXX, or null if it isn't a Ghana mobile
// number. Accepts 0XXXXXXXXX, XXXXXXXXX, 233XXXXXXXXX, +233XXXXXXXXX and
// 00233XXXXXXXXX, with spaces, dashes, dots or brackets anywhere.
function normalizeGhanaPhone(input) {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;

  let digits = compact.replace(/^\+/, '');
  if (digits.startsWith('00233')) digits = digits.slice(5);
  else if (digits.startsWith('233') && digits.length === 12) digits = digits.slice(3);
  else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  else if (compact.startsWith('+')) return null; // another country's code

  if (!/^\d{9}$/.test(digits)) return null;
  if (!MOBILE_PREFIXES.has(digits.slice(0, 2))) return null;
  return `+233${digits}`;
}

module.exports = { normalizeGhanaPhone, MOBILE_PREFIXES };
