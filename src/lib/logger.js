// A small JSON logger (no library): one line of JSON per event, which Render's
// log viewer can search. Callers pass only safe fields (IDs, counts, status);
// as a second line of defence, keys that could carry secrets or personal data
// are replaced with "[removed]" before anything is written.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

// Keys never written to the logs, whatever a caller passes (compared in lower case).
const BLOCKED_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'passwordhash', 'pin',
  'token', 'tokenhash', 'authorization', 'cookie', 'cookies', 'set-cookie',
  'body', 'rawbody', 'headers', 'email', 'phone', 'secret', 'signature',
]);

// Copies `fields`, replacing blocked keys (at any depth) so a careless call
// can't print a password, token, cookie, body, email or phone number.
function scrub(fields, depth = 0) {
  if (fields === null || typeof fields !== 'object' || depth > 4) return fields;
  if (Array.isArray(fields)) return fields.map((item) => scrub(item, depth + 1));
  const clean = {};
  for (const [key, value] of Object.entries(fields)) {
    clean[key] = BLOCKED_KEYS.has(key.toLowerCase()) ? '[removed]' : scrub(value, depth + 1);
  }
  return clean;
}

// Describes an unexpected error for the logs without leaking data. Database
// errors' messages and SQL can contain the values being saved (a customer's
// phone number, for example), so for those only the error's name, code and
// stack frames are kept, never the message or the SQL.
function describeError(err) {
  if (!(err instanceof Error)) return { errorName: typeof err };
  const isDatabaseError = err.name?.startsWith('Sequelize') || 'sql' in err || 'sqlMessage' in err;
  const frames = (err.stack ?? '').split('\n').slice(1).map((line) => line.trim()).slice(0, 15);
  const description = { errorName: err.name, stack: frames };
  const code = err.original?.code ?? err.code;
  if (code) description.errorCode = String(code);
  if (!isDatabaseError) description.errorMessage = err.message;
  return description;
}

// Makes a logger writing at or above `level`. `write` receives each finished
// line; it defaults to standard output (tests pass their own to inspect lines).
function createLogger({ level = 'info', write = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  // Writes one JSON line: time, level, a short event name, then the fields.
  function log(lineLevel, event, fields = {}) {
    if (LEVELS[lineLevel] < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lineLevel, event, ...scrub(fields) }));
  }

  return {
    debug: (event, fields) => log('debug', event, fields),
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
}

module.exports = { createLogger, describeError, scrub };
