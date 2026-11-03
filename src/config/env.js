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
// (JWT_SECRET and the email settings in BE2, SENTRY_DSN in BE17).
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

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
  LOG_PROXY_CHAIN: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
};

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
    // In production the proxy hop count must be a conscious choice (checked in
    // BE1 Part B), otherwise rate limits could lump every phone together.
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY === undefined) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'is required in production' });
    }
  });

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
function parseEnv(source) {
  const input = {};
  for (const key of Object.keys(shape)) {
    const value = source[key];
    input[key] = value === '' && !EMPTY_ALLOWED.has(key) ? undefined : value;
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(environment)';
      if (input[name] === undefined && issue.code !== 'custom') return `${name} is missing`;
      return `${name} ${issue.code === 'custom' ? issue.message : `has an invalid value (${issue.message})`}`;
    });
    throw new EnvError(problems);
  }

  const env = result.data;
  return Object.freeze({
    ...env,
    TRUST_PROXY: env.TRUST_PROXY ?? 0,
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

module.exports = { parseEnv, getConfig, getConfigOrExit, EnvError, DEV_CLIENT_ORIGIN };
