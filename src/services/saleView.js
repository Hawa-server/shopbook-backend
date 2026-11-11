// What each role may see of a sale (BE8), used by the pull and by
// sale.create's own result, so the rules live in ONE place:
// - `unitCostMinor` and the `belowCost` flag: owner only (cost is the
//   owner's; "Sold below cost" would reveal it).
// - `olderPrice`, `overCreditLimit`, `afterDayClose`, `roundedLine`,
//   `methodDisabled`: owner and manager.
// - `belowZeroOnArrival`, `clockSkew`: everyone who can see the sale.
// Associates only ever receive their OWN sales (the pull filters them).

const FLAG_ROLES = {
  belowCost: ['owner'],
  olderPrice: ['owner', 'manager'],
  overCreditLimit: ['owner', 'manager'],
  afterDayClose: ['owner', 'manager'],
  roundedLine: ['owner', 'manager'],
  methodDisabled: ['owner', 'manager'],
  belowZeroOnArrival: ['owner', 'manager', 'associate'],
  clockSkew: ['owner', 'manager', 'associate'],
};

// BIGINT money columns can come back as strings: always hand out numbers.
const num = (v) => (v === null || v === undefined ? null : Number(v));

// The flags `role` may see (a flag not listed above is never sent).
function flagsFor(role, flags) {
  return Object.fromEntries(Object.entries(flags ?? {}).filter(([name]) => FLAG_ROLES[name]?.includes(role)));
}

// A sale as sent to `role`, with its lines and payments inside it.
function saleView(sale, role) {
  return {
    id: sale.id, receiptNumber: sale.receiptNumber, locationId: sale.locationId, deviceId: sale.deviceId,
    customerId: sale.customerId ?? null, priceType: sale.priceType,
    subtotalMinor: num(sale.subtotalMinor), paidMinor: num(sale.paidMinor), creditMinor: num(sale.creditMinor),
    flags: flagsFor(role, sale.flags), recordedBy: sale.recordedBy, recordedAt: sale.recordedAt, receivedAt: sale.receivedAt,
    items: (sale.items ?? []).map((i) => ({
      id: i.id, productId: i.productId, sizeId: i.sizeId ?? null, productName: i.productName, sizeLabel: i.sizeLabel ?? null,
      unit: i.unit, unitLabel: i.unitLabel ?? null, unitScale: i.unitScale, quantityUnits: i.quantityUnits,
      productVersion: i.productVersion, sizeVersion: i.sizeVersion ?? null,
      setPriceMinor: num(i.setPriceMinor), agreedPriceMinor: num(i.agreedPriceMinor), lineTotalMinor: num(i.lineTotalMinor),
      priceNote: i.priceNote ?? null,
      ...(role === 'owner' ? { unitCostMinor: num(i.unitCostMinor) } : {}),
    })),
    payments: (sale.payments ?? []).map((p) => ({ id: p.id, method: p.method, amountMinor: num(p.amountMinor) })),
  };
}

module.exports = { FLAG_ROLES, flagsFor, saleView };
