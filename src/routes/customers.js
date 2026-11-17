// Customer endpoints (BE9). Customers themselves are added and changed
// through sync (customer.upsert); this file has only what sync can't give:
// a customer's history with the balance after each record (Epic 4 AC20),
// worked out by the server, for the owner and manager.

const { requireSession } = require('../lib/session');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { requireDevice } = require('../middleware/requireDevice');
const { scoped } = require('../services/scoped');
const { customerHistory } = require('../services/customerHistory');

// GET /api/customers/:customerId/history
function history(deps) {
  return async function handleHistory(req, res) {
    const models = deps.getModels();
    res.json(await customerHistory(scoped(req, models), models, { customerId: req.params.customerId, timeZone: req.business.timezone }));
  };
}

const customerRoutes = [
  {
    method: 'GET', path: '/api/customers/:customerId/history', business: true, signed: true,
    build: (d) => [requireSession(d), requireAuth(d), requireDevice(d), requireRole('owner', 'manager'), history(d)],
  },
];

module.exports = { customerRoutes };
