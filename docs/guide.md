# Shop Book server: a plain-language guide

Explanations for studying the server, written as each task is built. The exact contract is in `api.md`; this file explains the **why**.

---

## BE1 Part A: the foundations

### What happens to every request

Every request passes through the same steps, in this order (`src/app.js`):

1. **A request ID** (`requestId.js`). The server gives the request its own random ID (a UUID) and sends it back in the `X-Request-Id` header. Every log line for that request carries it. When something breaks, the trader's Help message includes the ID, so the developer can find the exact request in the logs **without seeing anyone's records**. An ID sent by the phone is ignored, so nobody can make their requests look like someone else's.
2. **A log line** (`requestLog.js`), written when the answer has been sent: time, ID, method, path, status, how long it took. Never the body, the cookies, the headers or the query string, because those can hold passwords, tokens, phone numbers and emails. As a safety net, the logger itself replaces keys such as `password`, `token`, `cookie`, `email` and `phone` with `[removed]` (`logger.js`).
3. **Security headers** (`securityHeaders.js`): small instructions to the browser that close known doors (don't guess file types, don't show the API inside another site's frame, don't pass addresses to other sites, use HTTPS only, don't cache business data).
4. **CORS** (`cors.js`): tells browsers which websites may **read** the API's answers: only the phone app's address.
5. **Reading the body**, at most 1 MB. The exact bytes are kept too (`req.rawBody`): from BE5, each phone signs its requests, and the signature covers these bytes exactly as sent.
6. **The CSRF check** (`csrf.js`), explained below.
7. **The route** itself (from the route registry, `src/routes/index.js`).
8. **Not found / the error handler** (`errorHandler.js`): anything that went wrong becomes the one error format.

### Why the environment is checked at start-up

The server reads its settings (database address, the app's address…) from environment variables. If one were missing, the server might start and then fail on the first sale, which is much worse than not starting. So `src/config/env.js` checks them all with Zod **before anything else** and stops with a list like:

```text
Invalid environment variables:
  - DB_HOST is missing
  - CLIENT_URL has an invalid value (Invalid URL)
See .env.example for what each one holds.
```

It names the variable but **never prints its value**, because the value could be a password. Production has extra rules: the database must use SSL (`DB_SSL_CA_PATH`), and the number of proxies (`TRUST_PROXY`) must be set on purpose.

### The error format

Every error the app receives looks the same: `{ "error": { "code", "message", "fields"? } }`. The **code** is what the app acts on (`RATE_LIMITED` means wait, `INTERNAL_ERROR` means keep the records and retry). The message is plain words for people.

An **unexpected** error (a bug, or the database going away) never shows its details: those could include SQL or a customer's phone number. The app gets "Something went wrong. Reference: …" with the request ID, and the details go to the server's log under the same ID. Even in the log, a database error's message and SQL are left out (they can contain the values being saved); only its type, code and where in the code it happened are kept.

### CSRF, in layers (and why CORS isn't enough)

**CSRF** (cross-site request forgery) is when another website makes your browser send a request to Shop Book, with your sign-in cookie attached, that you never meant to send ("record a repayment"). Three layers stop it:

1. From BE2 the session cookie is `SameSite=Lax`: browsers don't attach it to most requests started by other sites.
2. Every request that changes something (`POST`, `PUT`, `PATCH`, `DELETE`) must carry `X-Requested-With: XMLHttpRequest`. An ordinary form on another website can't add custom headers. A script on another website could only add it after asking the browser's permission through CORS, and our CORS rules refuse every site except the app.
3. If the browser says where the request came from (`Origin`), it must be the app's address. The account endpoints (sign-in, sign-up, password reset; from BE2) go further and **require** the `Origin`. Only in development may it be missing, so Postman works on your laptop.

**Why CORS isn't the protection:** CORS only controls whether another site can **read** the answer. It doesn't stop the request from being **sent**, and a request that's sent can already have changed something. That's why the header and Origin checks exist.

### Trust proxy: whose address is it?

In production a phone's request goes phone → Vercel (the app's rewrite of `/api`) → Render's router → our server. Each proxy adds the address it received the request from to the `X-Forwarded-For` header. Without being told, Express would see only the last proxy's address, and the rate limits would count **every phone as one**. `TRUST_PROXY` says how many proxies to trust, so `req.ip` is the phone's own address. It must not be **too high** either: then a phone could put a fake address in `X-Forwarded-For` and escape the limits. That's why the number is measured in BE1 Part B (with `LOG_PROXY_CHAIN=true` for one test) rather than guessed.

### Rate limits

`src/lib/rateLimiter.js` counts requests per key (an IP address, a login, a user) in fixed windows, for example "10 sign-ins per 15 minutes", and answers `429 RATE_LIMITED` with `Retry-After` when a key goes over. The counts live in the server's memory. That's fine while there's **one** server instance, but a restart resets them, and two instances wouldn't share them. Before running more than one, the counts move to a MySQL table. The limiter is ready now; the routes that use it arrive in BE2 (sign-in, sign-up, password reset) and BE5 (sync, devices).

### Health

`GET /api/health` answers only `{ status, database, version }`, with `ok` or `down`. It answers **200** when MySQL replies and **503** when it doesn't, so a monitoring tool sees the problem from the status code alone. It never says *why* the database is down (no hostnames or error messages), because anyone can call it. The phone app calls it when it opens, partly to wake the free Render server, which sleeps after 15 minutes.

### The route registry and `check:api-docs`

The phone app is built in a separate project that can only read `docs/api.md`. If an endpoint existed but wasn't in `api.md`, or `api.md` described one that didn't exist, the app would be built wrong. So every route is declared in one table (`src/routes/index.js`), and `npm run check:api-docs` (part of `npm test`) compares that table with the `### METHOD /path` headings in `api.md`, failing if either side is missing something.

### Shutting down cleanly

When Render restarts or stops the service, it sends a `SIGTERM` signal. The server then stops accepting new connections, lets requests in progress finish (a sale being saved, for example), closes the database connections and exits (`src/server.js`). If that takes more than 10 seconds, it exits anyway.

---

## BE1 Part B: ready for production

### The database's certificate (SSL)

On Aiven the database is on the internet, so the connection is encrypted (SSL). Encryption alone isn't enough: the server must also know it's talking to **the real** database and not something pretending to be it. Aiven gives a **CA certificate** (`ca.pem`) that proves this, and the connection refuses any database whose certificate doesn't match (`rejectUnauthorized: true`).

The certificate isn't a password, but it belongs to your setup, so it never goes into GitHub. The server accepts it in one of two ways (`src/config/database.js`):

- **`DB_SSL_CA_PATH`**: a path to the file. On your laptop it's kept outside the project folder; on Render it can be a *Secret File*, which Render puts in `/etc/secrets/`.
- **`DB_SSL_CA`**: the certificate's text itself in an environment variable, in case Secret Files aren't available. Some dashboards keep a value on one line, so `\n` in the text is turned back into real line breaks.

Setting both is refused, so it's never unclear which certificate is used. Text that doesn't look like a certificate is refused at start-up too.

### Why production migrations have their own guarded script

A migration changes the shape of the database (new tables, new columns). Run against the wrong database, it could change something it shouldn't. `npm run db:migrate:production` (`scripts/migrate-production.js`) makes that hard to do by accident:

- it reads **only** `.env.production`, and stops if the file isn't there;
- it **doesn't** pass on the terminal's own variables, so a `DB_HOST` left over from another project can't redirect it;
- the file must say `NODE_ENV=production` and pass the full environment check (certificate, `TRUST_PROXY`), so a copied development file is refused;
- it prints the host and database name before it starts, so you see where it's going;
- it allows only two commands: apply migrations, and show their status. Undoing migrations on production is deliberately not offered; a mistake there is fixed by a new migration (fix forward).

### Measuring the proxies twice

`TRUST_PROXY` must match the real number of proxies in front of the server (see "Trust proxy" above). Right now a phone reaches Render **directly**, so that path is measured first. Once the app is on Vercel (FE1), requests also pass through Vercel's rewrite, one more hop, so the measurement is repeated then. The `onrender.com` address stays reachable directly as well, so the re-check also makes sure a direct request with a forged `X-Forwarded-For` can't choose its own `req.ip`.
