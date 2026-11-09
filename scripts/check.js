// Runs read-only consistency checks against the database in the loaded env
// file: `npm run check:sequences`, `npm run check:operations`, `npm run check:stock` (development,
// .env). Prints each problem found (IDs only, never personal data) and exits 1
// if there is any, 0 if everything is consistent. It changes nothing.
// Production: run by the project owner only, with their .env.production.

const { getSequelize, closeDatabase } = require('../src/db');
const { getConfigOrExit } = require('../src/config/env');
const { checkSequences, checkOperations } = require('../src/checks/syncChecks');
const { checkStock } = require('../src/checks/stockChecks');

const CHECKS = { sequences: checkSequences, operations: checkOperations, stock: checkStock };

// Runs the named check and reports.
async function main(name) {
  const check = CHECKS[name];
  if (!check) throw new Error(`Unknown check "${name}". Use one of: ${Object.keys(CHECKS).join(', ')}.`);
  getConfigOrExit();
  const problems = await check(getSequelize());
  if (problems.length === 0) {
    process.stdout.write(`check:${name}: OK, nothing wrong found\n`);
  } else {
    for (const p of problems) process.stdout.write(`${JSON.stringify(p)}\n`);
    process.stdout.write(`check:${name}: ${problems.length} problem(s) found (nothing was changed)\n`);
    process.exitCode = 1;
  }
}

main(process.argv[2])
  .catch((err) => { process.stderr.write(`${err.message}\n`); process.exitCode = 1; })
  .finally(() => closeDatabase());
