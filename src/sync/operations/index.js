// The registry of sync operation types: every type a phone may push, with
// who may send it (roles), how its payload is checked (a Zod schema) and
// what it does (a handler run inside runOperation). `npm run check:api-docs`
// compares this list with the "#### `type`" headings in docs/api.md.
// Later tasks add theirs (product.upsert in BE6, sale.create in BE8…).

const { settingsUpdate } = require('./settings');

const operations = Object.freeze({
  'settings.update': settingsUpdate,
});

module.exports = { operations };
