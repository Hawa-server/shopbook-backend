// Turns the checked environment into Sequelize's connection settings. Used by
// the server (src/db.js) and by the migration tool (sequelize-cli.js), so both
// always connect the same way.

const fs = require('node:fs');

// Builds the Sequelize options from a config made by parseEnv.
// - Times are stored and read in UTC ('+00:00'); business days in
//   Africa/Accra are worked out in code, never by the database's clock.
// - When a CA certificate is given (always in production, on Aiven), the
//   connection uses SSL and refuses a server whose certificate doesn't match,
//   so the database's traffic can't be read or faked on the way. The
//   certificate comes from a file (DB_SSL_CA_PATH) or from its text in an
//   environment variable (DB_SSL_CA); the environment check allows only one.
function buildDbOptions(config) {
  const options = {
    dialect: 'mysql',
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    username: config.DB_USER,
    password: config.DB_PASSWORD,
    timezone: '+00:00',
    logging: false, // SQL is never written to the logs (it can hold customer data)
    pool: { max: 5, min: 0, acquire: 10000, idle: 10000 },
    dialectOptions: { connectTimeout: 5000 },
  };

  const ca = config.DB_SSL_CA_PATH ? fs.readFileSync(config.DB_SSL_CA_PATH, 'utf8') : config.DB_SSL_CA;
  if (ca) {
    options.dialectOptions.ssl = { ca, rejectUnauthorized: true };
  }

  return options;
}

module.exports = { buildDbOptions };
