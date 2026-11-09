// POST /api/sync/push (BE5 Part B): a phone sends its outbox, oldest first,
// at most 200 operations. Each is processed IN ORDER, in its OWN transaction
// (runOperation), and gets its own result; one rejected operation doesn't
// stop the others. A temporary failure (database down, deadlock after
// retries) stops the batch with a 5xx: what was saved before it stays saved,
// and the phone retries the rest (those saved come back "duplicate").
//
// Validation that can't change (the envelope, the type, the payload's shape)
// is answered `rejected` WITHOUT reserving the opId: the same data will always
// fail the same way, and nothing is stored for data that can't be trusted.

const { z } = require('zod');
const { operations: defaultOperations } = require('./operations');
const { runOperation } = require('./runOperation');

const MAX_OPERATIONS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One operation in the push body.
const envelopeSchema = z.object({
  opId: z.string().trim().toLowerCase().regex(UUID),
  type: z.string().min(1).max(40),
  recordedOnline: z.boolean().default(false), // an untrusted hint (clock-skew flag, from BE8)
  payload: z.record(z.string(), z.unknown()),
});

// Turns Zod issues into { field: message }.
function fieldsOf(error) {
  const fields = {};
  for (const issue of error.issues) {
    const name = issue.path.join('.') || '_';
    if (!fields[name]) fields[name] = issue.message;
  }
  return fields;
}

// A rejection that isn't stored (validation that will always fail the same way).
function invalid(opId, code, message, fields) {
  return { opId, status: 'rejected', error: { code, message, ...(fields ? { fields } : {}) } };
}

// Processes the operations of one push, in order. Returns the results.
async function processPush(deps, context, rawOperations) {
  const results = [];
  for (const raw of rawOperations) {
    const opId = typeof raw?.opId === 'string' ? raw.opId.toLowerCase() : null;
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success) {
      results.push(invalid(opId, 'INVALID_PAYLOAD', 'This operation is malformed.', fieldsOf(envelope.error)));
      continue;
    }
    const { type, payload } = envelope.data;
    const registry = deps.operations ?? defaultOperations;
    const definition = Object.hasOwn(registry, type) ? registry[type] : undefined;
    if (!definition) {
      results.push(invalid(envelope.data.opId, 'UNKNOWN_OPERATION', `Unknown operation type: ${type}.`));
      continue;
    }
    const parsed = definition.schema.safeParse(payload);
    if (!parsed.success) {
      results.push(invalid(envelope.data.opId, 'INVALID_PAYLOAD', 'Check the highlighted fields.', fieldsOf(parsed.error)));
      continue;
    }
    const outcome = await runOperation(deps, { context, opId: envelope.data.opId, type, payload: parsed.data, definition, recordedOnline: envelope.data.recordedOnline });
    results.push({ opId: envelope.data.opId, ...outcome });
  }
  return results;
}

module.exports = { processPush, MAX_OPERATIONS };
