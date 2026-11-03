// A small rate limiter written in the project (no library). It counts hits per
// key (an IP address, a login, a user) in fixed time windows and refuses with
// 429 RATE_LIMITED once a key goes over its limit.
//
// Known limit (written in the README): counts live in this process's memory.
// That's correct while the API runs as ONE Render instance; a restart resets
// them. Before running more than one instance, move the counts to a MySQL
// table (RateLimitHit) so every instance shares them.

const { AppError } = require('./errors');

// Makes a limiter allowing `max` hits per key in each `windowMs` window.
// `now` can be replaced in tests to move time forward without waiting.
function createRateLimiter({ name, windowMs, max, now = Date.now }) {
  const windows = new Map(); // key -> { count, resetAt }

  // Removes finished windows so memory doesn't grow with every IP ever seen.
  // unref() lets the process (and Jest) exit even though the timer exists.
  const cleanup = setInterval(() => {
    const time = now();
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
  }, Math.max(windowMs, 1000));
  cleanup.unref();

  // Counts one hit for `key`. Answers whether it's allowed and, if not, how
  // many seconds until the window ends (sent as Retry-After). Exposed so
  // routes can count keys that only exist after reading the body (a login).
  function consume(key) {
    const time = now();
    let window = windows.get(key);
    if (!window || window.resetAt <= time) {
      window = { count: 0, resetAt: time + windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    const allowed = window.count <= max;
    return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil((window.resetAt - time) / 1000) };
  }

  // Express middleware: counts a hit for the key `keyFn(req)` returns (no key
  // = not counted) and refuses the request when that key is over the limit.
  function middleware(keyFn = (req) => req.ip) {
    return function rateLimit(req, res, next) {
      const key = keyFn(req);
      if (key === undefined || key === null) return next();
      const { allowed, retryAfterSeconds } = consume(`${name}:${key}`);
      if (allowed) return next();
      res.set('Retry-After', String(retryAfterSeconds));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.'));
    };
  }

  // Forgets every count (used by tests, and by nothing in production).
  function reset() {
    windows.clear();
  }

  // Stops the cleanup timer (tests that create many limiters).
  function stop() {
    clearInterval(cleanup);
  }

  return { consume, middleware, reset, stop };
}

module.exports = { createRateLimiter };
