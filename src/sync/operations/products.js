// product.upsert and size.upsert (BE6, Epic 1): adding and editing products
// and their sizes, through sync like every other change.
//
// - "Upsert": a new ID creates the record (`baseVersion: null`); a known ID
//   edits it (`baseVersion`: the version the phone edited). Edits follow
//   "last change received wins, with history": the change is applied even if
//   someone else changed the record first, and ChangeLog keeps both, the later
//   one marked `conflict`.
// - Every accepted change gets a new `version`, and its prices and cost at
//   that version are written to PriceVersion IN THE SAME TRANSACTION, so a
//   sale (BE8) can be checked against the exact price the phone showed. The
//   new version is in the operation's stored result, so a sale made offline
//   right after an edit can name that edit by its opId (`editOpId`).
// - Cost is the OWNER's only: a manager sending `costMinor` is rejected
//   FORBIDDEN, and a manager's edit keeps the existing cost. The BELOW_COST
//   warning goes only to the owner (telling a manager would reveal the cost).
// - Duplicate names are WARNINGS, never rejections (decided 8 Nov 2026): two
//   phones adding "Black sandal" offline may each have sold it already, and
//   rejecting one would send its sales to "Needs attention".
// - Only the fields listed in the schemas can change (an allow-list); a
//   payload is never written straight to the database.

const { randomUUID } = require('node:crypto');
const { Op } = require('sequelize');
const { z } = require('zod');
const locale = require('../../locale');
const stock = require('../../services/stock');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SIZES = 60;
const PRODUCT_TYPES = ['clothing', 'shoes', 'fabric', 'other'];
const UNITS = ['piece', 'pair', 'set', 'dozen', 'yard', 'custom'];

// Text as people mean it: Unicode-normalised, trimmed, single spaces.
const tidy = (text) => text.normalize('NFC').trim().replace(/\s+/g, ' ');
// The form used to compare names: tidy, then lower case ("Black  Sandal " → "black sandal").
const normalizeName = (text) => tidy(text).toLowerCase();

const id = () => z.string().trim().toLowerCase().regex(UUID, 'Must be an ID made with crypto.randomUUID().');
const text = (max, emptyMessage, longMessage) => z.string().transform(tidy).pipe(z.string().min(1, emptyMessage).max(max, longMessage));
// A price: a whole number of minor units, at least 1. The upper limit
// depends on the business's currency, so it's checked in checkPriceLimits.
const price = () => z.number({ error: 'Enter a price.' }).int('Use whole minor units (for example 12000 for GH₵ 120.00).').min(1, 'The price must be more than zero.').max(1e15);

const productFields = z.object({
  name: text(80, 'Enter a product name.', 'Use a shorter name (up to 80 characters).'),
  type: z.enum(PRODUCT_TYPES, { error: 'Choose clothing, shoes, fabric or other.' }),
  unit: z.enum(UNITS, { error: 'Choose a unit.' }),
  unitLabel: text(20, "Enter the unit's name.", 'Use at most 20 characters.').nullable(),
  retailMinor: price(),
  wholesaleMinor: price().nullable(),
  costMinor: price().nullable(),
  lowStockLevelUnits: z.number().int().min(0).max(1e7).nullable(), // BE7: this product's own low-stock level, in units (null = the business's)
  lowStockWarnings: z.boolean(), // BE7: false = no low-stock warnings for this product
  isHidden: z.boolean(),
}).partial().strict().refine((f) => Object.keys(f).length > 0, { message: 'Give at least one field.' });

const sizeFields = z.object({
  label: text(20, 'Enter the size.', 'Use at most 20 characters.'),
  sortOrder: z.number().int().min(-1e6).max(1e6),
  retailMinor: price().nullable(),
  wholesaleMinor: price().nullable(),
  costMinor: price().nullable(),
  isActive: z.boolean(),
}).partial().strict().refine((f) => Object.keys(f).length > 0, { message: 'Give at least one field.' });

const productSchema = z.object({
  productId: id(),
  baseVersion: z.number().int().min(1).nullable(),
  fields: productFields,
});

const sizeSchema = z.object({
  sizeId: id(),
  productId: id(),
  baseVersion: z.number().int().min(1).nullable(),
  fields: sizeFields,
});

// BIGINT columns can come back as strings: always hand out numbers (or null).
const num = (v) => (v === null || v === undefined ? null : Number(v));

// The fields of a product or size that history records (cost included:
// ChangeLog is server-only, and the history endpoint removes cost for managers).
const PRODUCT_KEYS = ['name', 'type', 'unit', 'unitLabel', 'retailMinor', 'wholesaleMinor', 'costMinor', 'lowStockLevelUnits', 'lowStockWarnings', 'isHidden'];
const SIZE_KEYS = ['label', 'sortOrder', 'retailMinor', 'wholesaleMinor', 'costMinor', 'isActive'];
const MONEY_KEYS = ['retailMinor', 'wholesaleMinor', 'costMinor'];
function snapshot(row, keys) {
  return Object.fromEntries(keys.map((k) => [k, MONEY_KEYS.includes(k) ? num(row[k]) : row[k] ?? null]));
}

// Refuses cost from anyone but the owner (rule: cost is the owner's only).
function refuseCostFromStaff(ctx, fields) {
  if ('costMinor' in fields && ctx.membership.role !== 'owner') {
    ctx.reject('FORBIDDEN', 'Only the owner can set cost prices.', { costMinor: 'Only the owner can set cost prices.' });
  }
}

// Prices may be at most 1,000,000 in the business's currency (GH₵ 1,000,000.00
// = 100,000,000 pesewas for GHS).
function checkPriceLimits(ctx, fields) {
  const { minorUnits } = locale.currency(ctx.business.currency);
  const max = 1_000_000 * 10 ** minorUnits;
  const tooHigh = MONEY_KEYS.filter((k) => fields[k] != null && fields[k] > max);
  if (tooHigh.length > 0) {
    ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', Object.fromEntries(tooHigh.map((k) => [k, 'The price is too high (at most 1,000,000).'])));
  }
}

// Rejects with VALIDATION_FAILED unless every listed field has a value.
function requireFields(ctx, values, required) {
  const missing = Object.fromEntries(Object.entries(required).filter(([k]) => values[k] === undefined || values[k] === null));
  if (Object.keys(missing).length > 0) ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', missing);
}

// Unit rules: fabric is sold by the piece or the yard; the shop's own unit
// needs its name; the server sets unitScale (2 for yards, so 2.5 yards is
// stored as 5 units; 1 for everything else).
function unitOf(ctx, { type, unit, unitLabel }) {
  if (type === 'fabric' && !['piece', 'yard'].includes(unit)) {
    ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', { unit: 'Fabric is sold by the piece or by the yard.' });
  }
  if (unit === 'custom' && !unitLabel) {
    ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', { unitLabel: "Enter the unit's name." });
  }
  return { unitLabel: unit === 'custom' ? unitLabel : null, unitScale: unit === 'yard' ? 2 : 1 };
}

// The price warnings (never errors): wholesale above retail, and, FOR THE
// OWNER ONLY, a selling price below cost.
function priceWarnings(ctx, { retailMinor, wholesaleMinor, costMinor }) {
  const warnings = [];
  if (wholesaleMinor != null && wholesaleMinor > retailMinor) warnings.push({ code: 'WHOLESALE_ABOVE_RETAIL' });
  const sellingBelowCost = costMinor != null && (retailMinor < costMinor || (wholesaleMinor != null && wholesaleMinor < costMinor));
  if (ctx.membership.role === 'owner' && sellingBelowCost) warnings.push({ code: 'BELOW_COST' });
  return warnings;
}

// Inserts a row with an ID made on the phone. The ID was not found in this
// business; if the insert still clashes, the ID belongs to another business
// (in practice: never, with random UUIDs). Answered without saying more.
async function insertNew(ctx, model, row) {
  try {
    await ctx.s[model].create(row, { transaction: ctx.transaction });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') ctx.reject('ID_TAKEN', 'This ID is already used. Make a new one.');
    throw err;
  }
}

// Writes the PriceVersion row of a product (sizeId null) or size version.
function recordPriceVersion(ctx, { productId, sizeId = null, version, prices }) {
  return ctx.s.PriceVersion.create({
    id: randomUUID(), productId, sizeId, version,
    retailMinor: prices.retailMinor ?? null, wholesaleMinor: prices.wholesaleMinor ?? null, costMinor: prices.costMinor ?? null,
    createdByOpId: ctx.opId, createdAt: ctx.now,
  }, { transaction: ctx.transaction });
}

// Adds the ChangeLog row of a product or size change.
function recordHistory(ctx, { entity, entityId, before, after, conflict }) {
  return ctx.s.ChangeLog.create({
    id: randomUUID(), entity, entityId, changedBy: ctx.user.id, changedAt: ctx.now, before, after, conflict,
  }, { transaction: ctx.transaction });
}

// product.upsert: creates or edits a product (owner and manager).
async function productHandler(ctx, { productId, baseVersion, fields }) {
  const isOwner = ctx.membership.role === 'owner';
  refuseCostFromStaff(ctx, fields);
  checkPriceLimits(ctx, fields);

  const [existing] = await ctx.lock('products', 'Product', { id: productId });
  let row;
  let version;
  if (!existing) {
    if (baseVersion !== null) ctx.reject('NOT_FOUND', "This product doesn't exist.");
    requireFields(ctx, fields, {
      name: 'Enter a product name.', type: 'Choose clothing, shoes, fabric or other.', unit: 'Choose a unit.', retailMinor: 'Enter the retail price.',
      ...(isOwner ? { costMinor: 'Enter the cost price.' } : {}), // AC17: a manager's product waits for the owner's cost
    });
    version = 1;
    row = {
      id: productId, name: fields.name, nameNormalized: normalizeName(fields.name), type: fields.type, unit: fields.unit,
      ...unitOf(ctx, fields),
      retailMinor: fields.retailMinor, wholesaleMinor: fields.wholesaleMinor ?? null, costMinor: isOwner ? fields.costMinor : null,
      lowStockLevelUnits: fields.lowStockLevelUnits ?? null, lowStockWarnings: fields.lowStockWarnings ?? true,
      isHidden: fields.isHidden ?? false, version, createdBy: ctx.user.id, updatedBy: ctx.user.id,
    };
    await insertNew(ctx, 'Product', row);
    await recordHistory(ctx, { entity: 'product', entityId: productId, before: null, after: { ...snapshot(row, PRODUCT_KEYS), version }, conflict: false });
  } else {
    if (baseVersion === null) ctx.reject('VALIDATION_FAILED', 'This product already exists.', { baseVersion: 'Send the version you edited.' });
    const merged = { ...existing.get({ plain: true }), ...fields };
    if (fields.type === 'fabric' && existing.type !== 'fabric') {
      const sizes = await ctx.s.ProductSize.count({ where: { productId, isActive: true }, transaction: ctx.transaction });
      if (sizes > 0) ctx.reject('SIZES_NOT_ALLOWED', 'Fabric has no sizes: remove its sizes first.', { type: 'Fabric has no sizes.' });
    }
    Object.assign(merged, unitOf(ctx, merged));
    // Switching between yards (units are half yards) and any other unit
    // would change what every stored quantity means: refused once the
    // product has any stock record (BE7).
    if (merged.unitScale !== existing.unitScale && await stock.hasStockRecords(ctx.s, ctx.transaction, productId)) {
      ctx.reject('UNIT_LOCKED', "This product already has stock records, so it can't switch between yards and other units.", { unit: "Can't switch between yards and other units once there is stock." });
    }
    version = existing.version + 1;
    const changes = {
      ...Object.fromEntries(PRODUCT_KEYS.filter((k) => k in fields || k === 'unitLabel').map((k) => [k, merged[k]])),
      ...(fields.name ? { nameNormalized: normalizeName(fields.name) } : {}),
      unitScale: merged.unitScale, version, updatedBy: ctx.user.id,
    };
    await ctx.s.Product.update(changes, { where: { id: productId, version: existing.version }, transaction: ctx.transaction });
    row = { ...merged, ...changes };
    const keys = PRODUCT_KEYS.filter((k) => k in fields);
    await recordHistory(ctx, {
      entity: 'product', entityId: productId,
      before: { ...snapshot(existing, keys), version: existing.version },
      after: { ...snapshot(row, keys), version },
      conflict: baseVersion < existing.version,
    });
  }

  const prices = { retailMinor: num(row.retailMinor), wholesaleMinor: num(row.wholesaleMinor), costMinor: num(row.costMinor) };
  await recordPriceVersion(ctx, { productId, version, prices });
  ctx.stamp('Product', { id: productId });

  const warnings = priceWarnings(ctx, prices);
  if (!existing || fields.name) {
    const same = await ctx.s.Product.findOne({
      where: { nameNormalized: row.nameNormalized, id: { [Op.ne]: productId } }, order: [['createdAt', 'ASC'], ['id', 'ASC']], transaction: ctx.transaction,
    });
    if (same) warnings.push({ code: 'PRODUCT_NAME_DUPLICATE', productId: same.id });
  }
  return { productId, version, warnings };
}

// size.upsert: creates or edits one size of a product (owner and manager).
async function sizeHandler(ctx, { sizeId, productId, baseVersion, fields }) {
  refuseCostFromStaff(ctx, fields);
  checkPriceLimits(ctx, fields);

  // Lock order: the product, then its size (both "products" in LOCK_ORDER).
  const [product] = await ctx.lock('products', 'Product', { id: productId });
  if (!product) ctx.reject('NOT_FOUND', "This product doesn't exist.");
  const [existing] = await ctx.lock('products', 'ProductSize', { id: sizeId });
  if (existing && existing.productId !== productId) {
    ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', { productId: 'This size belongs to another product.' });
  }

  let row;
  let version;
  if (!existing) {
    if (baseVersion !== null) ctx.reject('NOT_FOUND', "This size doesn't exist.");
    if (product.type === 'fabric') ctx.reject('SIZES_NOT_ALLOWED', 'Fabric has no sizes.');
    requireFields(ctx, fields, { label: 'Enter the size.', sortOrder: 'Give the size its position.' });
    const count = await ctx.s.ProductSize.count({ where: { productId }, transaction: ctx.transaction });
    if (count >= MAX_SIZES) ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', { label: `A product can have at most ${MAX_SIZES} sizes.` });
    version = 1;
    row = {
      id: sizeId, productId, label: fields.label, labelNormalized: normalizeName(fields.label), sortOrder: fields.sortOrder,
      retailMinor: fields.retailMinor ?? null, wholesaleMinor: fields.wholesaleMinor ?? null,
      costMinor: ctx.membership.role === 'owner' ? fields.costMinor ?? null : null,
      isActive: fields.isActive ?? true, version, createdBy: ctx.user.id, updatedBy: ctx.user.id,
    };
    await insertNew(ctx, 'ProductSize', row);
    await recordHistory(ctx, { entity: 'size', entityId: sizeId, before: null, after: { ...snapshot(row, SIZE_KEYS), productId, version }, conflict: false });
  } else {
    if (baseVersion === null) ctx.reject('VALIDATION_FAILED', 'This size already exists.', { baseVersion: 'Send the version you edited.' });
    if (product.type === 'fabric' && fields.isActive === true) ctx.reject('SIZES_NOT_ALLOWED', 'Fabric has no sizes.');
    // A size that still has stock (above or below zero) can't be removed (BE7, Epic 1 AC11).
    if (fields.isActive === false && existing.isActive) {
      const units = await stock.stockOfSize(ctx.s, ctx.transaction, { productId, sizeId });
      if (units !== 0) {
        const message = `This size still has ${stock.unitsInWords(units, product.unitScale)} in stock.`;
        ctx.reject('SIZE_HAS_STOCK', message, { isActive: message });
      }
    }
    version = existing.version + 1;
    const changes = {
      ...fields, ...(fields.label ? { labelNormalized: normalizeName(fields.label) } : {}), version, updatedBy: ctx.user.id,
    };
    await ctx.s.ProductSize.update(changes, { where: { id: sizeId, version: existing.version }, transaction: ctx.transaction });
    row = { ...existing.get({ plain: true }), ...changes };
    const keys = SIZE_KEYS.filter((k) => k in fields);
    await recordHistory(ctx, {
      entity: 'size', entityId: sizeId,
      before: { ...snapshot(existing, keys), productId, version: existing.version },
      after: { ...snapshot(row, keys), productId, version },
      conflict: baseVersion < existing.version,
    });
  }

  const own = { retailMinor: num(row.retailMinor), wholesaleMinor: num(row.wholesaleMinor), costMinor: num(row.costMinor) };
  await recordPriceVersion(ctx, { productId, sizeId, version, prices: own });
  ctx.stamp('ProductSize', { id: sizeId });

  // Warnings use the prices this size really sells at (its own, else the product's).
  const warnings = priceWarnings(ctx, {
    retailMinor: own.retailMinor ?? num(product.retailMinor),
    wholesaleMinor: own.wholesaleMinor ?? num(product.wholesaleMinor),
    costMinor: own.costMinor ?? num(product.costMinor),
  });
  if (row.isActive && (!existing || fields.label || fields.isActive)) {
    const same = await ctx.s.ProductSize.findOne({
      where: { productId, labelNormalized: row.labelNormalized, isActive: true, id: { [Op.ne]: sizeId } }, transaction: ctx.transaction,
    });
    if (same) warnings.push({ code: 'SIZE_LABEL_DUPLICATE', sizeId: same.id });
  }
  return { sizeId, version, warnings };
}

module.exports = {
  productUpsert: { roles: ['owner', 'manager'], schema: productSchema, handler: productHandler },
  sizeUpsert: { roles: ['owner', 'manager'], schema: sizeSchema, handler: sizeHandler },
  normalizeName,
};
