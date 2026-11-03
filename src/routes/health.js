// GET /api/health: is the server running, and can it reach MySQL? The phone
// app calls it when it opens (to start waking the free Render server), and
// Render and you can use it to check a deploy. It answers only
// { status, database, version } with "ok" or "down": never an error message,
// a hostname or SQL, because anyone can call it.

const { version } = require('../../package.json');

// Makes the handler. `checkDatabase` is passed in (rather than imported) so
// tests can make the database look down without stopping MySQL.
// 200 when MySQL answers; 503 ("service unavailable") when it doesn't, so
// monitoring tools see the difference from the status code alone.
// BE17 switches `version` to the APP_VERSION setting.
function healthHandler({ checkDatabase }) {
  return async function health(req, res) {
    const databaseOk = await checkDatabase();
    const state = databaseOk ? 'ok' : 'down';
    res.status(databaseOk ? 200 : 503).json({ status: state, database: state, version });
  };
}

module.exports = { healthHandler };
