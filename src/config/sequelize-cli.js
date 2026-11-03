// Settings file for sequelize-cli (migrations). It reads the same checked
// environment as the server, so `npm run db:migrate` uses exactly the database
// the server would. The env file chosen by the npm script (.env, .env.test, or
// your own .env.production) decides which database that is.

const { getConfigOrExit } = require('./env');
const { buildDbOptions } = require('./database');

const options = buildDbOptions(getConfigOrExit());

// sequelize-cli looks up the block named after NODE_ENV; all three are the
// same because the env file has already chosen the database.
module.exports = { development: options, test: options, production: options };
