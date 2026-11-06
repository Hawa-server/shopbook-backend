// Money helpers (BE4.5). Every amount is a WHOLE number of the currency's
// minor unit (pesewas for GHS): never a decimal, never floating point. This
// file writes such an amount the way people read it ("GH₵ 1,200.50"), using
// only the currency table, with integer arithmetic only. The phone app uses
// the same rules from GET /api/reference, so both always agree.

const { currency: currencyOf } = require('./index');

// Writes `minor` (an integer, e.g. 120050) in `currencyCode` (e.g. 'GHS'):
// symbol, a non-breaking space, the whole part grouped by thousands, then the
// minor digits: "GH₵ 1,200.50". A negative amount gets a minus sign in front:
// "-GH₵ 5.00". Throws for a non-integer or an unknown currency.
function formatMoney(minor, currencyCode) {
  if (!Number.isSafeInteger(minor)) throw new TypeError('formatMoney needs a whole number of minor units');
  const c = currencyOf(currencyCode);
  if (!c) throw new RangeError(`Unknown currency: ${currencyCode}`);

  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(c.minorUnits + 1, '0');
  const whole = c.minorUnits ? digits.slice(0, -c.minorUnits) : digits;
  const fraction = c.minorUnits ? digits.slice(-c.minorUnits) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, c.groupSeparator);
  const number = fraction ? `${grouped}${c.decimalSeparator}${fraction}` : grouped;
  const text = c.symbolPosition === 'before' ? `${c.symbol}${c.symbolSpace}${number}` : `${number}${c.symbolSpace}${c.symbol}`;
  return negative ? `-${text}` : text;
}

module.exports = { formatMoney };
