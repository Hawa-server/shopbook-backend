// Work done after the response has been sent (forgot password looks up the
// account and sends the email after answering, so neither the answer nor its
// timing shows whether the account exists). Every error is caught and logged
// here: a failure in background work can never crash the server.

const { describeError } = require('./logger');

// Makes a runner. `run(name, fn)` starts fn without waiting for it; `idle()`
// resolves once everything started so far has finished (tests wait on it).
function createBackgroundRunner({ logger }) {
  const pending = new Set();

  function run(name, fn) {
    const task = Promise.resolve()
      .then(fn)
      .catch((err) => logger.error('background_task_failed', { task: name, ...describeError(err) }))
      .finally(() => pending.delete(task));
    pending.add(task);
  }

  async function idle() {
    while (pending.size > 0) await Promise.all([...pending]);
  }

  return { run, idle };
}

module.exports = { createBackgroundRunner };
