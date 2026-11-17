// Environment variables: checked once with Zod, so a missing or wrong setting
// stops the server at start-up with a clear message instead of failing later
// in the middle of a request. Messages name the variable, never its value,
// because values can be passwords.

const fs = require('node:fs');
const { z } = require('zod');

// The phone app's address while developing locally (Vite's default port).
// Allowed by CORS and the Origin check only when NODE_ENV=development.
const DEV_CLIENT_ORIGIN = 'http://localhost:5173';

// Variables where an empty value is meaningful (a local MySQL user may have
// no password). Every other empty value is treated as missing.
const EMPTY_ALLOWED = new Set(['DB_PASSWORD']);

// The shape of every variable the server reads. Later tasks add their own
// (SENTRY_DSN in BE17).
const shape = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  // The database's CA certificate, given in ONE of two ways: a path to the
  // file (DB_SSL_CA_PATH, e.g. a Render Secret File), or the certificate's
  // text itself (DB_SSL_CA). Either way it never goes into GitHub.
  DB_SSL_CA_PATH: z.string().optional(),
  DB_SSL_CA: z
    .string()
    .optional()
    // A one-line value with literal "\n" (how some dashboards store it) is
    // turned back into the real multi-line certificate.
    .transform((value) => value?.replace(/\\n/g, '\n').trim()),

  // Kept as an origin (scheme + host + port, no path or trailing slash),
  // because that's exactly what browsers send in the Origin header.
  CLIENT_URL: z.url().transform((value) => new URL(value).origin),

  TRUST_PROXY: z.coerce.number().int().min(0).max(10).optional(),

  // Signs the session cookie. Anyone who knows it could make their own
  // sign-ins, so production refuses one shorter than 32 characters.
  JWT_SECRET: z.string(),

  // The app's address used in email links (/confirm-email, /reset-password).
  // Normally the same as CLIENT_URL; defaults to it outside production.
  APP_URL: z.url().transform((value) => value.replace(/\/+$/, '')).optional(),

  // Brevo's HTTPS API (production only; development prints emails, tests keep them).
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.email().optional(),
  EMAIL_FROM_NAME: z.string().optional(),

  // Product photos (BE6.5): where the files are kept. Defaults: r2 in
  // production (the only choice there), disk in development, memory in tests.
  PHOTO_STORAGE: z.enum(['r2', 'disk', 'memory']).optional(),
  PHOTO_DISK_PATH: z.string().default('.photos'), // development's folder (Git-ignored)
  // Cloudflare R2 (required in production): the account, an API token's key
  // pair limited to Object Read & Write on this ONE bucket, and the bucket.
  R2_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'must be the 32-character account ID').optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be a bucket name (lower case, digits, hyphens)').optional(),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
  LOG_PROXY_CHAIN: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
};

// Where photos are kept when PHOTO_STORAGE isn't set.
function defaultPhotoStorage(nodeEnv) {
  return { production: 'r2', development: 'disk', test: 'memory' }[nodeEnv];
}

// The same shape plus the rules that depend on more than one variable.
const schema = z
  .object(shape)
  .superRefine((env, ctx) => {
    // Production must use SSL to the hosted database, with its CA certificate
    // given exactly one way (two would leave it unclear which one is used).
    if (env.NODE_ENV === 'production' && !env.DB_SSL_CA_PATH && !env.DB_SSL_CA) {
      ctx.addIssue({ code: 'custom', path: ['DB_SSL_CA_PATH'], message: 'or DB_SSL_CA is required in production' });
    }
    if (env.DB_SSL_CA_PATH && env.DB_SSL_CA) {
      ctx.addIssue({ code: 'custom', path: ['DB_SSL_CA'], message: 'and DB_SSL_CA_PATH are both set; use only one' });
    }
    if (env.DB_SSL_CA && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(env.DB_SSL_CA)) {
      ctx.addIssue({ code: 'custom', path: ['DB_SSL_CA'], message: 'is not a PEM certificate (it must start with -----BEGIN CERTIFICATE-----)' });
    }
    if (env.DB_SSL_CA_PATH && !fs.existsSync(env.DB_SSL_CA_PATH)) {
      ctx.addIssue({ code: 'custom', path: ['DB_SSL_CA_PATH'], message: 'points to a file that does not exist' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.JWT_SECRET.length < 32) {
        ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'must be at least 32 characters in production' });
      }
      for (const name of ['APP_URL', 'EMAIL_API_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME']) {
        if (!env[name]) ctx.addIssue({ code: 'custom', path: [name], message: 'is required in production' });
      }
    }
    // (The photo-storage rules are checked in parseEnv, photoStorageProblems,
    // so migrations can skip them.)
    // In production the proxy hop count must be a conscious choice (checked in
    // BE1 Part B), otherwise rate limits could lump every phone together.
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'is required in production' });
    }
  });

// Photos (BE6.5): production keeps them only in R2 and needs all four R2
// values, so the SERVER refuses to start without them rather than fail on the
// first upload. Returns one problem line per missing value. Kept out of the
// schema so the migration tools can skip it (they never touch photos, and the
// production R2 secret then stays in Render only): see parseEnv's
// `skipPhotoStorage`.
function photoStorageProblems(env) {
  const problems = [];
  const photoStorage = env.PHOTO_STORAGE ?? defaultPhotoStorage(env.NODE_ENV);
  if (env.NODE_ENV === 'production' && photoStorage !== 'r2') problems.push('PHOTO_STORAGE must be r2 in production');
  if (photoStorage === 'r2') {
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) {
      if (!env[name]) problems.push(`${name} ${env.NODE_ENV === 'production' ? 'is required in production' : 'is required when PHOTO_STORAGE=r2'}`);
    }
  }
  return problems;
}

// Thrown when the environment is invalid; `problems` lists one line per variable.
class EnvError extends Error {
  constructor(problems) {
    super(`Invalid environment variables:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSee .env.example for what each one holds.`);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

// Checks a set of variables (normally process.env) and returns a frozen config
// object, or throws EnvError. Pure, so tests can pass their own variables.
// `skipPhotoStorage: true` is ONLY for the migration tools (sequelize-cli's
// settings and the production migration script): every other check still
// applies. The server never passes it.
function parseEnv(source, { skipPhotoStorage = false } = {}) {
  const input = {};
  for (const key of Object.keys(shape)) {
    const value = source[key];
    input[key] = value === '' && !EMPTY_ALLOWED.has(key) ? undefined : value;
  }

  const result = schema.safeParse(input);
  const problems = result.success ? [] : result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(environment)';
    if (input[name] === undefined && issue.code !== 'custom') return `${name} is missing`;
    return `${name} ${issue.code === 'custom' ? issue.message : `has an invalid value (${issue.message})`}`;
  });
  if (!skipPhotoStorage) problems.push(...photoStorageProblems(input));
  if (problems.length > 0) throw new EnvError(problems);

  const env = result.data;
  return Object.freeze({
    ...env,
    TRUST_PROXY: env.TRUST_PROXY ?? 0,
    APP_URL: env.APP_URL ?? env.CLIENT_URL,
    PHOTO_STORAGE: env.PHOTO_STORAGE ?? defaultPhotoStorage(env.NODE_ENV),
    LOG_LEVEL: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
  });
}

let cached;

// Returns the config for this process, checking process.env the first time.
// Throws EnvError if it's invalid (entry points turn that into an exit).
function getConfig() {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

// For entry points (the server, the migration tool): print the problems and
// stop with exit code 1, so nothing runs with a half-valid configuration.
function getConfigOrExit() {
  try {
    return getConfig();
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

// For the migration tools only (sequelize-cli's settings): the same checks
// WITHOUT the photo-storage ones, since migrations never touch photos. Not
// cached, so it can never become the server's config.
function getMigrationConfigOrExit() {
  try {
    return parseEnv(process.env, { skipPhotoStorage: true });
  } catch (err) {
    if (!(err instanceof EnvError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseEnv, getConfig, getConfigOrExit, getMigrationConfigOrExit, EnvError, DEV_CLIENT_ORIGIN };
