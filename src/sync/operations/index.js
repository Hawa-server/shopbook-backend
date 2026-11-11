// The registry of sync operation types: every type a phone may push, with
// who may send it (roles), how its payload is checked (a Zod schema) and
// what it does (a handler run inside runOperation). `npm run check:api-docs`
// compares this list with the "#### `type`" headings in docs/api.md.
// Later tasks add theirs (repayment.create in BE9, correction.create in BE10…).

const { settingsUpdate } = require('./settings');
const { productUpsert, sizeUpsert } = require('./products');
const { stockCreate, stockCountCreate } = require('./stock');
const { saleCreate, customerUpsert } = require('./sales');

const operations = Object.freeze({
  'settings.update': settingsUpdate,
  'product.upsert': productUpsert,
  'size.upsert': sizeUpsert,
  'stock.create': stockCreate,
  'stockCount.create': stockCountCreate,
  'customer.upsert': customerUpsert,
  'sale.create': saleCreate,
});

module.exports = { operations };
