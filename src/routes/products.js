// Product endpoints (BE6). Products and sizes themselves are added and
// changed through sync (product.upsert, size.upsert) and arrive in the pull;
// this file has only what sync can't give: a product's change history
// (AC30), for the owner (with cost) and the manager (without cost).

const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { requireDevice } = require('../middleware/requireDevice');
const { scoped } = require('../services/scoped');
const { productHistory } = require('../services/products');

// GET /api/products/:productId/history: the product's and its sizes' changes.
function history(deps) {
  return async function handleHistory(req, res) {
    const models = deps.getModels();
    const changes = await productHistory(scoped(req, models), models, { productId: req.params.productId, role: req.membership.role });
    res.json({ changes });
  };
}

const productRoutes = [
  {
    method: 'GET', path: '/api/products/:productId/history', business: true, signed: true,
    build: (d) => [requireSession(d), requireAuth(d), requireDevice(d), requireRole('owner', 'manager'), history(d)],
  },
];

module.exports = { productRoutes };
