// Business days in the business's own time zone (BE9). Times are stored in
// UTC; a "business date" (YYYY-MM-DD) means a day in the shop's own zone
// (Business.timezone, e.g. Africa/Accra), never the server's. Uses only
// Node's built-in Intl (no library), so it works for any IANA zone.

// The YYYY-MM-DD date in `timeZone` at the instant `ms`.
function dateIn(timeZone, ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// How far `timeZone` is ahead of UTC at instant `ms`, in milliseconds.
function offsetAt(timeZone, ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// The UTC instant when the business date `date` (YYYY-MM-DD) starts in
// `timeZone`: midnight there. Corrected twice for zones with summer time.
function startOfDay(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let start = guess - offsetAt(timeZone, guess);
  start = guess - offsetAt(timeZone, start);
  return new Date(start);
}

module.exports = { dateIn, startOfDay };
