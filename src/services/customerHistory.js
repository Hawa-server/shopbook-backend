// A customer's history (BE9, Epic 4 AC20): every sale to them, repayment,
// write-off and debt brought forward, with each reversal, NEWEST FIRST, and
// the customer's balance AFTER each one.
//
// The balance after each step is a running total in the debt rule's own
// order (effectiveAt, recordedAt, kindRank, id): + what the record added to
// the debt, − what it paid off. Reversed records stay in the history with
// their reversal right after them, so the two cancel out. Over the whole
// history it ends exactly at the customer's balance (the debt lots move
// money between lots but never add or lose any), and a test checks that.
// Owner and manager only; it needs the internet (the phone can't work these
// balances out on its own).

const { AppError } = require('../lib/errors');
const rule = require('./debtRule');
const { startOfDay } = require('../lib/time');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const num = (v) => Number(v);

// The history of one customer of the business in `s` (scoped models).
async function customerHistory(s, models, { customerId, timeZone }) {
  const id = String(customerId).toLowerCase();
  const customer = UUID.test(id) ? await s.Customer.findOne({ where: { id } }) : null;
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const where = { customerId: id };
  const [sales, repayments, writeOffs, openings] = await Promise.all([
    s.Sale.findAll({ where }), s.Repayment.findAll({ where }), s.DebtWriteOff.findAll({ where }), s.OpeningDebt.findAll({ where }),
  ]);
  const receiptOf = new Map(repayments.map((r) => [r.id, r.receiptNumber]));

  // One entry per record, with what it did to the balance (+ owed, − paid).
  const entries = [
    ...sales.map((r) => ({
      type: 'sale', id: r.id, kind: 'credit_sale', effectiveAt: r.recordedAt, recordedAt: r.recordedAt, receiptNumber: r.receiptNumber,
      amountMinor: num(r.subtotalMinor), balanceChangeMinor: num(r.creditMinor), recordedBy: r.recordedBy,
    })),
    ...repayments.map((r) => ({
      type: r.correctsRepaymentId ? 'repayment_reversal' : 'repayment', id: r.id, kind: 'repayment', effectiveAt: r.recordedAt, recordedAt: r.recordedAt,
      receiptNumber: r.receiptNumber, method: r.method, amountMinor: num(r.amountMinor),
      balanceChangeMinor: r.correctsRepaymentId ? num(r.amountMinor) : -num(r.amountMinor), recordedBy: r.recordedBy,
      reversesId: r.correctsRepaymentId ?? null, reversesReceiptNumber: r.correctsRepaymentId ? receiptOf.get(r.correctsRepaymentId) ?? null : null,
      reason: r.correctionReason ?? null, note: r.note ?? null,
    })),
    ...writeOffs.map((r) => ({
      type: r.correctsDebtWriteOffId ? 'write_off_reversal' : 'write_off', id: r.id, kind: 'write_off', effectiveAt: r.recordedAt, recordedAt: r.recordedAt,
      amountMinor: num(r.amountMinor), balanceChangeMinor: r.correctsDebtWriteOffId ? num(r.amountMinor) : -num(r.amountMinor), recordedBy: r.recordedBy,
      reversesId: r.correctsDebtWriteOffId ?? null, reason: r.correctsDebtWriteOffId ? r.correctionReason : r.reason, note: r.note ?? null,
    })),
    ...openings.map((r) => ({
      type: r.correctsOpeningDebtId ? 'opening_debt_reversal' : 'opening_debt', id: r.id, kind: 'opening_debt',
      effectiveAt: r.correctsOpeningDebtId ? r.recordedAt : startOfDay(String(r.owedSince), timeZone), recordedAt: r.recordedAt,
      owedSince: r.owedSince, amountMinor: num(r.amountMinor),
      balanceChangeMinor: r.correctsOpeningDebtId ? -num(r.amountMinor) : num(r.amountMinor), recordedBy: r.recordedBy,
      reversesId: r.correctsOpeningDebtId ?? null, reason: r.correctionReason ?? null, note: r.note ?? null,
    })),
  ];
  entries.forEach((e) => { e.orderKey = rule.orderKeyOf(e); });
  entries.sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
  let balance = 0;
  for (const e of entries) { balance += e.balanceChangeMinor; e.balanceAfterMinor = balance; }

  const userIds = [...new Set(entries.map((e) => e.recordedBy))];
  const users = userIds.length ? await models.User.findAll({ where: { id: userIds }, attributes: ['id', 'name'] }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    customerId: id, balanceMinor: num(customer.balanceMinor), oldestUnpaidAt: customer.oldestUnpaidAt ?? null,
    entries: entries.reverse().map(({ kind, orderKey, recordedBy, ...e }) => ({ ...e, recordedBy: { userId: recordedBy, name: nameOf.get(recordedBy) ?? null } })),
  };
}

module.exports = { customerHistory };
