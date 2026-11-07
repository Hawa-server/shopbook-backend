// settings.update (BE5 Part B): the owner edits the business's settings
// (BusinessSettings, one row per business). Editable records follow "last
// change received wins, with history": the phone says which version it
// edited (`baseVersion`); the change is applied anyway, `version` goes up by
// one, and the previous values go to the ChangeLog, marked `conflict: true`
// when someone else had changed it first (baseVersion older than the stored
// version). Only the fields listed here can change (an allow-list): a payload
// is never written straight to the database.

const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const locale = require('../../locale');

// The fields settings.update may change, with their rules.
const changesSchema = z.object({
  businessName: z.string().trim().min(1, 'Enter the business name.').max(60, 'Use at most 60 characters.'),
  receiptPhone: z.string().trim().min(1).max(20, 'Use at most 20 characters.').nullable(),
  receiptNote: z.string().trim().max(120, 'Use at most 120 characters.').nullable(),
  defaultLanguage: z.enum(Object.keys(locale.LANGUAGES), { error: 'Choose one of the supported languages.' }),
  lowStockThreshold: z.number().int().min(0).max(100000),
  returnPeriodDays: z.number().int().min(0).max(365),
  defaultCreditLimitMinor: z.number().int().min(0).max(1e13).nullable(),
  paymentMethods: z.array(z.string()).min(1, 'Keep at least one payment method.'),
}).partial().strict().refine((c) => Object.keys(c).length > 0, { message: 'Give at least one setting to change.' });

const schema = z.object({
  baseVersion: z.number().int().min(1),
  changes: changesSchema,
});

// The values that matter for history: the changed fields and the version.
function pick(row, keys) {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
}

// Applies the change inside runOperation's transaction.
async function handler(ctx, { baseVersion, changes }) {
  const [settings] = await ctx.lock('settings', 'BusinessSettings', {});

  if (changes.paymentMethods) {
    const offered = locale.country(ctx.business.country).paymentMethods;
    const unique = [...new Set(changes.paymentMethods)];
    const notOffered = unique.filter((m) => !offered.includes(m));
    if (notOffered.length > 0) {
      ctx.reject('VALIDATION_FAILED', 'Check the highlighted fields.', { paymentMethods: `Not offered in this country: ${notOffered.join(', ')}.` });
    }
    changes = { ...changes, paymentMethods: unique };
  }

  const keys = Object.keys(changes);
  const before = { ...pick(settings, keys), version: settings.version };
  const version = settings.version + 1;
  await ctx.s.BusinessSettings.update(
    { ...changes, version, updatedBy: ctx.user.id },
    { where: { version: settings.version }, transaction: ctx.transaction },
  );
  await ctx.s.ChangeLog.create({
    id: randomUUID(), entity: 'settings', entityId: ctx.business.id, changedBy: ctx.user.id, changedAt: ctx.now,
    before, after: { ...changes, version }, conflict: baseVersion < settings.version,
  }, { transaction: ctx.transaction });
  ctx.stamp('BusinessSettings', {});
  return { version };
}

module.exports = { settingsUpdate: { roles: ['owner'], schema, handler } };
