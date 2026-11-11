// THE sale rule (BE8): how a sale line's total, its set price and its cost
// are worked out. Pure functions with no database, so the phone app
// implements exactly the same rule; both are tested against the same
// fixtures (tests/fixtures/sale-rule.json, copied in docs/api.md).
//
// Money is whole minor units (pesewas for GHS), quantities whole units
// (half yards for yard products, unitScale 2). Integer arithmetic only.

// A line's total: quantityUnits × agreed price ÷ unitScale, ROUNDED TO THE
// NEAREST MINOR UNIT, HALVES UP (decided 9 Nov 2026: half a yard at
// GH₵ 15.05 is 752.5 pesewas → 753). `rounded` says whether rounding
// happened (the sale is then flagged roundedLine). Never rejected for it.
function lineTotal(quantityUnits, agreedPriceMinor, unitScale) {
  const exact2 = 2 * quantityUnits * agreedPriceMinor; // twice the exact total × unitScale, kept whole
  const lineTotalMinor = Math.floor((exact2 + unitScale) / (2 * unitScale));
  return { lineTotalMinor, rounded: (quantityUnits * agreedPriceMinor) % unitScale !== 0 };
}

// The set price of a line, from the prices of the versions the phone used.
// Retail: the size's own retail, else the product's. Wholesale: the size's
// own wholesale, else the product's wholesale, else the retail price (as
// for retail). `size` is null for a product without sizes.
function setPrice(priceType, product, size) {
  const retail = size?.retailMinor ?? product.retailMinor;
  if (priceType === 'retail') return retail;
  return size?.wholesaleMinor ?? product.wholesaleMinor ?? retail;
}

// The cost per unit of the product's unit (per yard for yards): the size's
// own cost, else the product's; null when none was entered (profit is then
// "incomplete"). Server only: phones never see or send cost.
function unitCost(product, size) {
  return size?.costMinor ?? product.costMinor ?? null;
}

// A sale's totals from its line totals and payment amounts.
function saleTotals(lineTotals, paymentAmounts) {
  const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0);
  const paidMinor = paymentAmounts.reduce((a, b) => a + b, 0);
  return { subtotalMinor, paidMinor, creditMinor: subtotalMinor - paidMinor };
}

module.exports = { lineTotal, setPrice, unitCost, saleTotals };
