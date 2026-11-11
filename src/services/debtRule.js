// THE debt rule (BE9, ADR-20, server plan "Calculated"): how a customer's
// permanent records become debt lots, credit lots and allocations, and so
// their balance and how long they've owed. Pure functions with no database:
// the debt-lot service (debtLots.js) feeds them, check:balances uses them to
// rebuild from scratch, and the tests feed them shuffled events.
//
// Events (only records IN EFFECT: a reversed original and its reversal both
// drop out before they get here):
//   { kind, id, effectiveAt, recordedAt, amountMinor }      kinds below
//   return (BE10): { kind: 'return', id, effectiveAt, recordedAt, saleId,
//                    debtReducedMinor, keptAsCreditMinor }
//
// The order is ONLY from values on the records: (effectiveAt, recordedAt,
// kindRank, id), never arrival order or serverSeq, so the same records in
// any arrival order give exactly the same lots and allocations. IDs of lots
// and allocations are made from their sources (a hash), so even they match.

const { createHash } = require('node:crypto');

// At the very same instant, debts come before the reductions recorded with them.
const KIND_RANK = { opening_debt: 1, credit_sale: 2, exchange_credit: 3, return: 4, repayment: 5, write_off: 6 };
const DEBT_KINDS = new Set(['opening_debt', 'credit_sale', 'exchange_credit']);

const iso = (t) => (t instanceof Date ? t : new Date(t)).toISOString();

// The sort key of an event, as one string that sorts correctly as text
// (ISO times have a fixed width).
function orderKeyOf(e) {
  return `${iso(e.effectiveAt)}|${iso(e.recordedAt)}|${KIND_RANK[e.kind]}|${e.id}`;
}

// A UUID-shaped ID made from its parts, so a rebuild gives the same IDs.
function idFor(...parts) {
  const h = createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const byKey = (a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);

// A fresh, empty state for one customer.
function emptyState(businessId) {
  return { businessId, debtLots: [], creditLots: [], allocations: [] };
}

// Adds one allocation (a reduction of one debt lot by one source).
function allocate(state, debtLot, sourceType, sourceId, amountMinor, orderKey) {
  debtLot.outstandingMinor -= amountMinor;
  state.allocations.push({
    id: idFor(state.businessId, 'allocation', debtLot.id, sourceType, sourceId),
    debtLotId: debtLot.id, sourceType, sourceId, amountMinor, orderKey,
  });
}

// Adds a credit lot (money the shop owes the customer).
function addCredit(state, sourceType, e, amountMinor, orderKey) {
  if (amountMinor <= 0) return;
  state.creditLots.push({
    id: idFor(state.businessId, 'credit', sourceType, e.id), sourceType, sourceId: e.id,
    originalMinor: amountMinor, remainingMinor: amountMinor, effectiveAt: new Date(e.effectiveAt), orderKey,
  });
}

// Pays debt lots OLDEST first with `amount` from one source; returns what's left.
function payOldestFirst(state, amount, sourceType, sourceId, orderKey) {
  let left = amount;
  for (const lot of state.debtLots.filter((l) => l.outstandingMinor > 0).sort(byKey)) {
    if (left === 0) break;
    const take = Math.min(left, lot.outstandingMinor);
    allocate(state, lot, sourceType, sourceId, take, orderKey);
    left -= take;
  }
  return left;
}

// Applies ONE event to the state (the events must come in order). This one
// function is both the full rebuild (applied to every event) and the
// incremental path (applied to the newest event on top of the stored lots).
function apply(state, e) {
  const orderKey = orderKeyOf(e);
  if (DEBT_KINDS.has(e.kind)) {
    // 1. A debt becomes a lot; any credit the customer has pays it, oldest credit first.
    const lot = {
      id: idFor(state.businessId, 'debt', e.kind, e.id), sourceType: e.kind, sourceId: e.id,
      originalMinor: e.amountMinor, outstandingMinor: e.amountMinor, effectiveAt: new Date(e.effectiveAt), orderKey,
    };
    state.debtLots.push(lot);
    for (const credit of state.creditLots.filter((c) => c.remainingMinor > 0).sort(byKey)) {
      if (lot.outstandingMinor === 0) break;
      const take = Math.min(credit.remainingMinor, lot.outstandingMinor);
      credit.remainingMinor -= take;
      allocate(state, lot, 'credit_lot', credit.id, take, orderKey);
    }
  } else if (e.kind === 'return') {
    // 2. (BE10) A return's debt part reduces ONLY its own sale's lot; the rest is credit.
    const lot = state.debtLots.find((l) => l.sourceType === 'credit_sale' && l.sourceId === e.saleId);
    const take = lot ? Math.min(lot.outstandingMinor, e.debtReducedMinor) : 0;
    if (take > 0) allocate(state, lot, 'return_debt', e.id, take, orderKey);
    addCredit(state, 'return_excess', e, e.debtReducedMinor - take, orderKey);
    addCredit(state, 'return_kept_as_credit', e, e.keptAsCreditMinor ?? 0, orderKey); // 4.
  } else {
    // 3. Repayments and write-offs pay the oldest debts first; extra becomes credit.
    const allocType = e.kind === 'repayment' ? 'repayment' : 'write_off';
    const left = payOldestFirst(state, e.amountMinor, allocType, e.id, orderKey);
    addCredit(state, e.kind === 'repayment' ? 'repayment_excess' : 'write_off_excess', e, left, orderKey);
  }
  return state;
}

// 5. The balance (owed − credit; below zero = in credit) and since when the
// oldest unpaid debt has been owed (null when nothing is owed).
function summary(state) {
  const owed = state.debtLots.reduce((sum, l) => sum + l.outstandingMinor, 0);
  const credit = state.creditLots.reduce((sum, c) => sum + c.remainingMinor, 0);
  const oldest = state.debtLots.filter((l) => l.outstandingMinor > 0).sort(byKey)[0];
  return { balanceMinor: owed - credit, oldestUnpaidAt: oldest ? oldest.effectiveAt : null };
}

// The full rebuild: every event, in order, from an empty state.
function rebuild(businessId, events) {
  const state = emptyState(businessId);
  [...events].sort((a, b) => byKey({ orderKey: orderKeyOf(a) }, { orderKey: orderKeyOf(b) })).forEach((e) => apply(state, e));
  return { ...state, ...summary(state) };
}

module.exports = { KIND_RANK, orderKeyOf, idFor, apply, summary, rebuild, emptyState };
