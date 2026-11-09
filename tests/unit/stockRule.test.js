// The shared stock rule (src/services/stockRule.js) against the shared
// fixtures (tests/fixtures/stock-rule.json). The phone app runs the SAME
// fixtures against its own copy of the rule; docs/api.md shows them, and the
// last test keeps api.md's copy identical to the file.

const fs = require('node:fs');
const path = require('node:path');
const rule = require('../../src/services/stockRule');
const fixtures = require('../fixtures/stock-rule.json');

describe.each(fixtures.cases)('$name', (c) => {
  test('stock on hand', () => {
    expect(rule.stockOnHand({ movements: c.movements, counts: c.counts })).toBe(c.expect.stockOnHand);
  });
  test('each count: expected, difference, needs a check', () => {
    for (const e of c.expect.counts) {
      const count = c.counts.find((x) => x.id === e.id);
      expect(rule.countResult(count, c)).toEqual({ expectedUnits: e.expectedUnits, differenceUnits: e.differenceUnits });
      expect(rule.countNeedsCheck(count, c.movements)).toBe(e.needsCheck);
    }
  });
  test('the answer doesn\'t depend on the order the rows arrive in', () => {
    const reversed = { movements: [...c.movements].reverse(), counts: [...c.counts].reverse() };
    expect(rule.stockOnHand(reversed)).toBe(c.expect.stockOnHand);
  });
});

test('docs/api.md shows exactly these fixtures', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../docs/api.md'), 'utf8');
  const block = /<!-- stock-rule-fixtures:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- stock-rule-fixtures:end -->/.exec(api);
  expect(block).not.toBeNull();
  expect(JSON.parse(block[1])).toEqual(fixtures);
});
