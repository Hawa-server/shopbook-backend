// Production migrations, run ONLY by the project owner from their laptop:
//   npm run db:migrate:production         (apply new migrations)
//   npm run db:migrate:status:production  (list what has run, change nothing)
// Claude Code writes this script but never runs it.
//
// Guards against migrating the wrong database by accident:
// - the settings come only from `.env.production` in the project folder; if
//   that file is missing, it stops before connecting to anything;
// - the shell's own environment is NOT passed on (only PATH and HOME), so a
//   DB_HOST left exported in the terminal can't redirect it to another database;
// - the file must say NODE_ENV=production and pass the full environment check
//   (SSL certificate, TRUST_PROXY…), so a copied development file is refused;
// - before anything runs, it prints the host and database it's about to use.

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');
const { parseEnv, EnvError } = require('../src/config/env');

const ROOT = path.resolve(__dirname, '..');
const PRODUCTION_ENV_FILE = path.join(ROOT, '.env.production');
const SEQUELIZE_CLI = path.join(ROOT, 'node_modules/sequelize-cli/lib/sequelize');
const ALLOWED_COMMANDS = new Set(['db:migrate', 'db:migrate:status']);

// Thrown when a guard refuses to go on; the message says why.
class Refused extends Error {}

// Reads the variables from `envFile` only, checks they describe production,
// and returns them. Throws Refused with a clear reason otherwise.
function loadProductionEnv(envFile) {
  if (!fs.existsSync(envFile)) {
    throw new Refused(`${path.basename(envFile)} not found in ${path.dirname(envFile)}. Production migrations only run with that file.`);
  }
  const vars = util.parseEnv(fs.readFileSync(envFile, 'utf8'));
  if (vars.NODE_ENV !== 'production') {
    throw new Refused(`${path.basename(envFile)} must contain NODE_ENV=production. Nothing was run.`);
  }
  try {
    parseEnv(vars);
  } catch (err) {
    if (err instanceof EnvError) throw new Refused(`${err.message}\nNothing was run.`);
    throw err;
  }
  return vars;
}

// Runs one allowed sequelize-cli command against the database in `envFile`.
// Returns the exit code. `write` and `spawn` can be replaced in tests.
function migrateProduction({
  command,
  envFile = PRODUCTION_ENV_FILE,
  write = (text) => process.stdout.write(text),
  spawn = spawnSync,
}) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Refused(`Unknown command "${command}". Use one of: ${[...ALLOWED_COMMANDS].join(', ')}.`);
  }
  const vars = loadProductionEnv(envFile);

  write(`Production database: ${vars.DB_HOST}:${vars.DB_PORT || 3306}, database "${vars.DB_NAME}"\n`);
  write(`Running: sequelize-cli ${command}\n\n`);

  const result = spawn(process.execPath, [SEQUELIZE_CLI, command], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...vars },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

// Command-line use: `node scripts/migrate-production.js db:migrate`.
function main() {
  try {
    process.exitCode = migrateProduction({ command: process.argv[2] });
  } catch (err) {
    if (!(err instanceof Refused)) throw err;
    process.stderr.write(`Stopped: ${err.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { migrateProduction, loadProductionEnv, Refused };
