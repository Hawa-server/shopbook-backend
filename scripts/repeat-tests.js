// Runs one folder of Jest tests several times in a row (BE5.5): the sync
// torture test must pass EVERY time, not just once, because the failures it
// hunts for (races, lost answers, deadlocks) are about timing.
// Usage: node scripts/repeat-tests.js <times> <test folder>
// (npm run test:sync runs tests/torture three times.) Each run is a fresh
// Node process with --expose-gc, so the memory check can force a garbage
// collection, and with the TEST environment (.env.test), never .env.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Runs Jest once on `folder`; returns true if every test passed.
function runOnce(folder) {
  const jest = path.join(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js');
  const result = spawnSync(process.execPath, ['--expose-gc', '--env-file-if-exists=.env.test', jest, '--runInBand', folder], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  return result.status === 0;
}

// Runs the folder `times` times; stops at the first failing run.
function main() {
  const times = Number(process.argv[2]);
  const folder = process.argv[3];
  if (!Number.isInteger(times) || times < 1 || !folder) {
    console.error('Usage: node scripts/repeat-tests.js <times> <test folder>');
    process.exit(2);
  }
  for (let run = 1; run <= times; run += 1) {
    console.log(`\n=== ${folder}: run ${run} of ${times} ===`);
    if (!runOnce(folder)) {
      console.error(`\n${folder} FAILED on run ${run} of ${times}.`);
      process.exit(1);
    }
  }
  console.log(`\n${folder}: passed ${times} runs in a row.`);
}

main();
