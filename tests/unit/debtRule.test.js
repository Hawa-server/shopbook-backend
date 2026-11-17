// The debt rule (src/services/debtRule.js), with no database: the server
// plan's worked example, oldest debt paid first, credit used by the next
// debt, write-offs, debts and payments at the same instant, and the same
// events in ANY order giving exactly the same lots and allocations.

const rule = require('../../src/services/debtRule');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (day, hour = 10) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const ev = (kind, n, day, amountMinor, extra = {}) => ({ kind, id: id(n), effectiveAt: at(day), recordedAt: at(day), amountMinor, ...extra });

// A random order of `list` (seeded, so a failure can be repeated).
function shuffled(list, seed) {
  const out = [...list];
  let x = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('the worked example: A 500 from the notebook, B 300 on credit, 400 repaid oldest first, 100 returned from B → A 100, B 200, balance 300 owed since A', () => {
  const result = rule.rebuild('biz', [
    ev('opening_debt', 1, 1, 50000, { recordedAt: at(5) }),
    ev('credit_sale', 2, 6, 30000),
    ev('repayment', 3, 7, 40000),
    { kind: 'return', id: id(4), effectiveAt: at(8), recordedAt: at(8), saleId: id(2), debtReducedMinor: 10000, keptAsCreditMinor: 0 },
  ]);
  expect(result.debtLots.map((l) => [l.sourceType, l.outstandingMinor])).toEqual([['opening_debt', 10000], ['credit_sale', 20000]]);
  expect(result.balanceMinor).toBe(30000);
  expect(result.oldestUnpaidAt.toISOString()).toBe(at(1));
  expect(result.allocations.map((a) => [a.sourceType, a.amountMinor])).toEqual([['repayment', 40000], ['return_debt', 10000]]);
});

test('the same events in any order give exactly the same lots, allocations and balance (20 shuffles)', () => {
  const events = [
    ev('credit_sale', 1, 1, 12000), ev('credit_sale', 2, 2, 8000), ev('repayment', 3, 3, 15000),
    ev('opening_debt', 4, 1, 5000, { recordedAt: at(9) }), ev('write_off', 5, 4, 2000), ev('repayment', 6, 5, 20000),
    ev('credit_sale', 7, 6, 4000), ev('repayment', 8, 6, 1000),
  ];
  const expected = JSON.stringify(rule.rebuild('biz', events));
  for (let seed = 1; seed <= 20; seed += 1) expect(JSON.stringify(rule.rebuild('biz', shuffled(events, seed)))).toBe(expected);
});

test('overpaying makes credit (never negative debt), and the next credit sale uses it first, naming the credit lot', () => {
  const result = rule.rebuild('biz', [ev('credit_sale', 1, 1, 10000), ev('repayment', 2, 2, 12000), ev('credit_sale', 3, 3, 5000)]);
  expect(result.creditLots).toEqual([expect.objectContaining({ sourceType: 'repayment_excess', originalMinor: 2000, remainingMinor: 0 })]);
  const creditUse = result.allocations.find((a) => a.sourceType === 'credit_lot');
  expect(creditUse).toMatchObject({ sourceId: result.creditLots[0].id, amountMinor: 2000 });
  expect(result.debtLots.map((l) => l.outstandingMinor)).toEqual([0, 3000]);
  expect(result.balanceMinor).toBe(3000);
});

test('in credit: the balance goes below zero and nothing is owed', () => {
  const result = rule.rebuild('biz', [ev('credit_sale', 1, 1, 10000), ev('repayment', 2, 2, 12000)]);
  expect([result.balanceMinor, result.oldestUnpaidAt]).toEqual([-2000, null]);
});

test('a write-off pays the oldest debt like a repayment; oldestUnpaidAt moves on to the next unpaid lot', () => {
  const result = rule.rebuild('biz', [ev('credit_sale', 1, 1, 5000), ev('credit_sale', 2, 3, 7000), ev('write_off', 3, 4, 5000)]);
  expect(result.balanceMinor).toBe(7000);
  expect(result.oldestUnpaidAt.toISOString()).toBe(at(3));
});

test('at the very same instant a debt comes before the payment recorded with it (kindRank), whatever the IDs', () => {
  const sameTime = { effectiveAt: at(1), recordedAt: at(1) };
  const result = rule.rebuild('biz', [
    { kind: 'repayment', id: id(1), amountMinor: 3000, ...sameTime }, // smaller ID, but a payment
    { kind: 'credit_sale', id: id(9), amountMinor: 5000, ...sameTime },
  ]);
  expect(result.creditLots).toEqual([]); // the payment found the debt: no "excess"
  expect(result.balanceMinor).toBe(2000);
});

test('lot and allocation IDs come from their sources, so a rebuild gives the same IDs', () => {
  const a = rule.rebuild('biz', [ev('credit_sale', 1, 1, 100), ev('repayment', 2, 2, 50)]);
  const b = rule.rebuild('biz', [ev('repayment', 2, 2, 50), ev('credit_sale', 1, 1, 100)]);
  expect(a.debtLots[0].id).toBe(b.debtLots[0].id);
  expect(a.allocations[0].id).toBe(b.allocations[0].id);
  expect(a.debtLots[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
