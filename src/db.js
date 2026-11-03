// The one database connection pool for the server, and the quick check that
// /api/health uses to say whether MySQL is answering.

const { Sequelize } = require('sequelize');
const { getConfig } = require('./config/env');
const { buildDbOptions } = require('./config/database');

let sequelize;

// Returns the shared Sequelize instance, creating it the first time. Created
// lazily so that tests which never touch the database don't need one.
function getSequelize() {
  if (!sequelize) sequelize = new Sequelize(buildDbOptions(getConfig()));
  return sequelize;
}

// Answers true if MySQL replies to `SELECT 1` within `timeoutMs`, else false.
// Never throws and never returns the error itself: health answers only
// "ok" or "down", so hostnames and error messages can't leak.
async function checkDatabase(timeoutMs = 3000) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
    });
    await Promise.race([getSequelize().query('SELECT 1'), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Closes the pool (on shutdown and at the end of tests) so the process can exit.
async function closeDatabase() {
  if (sequelize) {
    await sequelize.close();
    sequelize = undefined;
  }
}

module.exports = { getSequelize, checkDatabase, closeDatabase };
