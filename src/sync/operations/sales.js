// sale.create (BE8, Epic 3A). customer.upsert is in customers.js (BE9).
//
// sale.create saves one sale with its lines, payments and stock movements,
// all in ONE transaction (runOperation's), so a sale is never half saved.
// The rules:
// - THE SERVER RECALCULATES. Every line's set price comes from the price
//   VERSION the phone used (PriceVersion), its total from the shared sale
//   rule (rounded to the nearest minor unit, halves up), and the sale's
//   subtotal, paid and credit from those. The phone's figures are only
//   checked; a difference rejects the sale (a bug or tampering).
// - The COST is set by the server from the same version; the phone never
//   sends one, and only the owner ever sees it.
// - Never refused for what happened in the shop: stock below zero, over a
//   credit limit, below cost, an older price, a rounded half yard or a
//   payment method switched off since are SAVED and FLAGGED. The goods have
//   already left the stall.
// - Receipt numbers come from the phone; the ReceiptNumber registry (one
//   number, once, across sales, corrections and repayments) is written in
//   the same transaction.
// - Locks follow runOperation's global order: the customer, then products
//   and sizes (sorted by ID, so two sales can't wait on each other in a
//   circle), then the new rows; the sync counter last (runOperation does it).

const { z } = require('zod');
const locale = require('../../locale');
const rule = require('../../services/saleRule');
const stock = require('../../services/stock');
const { flagsFor } = require('../../services/saleView');
const { insertNew, clockSkew, registerReceipt, markMoneyRecorded, updateDebts, lockCustomer } = require('./common');
const debtLots = require('../../services/debtLots');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_QUANTITY = 100000; // in the product's own unit; ×2 in units for yards

const id = () => z.string().trim().toLowerCase().regex(UUID, 'Must be an ID made with crypto.randomUUID().');
const tidy = (t) => t.normalize('NFC').trim().replace(/\s+/g, ' ');
const text = (max, emptyMessage, longMessage) => z.string().transform(tidy).pipe(z.string().min(1, emptyMessage).max(max, longMessage));
const amount = () => z.number().int('Use whole minor units.').min(0).max(1e15);
const invalid = (ctx, fields) => ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', fields);

// ---- sale.create -----------------------------------------------------------

const itemSchema = z.object({
  itemId: id(),
  productId: id(),
  sizeId: id().nullable(),
  quantityUnits: z.number().int('Use whole units (half yards for yard products).').min(1, 'The quantity must be at least 1.').max(MAX_QUANTITY * 2),
  productVersion: z.number().int().min(1).optional(),
  productEditOpId: id().optional(),
  sizeVersion: z.number().int().min(1).optional(),
  sizeEditOpId: id().optional(),
  setPriceMinor: amount(),
  agreedPriceMinor: amount(),
  lineTotalMinor: amount(),
  priceNote: text(200, 'Write a note.', 'Use at most 200 characters.').nullable().optional(),
}).strict()
  .refine((i) => (i.productVersion === undefined) !== (i.productEditOpId === undefined), { message: 'Give productVersion or productEditOpId (one of them).', path: ['productVersion'] })
  .refine((i) => (i.sizeId === null
    ? i.sizeVersion === undefined && i.sizeEditOpId === undefined
    : (i.sizeVersion === undefined) !== (i.sizeEditOpId === undefined)), { message: 'With a size, give sizeVersion or sizeEditOpId (one of them); without one, neither.', path: ['sizeVersion'] });

const saleSchema = z.object({
  saleId: id(),
  receiptNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,4}-[0-9]{1,9}$/, 'A receipt number looks like K7M-0042.'),
  locationId: id(),
  customerId: id().nullable(),
  priceType: z.enum(['retail', 'wholesale'], { error: 'Choose retail or wholesale.' }),
  items: z.array(itemSchema).min(1, 'A sale needs at least one item.').max(100, 'At most 100 items in one sale.'),
  payments: z.array(z.object({
    paymentId: id(),
    method: z.string().trim().min(1).max(30),
    amountMinor: z.number().int().min(1, 'A payment must be more than zero.').max(1e15),
  }).strict()).max(10),
  subtotalMinor: amount(),
  paidMinor: amount(),
  creditMinor: amount(),
  recordedAt: z.iso.datetime({ error: 'Give the time it was recorded (UTC ISO 8601).' }),
}).strict();

// The version a line names: its number, or the version an edit made on the
// phone became (`editOpId`, from that operation's stored result). Unknown
// or not this product/size: UNKNOWN_PRICE_VERSION.
async function versionOf(ctx, { kind, entityId, version, editOpId, index }) {
  if (version !== undefined) return version;
  const op = await ctx.s.ProcessedOperation.findOne({
    where: { opId: editOpId, type: `${kind}.upsert`, status: 'saved' }, transaction: ctx.transaction,
  });
  const result = op?.resultJson?.result;
  const resultId = kind === 'product' ? result?.productId : result?.sizeId;
  if (!result || resultId !== entityId) {
    ctx.reject('UNKNOWN_PRICE_VERSION', 'This sale names a price change the server has not accepted.', { [`items.${index}.${kind}EditOpId`]: 'Unknown price change.' });
  }
  return result.version;
}

// The PriceVersion row of a product (sizeId null) or size at `version`.
async function pricesAt(ctx, { productId, sizeId, version, index, kind }) {
  const row = await ctx.s.PriceVersion.findOne({ where: { productId, sizeId: sizeId ?? null, version }, transaction: ctx.transaction });
  if (!row) ctx.reject('UNKNOWN_PRICE_VERSION', 'This sale names a price version the server never issued.', { [`items.${index}.${kind}Version`]: 'Unknown price version.' });
  const n = (v) => (v === null ? null : Number(v));
  return { retailMinor: n(row.retailMinor), wholesaleMinor: n(row.wholesaleMinor), costMinor: n(row.costMinor) };
}

// sale.create: one sale (every role).
async function saleHandler(ctx, p) {
  const flags = {
    belowZeroOnArrival: false, clockSkew: false, overCreditLimit: false, afterDayClose: false, // afterDayClose: day closes arrive in BE11
    belowCost: false, olderPrice: false, roundedLine: false, methodDisabled: false,
  };

  // 1. The customer (first in the lock order).
  const customer = p.customerId ? await lockCustomer(ctx, p.customerId) : null;

  // 2. Products, then sizes, each locked in ID order.
  const productIds = [...new Set(p.items.map((i) => i.productId))].sort();
  const sizeIds = [...new Set(p.items.map((i) => i.sizeId).filter(Boolean))].sort();
  const products = new Map((await ctx.lock('products', 'Product', { id: productIds })).map((r) => [r.id, r]));
  const sizes = new Map((sizeIds.length ? await ctx.lock('products', 'ProductSize', { id: sizeIds }) : []).map((r) => [r.id, r]));
  const location = await ctx.s.Location.findOne({ where: { id: p.locationId }, transaction: ctx.transaction });
  if (!location) ctx.reject('NOT_FOUND', "This shop doesn't exist.", { locationId: 'Unknown shop.' });

  // 3. Every line, worked out by the server.
  const lines = [];
  for (const [index, item] of p.items.entries()) {
    const product = products.get(item.productId);
    if (!product) ctx.reject('NOT_FOUND', "This sale names a product that doesn't exist.", { [`items.${index}.productId`]: 'Unknown product.' });
    const size = item.sizeId ? sizes.get(item.sizeId) : null;
    if (item.sizeId && (!size || size.productId !== item.productId)) {
      ctx.reject('NOT_FOUND', "This sale names a size that doesn't exist for this product.", { [`items.${index}.sizeId`]: 'Unknown size.' });
    }
    // A hidden product or removed size is still sold (decided 9 Nov 2026): the goods have gone.
    if (item.quantityUnits > MAX_QUANTITY * product.unitScale) invalid(ctx, { [`items.${index}.quantityUnits`]: 'Use at most 100,000.' });

    const productVersion = await versionOf(ctx, { kind: 'product', entityId: product.id, version: item.productVersion, editOpId: item.productEditOpId, index });
    const sizeVersion = size ? await versionOf(ctx, { kind: 'size', entityId: size.id, version: item.sizeVersion, editOpId: item.sizeEditOpId, index }) : null;
    const productPrices = await pricesAt(ctx, { productId: product.id, version: productVersion, index, kind: 'product' });
    const sizePrices = size ? await pricesAt(ctx, { productId: product.id, sizeId: size.id, version: sizeVersion, index, kind: 'size' }) : null;

    const setPriceMinor = rule.setPrice(p.priceType, productPrices, sizePrices);
    if (item.setPriceMinor !== setPriceMinor) {
      ctx.reject('PRICE_VERSION_MISMATCH', "This line's set price isn't the price of the version it names.", { [`items.${index}.setPriceMinor`]: `The set price of that version is ${setPriceMinor}.` });
    }
    if (item.agreedPriceMinor !== setPriceMinor && !item.priceNote) invalid(ctx, { [`items.${index}.priceNote`]: 'Add a note for the changed price.' });
    const { lineTotalMinor, rounded } = rule.lineTotal(item.quantityUnits, item.agreedPriceMinor, product.unitScale);
    if (item.lineTotalMinor !== lineTotalMinor) {
      ctx.reject('SALE_TOTALS_MISMATCH', "A line total doesn't add up.", { [`items.${index}.lineTotalMinor`]: `Expected ${lineTotalMinor}.` });
    }
    if (rounded) flags.roundedLine = true;

    const unitCostMinor = rule.unitCost(productPrices, sizePrices);
    if (unitCostMinor !== null && item.agreedPriceMinor < unitCostMinor) flags.belowCost = true;

    // Older price: the version used is older than the current one AND the
    // current set price differs (Decision 3-8). Saved, never refused.
    const usedOlder = productVersion < product.version || (size && sizeVersion < size.version);
    if (usedOlder) {
      const currentProduct = await pricesAt(ctx, { productId: product.id, version: product.version, index, kind: 'product' });
      const currentSize = size ? await pricesAt(ctx, { productId: product.id, sizeId: size.id, version: size.version, index, kind: 'size' }) : null;
      if (rule.setPrice(p.priceType, currentProduct, currentSize) !== setPriceMinor) flags.olderPrice = true;
    }

    lines.push({
      id: item.itemId, productId: product.id, sizeId: size ? size.id : null, productName: product.name, sizeLabel: size ? size.label : null,
      unit: product.unit, unitLabel: product.unitLabel ?? null, unitScale: product.unitScale, quantityUnits: item.quantityUnits,
      productVersion, sizeVersion, setPriceMinor, agreedPriceMinor: item.agreedPriceMinor, lineTotalMinor,
      priceNote: item.priceNote ?? null, unitCostMinor,
    });
  }

  // 4. Payments: an unknown method is refused; a known one the business
  // has switched off is saved and flagged (decided 9 Nov 2026).
  const methods = new Set();
  const enabled = (await ctx.s.BusinessSettings.findOne({ where: {}, transaction: ctx.transaction })).paymentMethods;
  for (const [index, pay] of p.payments.entries()) {
    if (!Object.hasOwn(locale.PAYMENT_METHODS, pay.method)) {
      ctx.reject('PAYMENT_METHOD_UNKNOWN', 'Unknown payment method.', { [`payments.${index}.method`]: 'Unknown payment method.' });
    }
    if (methods.has(pay.method)) invalid(ctx, { [`payments.${index}.method`]: 'Each payment method once per sale.' });
    methods.add(pay.method);
    if (!enabled.includes(pay.method)) flags.methodDisabled = true;
  }

  // 5. Totals (the sale invariants).
  const totals = rule.saleTotals(lines.map((l) => l.lineTotalMinor), p.payments.map((x) => x.amountMinor));
  const sent = { subtotalMinor: p.subtotalMinor, paidMinor: p.paidMinor, creditMinor: p.creditMinor };
  const wrong = Object.keys(sent).filter((k) => sent[k] !== totals[k]);
  if (wrong.length > 0) {
    ctx.reject('SALE_TOTALS_MISMATCH', "The sale's totals don't add up.", Object.fromEntries(wrong.map((k) => [k, `Expected ${totals[k]}.`])));
  }
  if (totals.creditMinor < 0) ctx.reject('SALE_TOTALS_MISMATCH', 'More was paid than the sale is worth.', { paidMinor: 'Payments are more than the total.' });
  if (totals.creditMinor > 0 && !customer) invalid(ctx, { customerId: 'Choose a customer for the part on credit.' });

  // 6. The receipt number: this phone's code, once in the whole business.
  await registerReceipt(ctx, p.receiptNumber, 'sale', p.saleId);

  // 7. The sale, its lines, payments and stock movements (one per line; the
  // movement's ID is the line's ID, so the phone's own copy matches).
  const at = new Date(p.recordedAt);
  flags.clockSkew = clockSkew(ctx, at);
  for (const line of lines) {
    const place = { productId: line.productId, sizeId: line.sizeId, locationId: p.locationId };
    const after = await stock.stockOnHand(ctx.s, ctx.transaction, place, {
      plus: { id: line.id, quantityUnits: -line.quantityUnits, recordedAt: at, receivedAt: ctx.now },
    });
    line.belowZero = after < 0;
    if (line.belowZero) flags.belowZeroOnArrival = true;
  }
  if (customer && totals.creditMinor > 0 && customer.creditLimitMinor !== null
    && Number(customer.balanceMinor) + totals.creditMinor > Number(customer.creditLimitMinor)) {
    flags.overCreditLimit = true; // Decision 3-3: never a rejection
  }

  await insertNew(ctx, 'Sale', {
    id: p.saleId, locationId: p.locationId, deviceId: ctx.device.id, receiptNumber: p.receiptNumber, customerId: p.customerId,
    priceType: p.priceType, ...totals, flags, recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  for (const line of lines) {
    const { belowZero, ...item } = line;
    await insertNew(ctx, 'SaleItem', { ...item, saleId: p.saleId });
    await insertNew(ctx, 'StockMovement', {
      id: line.id, locationId: p.locationId, productId: line.productId, sizeId: line.sizeId, quantityUnits: -line.quantityUnits,
      type: 'sale', saleId: p.saleId, flags: { belowZeroOnArrival: belowZero, clockSkew: flags.clockSkew },
      recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
    });
    ctx.stamp('StockMovement', { id: line.id });
  }
  for (const pay of p.payments) {
    await insertNew(ctx, 'SalePayment', { id: pay.paymentId, saleId: p.saleId, method: pay.method, amountMinor: pay.amountMinor });
  }
  ctx.stamp('Sale', { id: p.saleId });

  // 8. The credit part becomes a debt lot (BE9): the customer's balance and
  // oldestUnpaidAt follow, in this same transaction.
  if (customer && totals.creditMinor > 0) {
    await updateDebts(ctx, customer.id, debtLots.saleEvent({ id: p.saleId, creditMinor: totals.creditMinor, recordedAt: at }));
  }

  // 9. The business's first money record locks its country, currency and time zone.
  await markMoneyRecorded(ctx);

  return { saleId: p.saleId, receiptNumber: p.receiptNumber, ...totals, flags: flagsFor(ctx.membership.role, flags) };
}

module.exports = {
  saleCreate: { roles: ['owner', 'manager', 'associate'], schema: saleSchema, handler: saleHandler },
};
