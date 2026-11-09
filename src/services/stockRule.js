// THE stock rule (BE7, Decision 2-5, ADR-24): how stock on hand, a count's
// difference and "check this count" are worked out from the permanent
// records. Pure functions on plain rows, with no database, so the phone app
// implements exactly the same rule; both are tested against the same
// fixtures (tests/fixtures/stock-rule.json, copied in docs/api.md).
//
// Rows are for ONE product size at ONE location:
//   movement: { id, quantityUnits (signed), recordedAt, receivedAt }
//   count:    { id, countedUnits, recordedAt, receivedAt }
// Times are ISO strings or Dates. Every row is ordered by its stock key
// (recordedAt, id): earlier recordedAt first; for the same instant, the
// smaller id first, comparing the lower-case UUIDs as plain strings.

const CHECK_WINDOW_MS = 10 * 60 * 1000; // "a sale near the count time": within 10 minutes

// Milliseconds since 1970 from an ISO string or a Date.
const ms = (time) => (time instanceof Date ? time.getTime() : Date.parse(time));

// Compares two rows by stock key: negative if `a` comes first.
function compareKey(a, b) {
  const byTime = ms(a.recordedAt) - ms(b.recordedAt);
  if (byTime !== 0) return byTime;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// The latest of `counts` by stock key (or null).
function latestCount(counts) {
  return counts.reduce((latest, c) => (latest === null || compareKey(c, latest) > 0 ? c : latest), null);
}

// Stock on hand: with no count, the sum of all movements; after a count, the
// latest count's countedUnits plus the movements AFTER it (by stock key).
// Movements before the count are already reflected in what was on the shelf.
function stockOnHand({ movements, counts }) {
  const count = latestCount(counts);
  const after = count ? movements.filter((m) => compareKey(m, count) > 0) : movements;
  return (count ? count.countedUnits : 0) + after.reduce((sum, m) => sum + m.quantityUnits, 0);
}

// A count's expected stock (what the records said just before it) and its
// difference (counted − expected: + found more, − fewer). Uses only the
// rows before the count, so a late record recorded before the count changes
// the difference, and one recorded after it doesn't.
function countResult(count, { movements, counts }) {
  const before = (rows) => rows.filter((r) => compareKey(r, count) < 0);
  const expectedUnits = stockOnHand({ movements: before(movements), counts: before(counts) });
  return { expectedUnits, differenceUnits: count.countedUnits - expectedUnits };
}

// "Check this count": a movement recorded within 10 minutes of the count
// (either side) reached the server AFTER the count did, so a wrong phone
// clock could have put it on the wrong side of the count.
function countNeedsCheck(count, movements) {
  return movements.some((m) => Math.abs(ms(m.recordedAt) - ms(count.recordedAt)) <= CHECK_WINDOW_MS && ms(m.receivedAt) > ms(count.receivedAt));
}

module.exports = { compareKey, latestCount, stockOnHand, countResult, countNeedsCheck, CHECK_WINDOW_MS };
