// GET /api/sync/pull (BE5 Part B): a phone asks for everything that changed
// after its cursor (the highest serverSeq it has stored).
//
// - At the start the server reads the business's current lastSeq: the
//   WATERMARK. It then SCANS the next `limit` sequence numbers (since <
//   serverSeq ≤ watermark) and returns the rows this person may see. Rows
//   committed during the pull have numbers above the watermark, so they come
//   in the next pull: nothing is ever skipped.
// - nextCursor is the last number SCANNED (not the last row returned), so a
//   page whose rows are all hidden from this person still moves the cursor on
//   and the phone never gets stuck asking again.
// - Rows are filtered BY ROLE on the server ("Who sees what"): settings and
//   locations go to everyone; memberships and devices only to the owner.

const { Op } = require('sequelize');
const { SYNCED_MODELS } = require('../models');
const { scoped } = require('../services/scoped');
const { readWatermark } = require('./runOperation');

const MAX_LIMIT = 500;

// Which roles receive each row type.
const VISIBLE_TO = {
  settings: ['owner', 'manager', 'associate'],
  location: ['owner', 'manager', 'associate'],
  membership: ['owner'],
  device: ['owner'],
};

// How each row type is sent (only these fields; never a key, hash or password).
const VIEWS = {
  settings: (r) => ({
    businessId: r.businessId, businessName: r.businessName, receiptPhone: r.receiptPhone ?? null, receiptNote: r.receiptNote ?? null,
    paymentMethods: r.paymentMethods, defaultLanguage: r.defaultLanguage, lowStockThreshold: r.lowStockThreshold,
    returnPeriodDays: r.returnPeriodDays, defaultCreditLimitMinor: r.defaultCreditLimitMinor === null ? null : Number(r.defaultCreditLimitMinor),
    version: r.version, updatedBy: r.updatedBy ?? null, updatedAt: r.updatedAt,
  }),
  location: (r) => ({ id: r.id, name: r.name, type: r.type }),
  // Invitation rows show only the name the owner typed (never the account's own).
  membership: (r) => {
    const fromInvitation = Boolean(r.invitedName);
    return {
      id: r.id, userId: fromInvitation ? null : r.userId, name: fromInvitation ? r.invitedName : r.user?.name ?? null,
      phone: r.user?.phone ?? null, role: r.role,
      status: r.isActive ? 'active' : !r.removedAt ? 'invited' : r.declinedAt ? 'declined' : 'removed',
      invitedAt: r.invitedAt ?? null, joinedAt: r.createdAt, removedAt: r.removedAt ?? null,
    };
  },
  device: (r) => ({
    id: r.id, deviceCode: r.deviceCode, name: r.name, userId: r.userId, isActive: r.isActive,
    lastSeenAt: r.lastSeenAt ?? null, lastSyncAt: r.lastSyncAt ?? null, lockedUntil: r.signatureLockedUntil ?? null,
    registeredAt: r.createdAt, revokedAt: r.revokedAt ?? null,
  }),
};

// Reads one page for the person in `req` (business, membership from requireAuth).
async function pullPage(deps, req, { since, limit }) {
  const models = deps.getModels();
  const s = scoped(req, models);
  const role = req.membership.role;

  const watermark = Number(await readWatermark(models, req.business.id));
  const upper = Math.min(since + limit, watermark);
  const rows = [];
  if (upper > since) {
    for (const [modelName, type] of Object.entries(SYNCED_MODELS)) {
      if (!VISIBLE_TO[type].includes(role)) continue;
      const include = modelName === 'Membership' || modelName === 'Device' ? [{ model: models.User, as: 'user' }] : [];
      const found = await s[modelName].findAll({ where: { serverSeq: { [Op.gt]: since, [Op.lte]: upper } }, include });
      for (const r of found) rows.push({ type, serverSeq: Number(r.serverSeq), data: VIEWS[type](r) });
    }
  }
  rows.sort((a, b) => a.serverSeq - b.serverSeq);
  const nextCursor = Math.max(since, upper);
  return { rows, nextCursor, hasMore: nextCursor < watermark, watermark };
}

module.exports = { pullPage, MAX_LIMIT, VISIBLE_TO };
