// Product history (BE6, AC30): who changed a product and its sizes, and what
// changed, read from the ChangeLog. The ChangeLog keeps cost too (it's
// server-only), so this is where cost is removed for a manager: from every
// before/after, and a change that was ONLY about cost is left out entirely.

const { Op } = require('sequelize');
const { AppError } = require('../lib/errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Removes costMinor from a before/after object (null stays null).
function withoutCost(values) {
  if (!values) return values;
  const { costMinor, ...rest } = values; // eslint-disable-line no-unused-vars
  return rest;
}

// True if the change touched nothing but cost (only `version` and
// `productId` besides it).
function onlyCost(change) {
  const keys = new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})]);
  ['version', 'productId'].forEach((k) => keys.delete(k));
  return keys.size === 1 && keys.has('costMinor');
}

// The history of one product of the business in `s` (scoped models), oldest
// first, for someone with `role`. An unknown product, or another business's,
// is 404 NOT_FOUND (the same answer).
async function productHistory(s, models, { productId, role }) {
  const id = String(productId).toLowerCase();
  const product = UUID.test(id) ? await s.Product.findOne({ where: { id }, attributes: ['id'] }) : null;
  if (!product) throw new AppError(404, 'NOT_FOUND', 'Not found');

  const sizeIds = (await s.ProductSize.findAll({ where: { productId: id }, attributes: ['id'] })).map((r) => r.id);
  const rows = await s.ChangeLog.findAll({
    where: { [Op.or]: [{ entity: 'product', entityId: id }, ...(sizeIds.length ? [{ entity: 'size', entityId: sizeIds }] : [])] },
    order: [['seq', 'ASC']], // the order the changes were written (seq: ChangeLog's AUTO_INCREMENT)
  });

  const userIds = [...new Set(rows.map((r) => r.changedBy).filter(Boolean))];
  const users = userIds.length ? await models.User.findAll({ where: { id: userIds }, attributes: ['id', 'name'] }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  const isOwner = role === 'owner';
  return rows
    .filter((r) => isOwner || !onlyCost(r))
    .map((r) => ({
      entity: r.entity,
      entityId: r.entityId,
      changedBy: r.changedBy ? { userId: r.changedBy, name: nameOf.get(r.changedBy) ?? null } : null,
      changedAt: r.changedAt,
      before: isOwner ? r.before : withoutCost(r.before),
      after: isOwner ? r.after : withoutCost(r.after),
      conflict: r.conflict,
    }));
}

module.exports = { productHistory };
