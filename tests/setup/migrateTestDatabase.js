// Jest's global setup: brings the TEST database up to date with every
// migration before any test runs, so tests always run against the same
// tables production gets. Refuses to run unless this is clearly the test
// database (NODE_ENV=test and a name ending in _test).

const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Runs `sequelize-cli db:migrate` with the test environment (.env.test,
// loaded by `npm test`). If .env.test is missing or incomplete, the tests
// that need the database fail with the environment check's own message.
module.exports = async function migrateTestDatabase() {
  if (process.env.NODE_ENV !== 'test' || !String(process.env.DB_NAME ?? '').endsWith('_test')) return;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../node_modules/sequelize-cli/lib/sequelize'), 'db:migrate'], {
    cwd: path.join(__dirname, '../..'),
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Migrating the test database failed:\n${result.stdout}\n${result.stderr}`);
  }
};
