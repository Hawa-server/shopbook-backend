// Writing the change history (ChangeLog). Every change to the team (and, from
// BE5, to every editable record) adds one row in the SAME transaction as the
// change itself, so the history can never miss a change or show one that
// didn't happen. Rows are only ever added: nothing updates or deletes them.

const { randomUUID } = require('node:crypto');

// Adds one ChangeLog row inside `transaction`. `before`/`after` are plain
// objects of the fields that matter (never a password, hash or token).
function recordChange(models, transaction, { businessId, entity, entityId, changedBy, changedAt, before = null, after = null }) {
  return models.ChangeLog.create({
    id: randomUUID(), businessId, entity, entityId, changedBy, changedAt, before, after,
  }, { transaction });
}

module.exports = { recordChange };
