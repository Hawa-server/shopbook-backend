// stock.create and stockCount.create (BE7, Epic 2): goods in and out, and
// physical counts. Both are PERMANENT records: inserted with the phone's ID,
// never changed; a mistake is balanced by another movement or a new count.
//
// - Owner and manager only (Decision F-17); associates are refused.
// - Never refused for short stock (Decision 2-3, F-8): what happened on the
//   shelf happened. A movement saved while the size's stock is below zero
//   (after it) gets `belowZeroOnArrival`, set ONCE on save; current stock
//   always comes from the stock rule, never from that flag.
// - A count records what was ON THE SHELF (ADR-24). Its difference is worked
//   out (returned in the result, never stored), and "check this count" is
//   worked out later by the phone and the server with the same rule.
// - The product row (and size) is locked first, in runOperation's global
//   order, so two operations on the same product work out stock one after
//   the other, never from the same old rows at once.

const { z } = require('zod');
const stock = require('../../services/stock');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_QUANTITY = 100000; // in the product's own unit (yards, pairs…); ×2 in units for yards
const CLOCK_SKEW_MS = 10 * 60 * 1000;

const id = () => z.string().trim().toLowerCase().regex(UUID, 'Must be an ID made with crypto.randomUUID().');
const note = () => z.string().transform((t) => t.normalize('NFC').trim()).pipe(z.string().min(1, 'Write a note.').max(200, 'Use at most 200 characters.'));
const recordedAt = () => z.iso.datetime({ error: 'Give the time it was recorded (UTC ISO 8601).' });

const movementSchema = z.object({
  movementId: id(),
  type: z.enum(['opening', 'restock', 'removal'], { error: 'Choose opening, restock or removal.' }),
  locationId: id(),
  productId: id(),
  sizeId: id().nullable(),
  quantityUnits: z.number({ error: 'Enter a quantity.' }).int('Use whole units (half yards for yard products).').min(1, 'The quantity must be at least 1.').max(MAX_QUANTITY * 2),
  reason: z.enum(['damaged', 'lost', 'supplier_return', 'used', 'other'], { error: 'Choose a reason.' }).nullable().optional(),
  note: note().nullable().optional(),
  recordedAt: recordedAt(),
});

const countSchema = z.object({
  countId: id(),
  locationId: id(),
  productId: id(),
  sizeId: id().nullable(),
  countedUnits: z.number().int().min(0, "A count can't be below zero.").max(MAX_QUANTITY * 2),
  baselineUnits: z.number().int().min(-1e7).max(1e7),
  baselineCursor: z.number().int().min(0),
  reason: z.enum(['damaged', 'lost_or_stolen', 'miscounted_before', 'other'], { error: 'Choose a reason.' }).nullable().optional(),
  note: note().nullable().optional(),
  recordedAt: recordedAt(),
});

const invalid = (ctx, fields) => ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', fields);

// Checks the product, size and location (all within this business) and
// locks the product and size rows. Returns the product.
async function placeOf(ctx, { productId, sizeId, locationId }, { forNewStock }) {
  const [product] = await ctx.lock('products', 'Product', { id: productId });
  if (!product) ctx.reject('NOT_FOUND', "This product doesn't exist.");
  if (sizeId) {
    const [size] = await ctx.lock('products', 'ProductSize', { id: sizeId });
    if (!size) ctx.reject('NOT_FOUND', "This size doesn't exist.");
    if (size.productId !== productId) invalid(ctx, { sizeId: 'This size belongs to another product.' });
    if (forNewStock && !size.isActive) invalid(ctx, { sizeId: 'This size has been removed.' });
  } else {
    const sizes = await ctx.s.ProductSize.count({ where: { productId, isActive: true }, transaction: ctx.transaction });
    if (sizes > 0) invalid(ctx, { sizeId: 'Choose a size.' });
  }
  const location = await ctx.s.Location.findOne({ where: { id: locationId }, transaction: ctx.transaction });
  if (!location) ctx.reject('NOT_FOUND', "This shop doesn't exist.");
  return product;
}

// Inserts a permanent record with the phone's ID (ID_TAKEN if it's used).
async function insertNew(ctx, model, row) {
  try {
    await ctx.s[model].create(row, { transaction: ctx.transaction });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') ctx.reject('ID_TAKEN', 'This ID is already used. Make a new one.');
    throw err;
  }
}

// clockSkew ("Clock problems" in the server plan): recorded more than 10
// minutes in the future, or made online (an untrusted hint) more than 10
// minutes away from when it arrived.
function clockSkew(ctx, recordedAtTime) {
  const gap = recordedAtTime.getTime() - ctx.now.getTime();
  return gap > CLOCK_SKEW_MS || (ctx.recordedOnline === true && Math.abs(gap) > CLOCK_SKEW_MS);
}

// stock.create: one opening, restock or removal of one size (owner, manager).
async function movementHandler(ctx, p) {
  const product = await placeOf(ctx, p, { forNewStock: p.type !== 'removal' });
  if (p.quantityUnits > MAX_QUANTITY * product.unitScale) invalid(ctx, { quantityUnits: 'Use at most 100,000.' });
  if (p.type === 'removal') {
    if (!p.reason) invalid(ctx, { reason: 'Choose a reason.' });
    if (p.reason === 'other' && !p.note) invalid(ctx, { note: 'Write what happened.' });
  } else if (p.reason) {
    invalid(ctx, { reason: 'Only removals have a reason.' });
  }

  const quantityUnits = p.type === 'removal' ? -p.quantityUnits : p.quantityUnits;
  const at = new Date(p.recordedAt);
  const place = { productId: p.productId, sizeId: p.sizeId, locationId: p.locationId };
  const after = await stock.stockOnHand(ctx.s, ctx.transaction, place, {
    plus: { id: p.movementId, quantityUnits, recordedAt: at, receivedAt: ctx.now },
  });
  const flags = { belowZeroOnArrival: after < 0, clockSkew: clockSkew(ctx, at) };

  await insertNew(ctx, 'StockMovement', {
    id: p.movementId, ...place, sizeId: p.sizeId ?? null, quantityUnits, type: p.type, reason: p.reason ?? null, note: p.note ?? null,
    flags, recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  ctx.stamp('StockMovement', { id: p.movementId });
  return { movementId: p.movementId, stockOnHandUnits: after, flags };
}

// stockCount.create: what was on the shelf (owner, manager). A reason only
// when the count differs from what the phone showed.
async function countHandler(ctx, p) {
  const product = await placeOf(ctx, p, { forNewStock: false });
  if (p.countedUnits > MAX_QUANTITY * product.unitScale) invalid(ctx, { countedUnits: 'Use at most 100,000.' });
  if (p.countedUnits !== p.baselineUnits) {
    if (!p.reason) invalid(ctx, { reason: 'Choose a reason for the difference.' });
    if (p.reason === 'other' && !p.note) invalid(ctx, { note: 'Write what happened.' });
  } else if (p.reason) {
    invalid(ctx, { reason: 'No reason is needed when the count matches.' });
  }

  const at = new Date(p.recordedAt);
  const place = { productId: p.productId, sizeId: p.sizeId, locationId: p.locationId };
  const count = { id: p.countId, countedUnits: p.countedUnits, recordedAt: at, receivedAt: ctx.now };
  const { expectedUnits, differenceUnits } = await stock.countResult(ctx.s, ctx.transaction, place, count);

  await insertNew(ctx, 'StockCount', {
    id: p.countId, ...place, sizeId: p.sizeId ?? null, countedUnits: p.countedUnits, baselineUnits: p.baselineUnits,
    baselineCursor: p.baselineCursor, reason: p.reason ?? null, note: p.note ?? null,
    recordedBy: ctx.user.id, recordedAt: at, receivedAt: ctx.now,
  });
  ctx.stamp('StockCount', { id: p.countId });
  const stockOnHandUnits = await stock.stockOnHand(ctx.s, ctx.transaction, place);
  return { countId: p.countId, expectedUnits, differenceUnits, stockOnHandUnits };
}

module.exports = {
  stockCreate: { roles: ['owner', 'manager'], schema: movementSchema, handler: movementHandler },
  stockCountCreate: { roles: ['owner', 'manager'], schema: countSchema, handler: countHandler },
};
