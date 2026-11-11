// The shared sale rule (src/services/saleRule.js) against the shared
// fixtures (tests/fixtures/sale-rule.json). The phone app runs the SAME
// fixtures against its own copy; docs/api.md shows them, and the last test
// keeps api.md's copy identical to the file.

const fs = require('node:fs');
const path = require('node:path');
const rule = require('../../src/services/saleRule');
const fixtures = require('../fixtures/sale-rule.json');

describe.each(fixtures.lineTotal)('line total: $name', (c) => {
  test('rounded to the nearest minor unit, halves up', () => {
    expect(rule.lineTotal(c.quantityUnits, c.agreedPriceMinor, c.unitScale)).toEqual(c.expect);
  });
});

describe.each(fixtures.setPrice)('set price: $name', (c) => {
  test('the size\'s own price, else the product\'s; wholesale falls back to retail', () => {
    expect(rule.setPrice(c.priceType, c.product, c.size)).toBe(c.expect);
  });
});

test('totals: subtotal, paid and credit add up', () => {
  expect(rule.saleTotals([3000, 753], [2000, 1000])).toEqual({ subtotalMinor: 3753, paidMinor: 3000, creditMinor: 753 });
});

test('docs/api.md shows exactly these fixtures', () => {
  const api = fs.readFileSync(path.join(__dirname, '../../docs/api.md'), 'utf8');
  const block = /<!-- sale-rule-fixtures:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- sale-rule-fixtures:end -->/.exec(api);
  expect(block).not.toBeNull();
  expect(JSON.parse(block[1])).toEqual(fixtures);
});
