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

---

## BE2: accounts

### The tables, and what the database itself guarantees

BE2's migration (`migrations/20261103100000-create-accounts.js`) creates six tables: `User`, `Business`, `BusinessSettings`, `Location`, `Membership` and `EmailToken`. Some rules are enforced by **MySQL itself**, so even a bug in the code can't break them:

- **One phone number, one account; one email, one account** (unique keys on `User.phone` and `User.email`).
- **Phone numbers are always stored as `+233XXXXXXXXX`**, and emails in lower case (`CHECK` constraints), so "024 123 4567" and "+233241234567" can never become two accounts.
- **One active owner per business.** `Membership` has a column MySQL works out by itself, `activeOwnerBusinessId`: the business's ID when the row is an *active owner*, otherwise empty. A unique key on it means a second active owner is impossible. Empty values don't clash, so any number of managers and associates are fine.
- **The business name is 1–60 characters, the receipt note at most 120** (`CHECK` on `BusinessSettings`). The name lives only in the settings row (there's no `Business.name`), so it's typed once at sign-up and changed in one place.
- **Every business table has a `(businessId, id)` unique key** from the start. From BE3/BE4, tables that point at each other use *composite* foreign keys on that pair, so a row can never point at another business's record.

### `runTransaction`: all or nothing

Sign-up writes five rows (user, business, settings, shop, membership) plus the email token. If the server stopped halfway, a business with no owner would be left behind. A **transaction** makes the writes one unit: they're all saved together, or none of them is.

`runTransaction(fn)` in `src/db.js` is the **only** place in the code that opens a transaction (a test scans the code to make sure). Two requests can block each other in the database (a *deadlock*); MySQL then cancels one transaction, which is safe because nothing of it was saved. `runTransaction` simply runs it again (up to 3 times, after a short random wait). If it still can't, the answer is `503 TRY_AGAIN`: temporary, try again later. In BE5, `runOperation` (for sync) is built on top of it.

### Passwords

- **Never stored**, only their **argon2id hash** (`src/lib/passwords.js`). A hash is one-way: you can check a password against it, but you can't get the password back. argon2id is deliberately slow and memory-hungry, so someone who stole the database couldn't try billions of guesses.
- **Rules:** at least 8 characters, at most 128 (long passphrases welcome), and not on the list of the most common passwords (`src/lib/common-passwords.txt`, a plain file you can add to).
- **Sign-in never reveals who has an account.** A wrong password, an unknown phone number and an unknown email all get exactly the same answer. When the account doesn't exist, the server still checks the password against a dummy hash, so even the *time* taken is the same.
- **Rate limits** stop guessing: 10 sign-in attempts per 15 minutes per login and per connection.

### Sessions: the cookie, 30 days and 90 days

After signing in, the phone holds a **cookie** with a signed token (a JWT) saying `{ userId, sessionVersion, issuedAt }` (`src/lib/session.js`). It's signed with `JWT_SECRET`: without the secret nobody can make or change one.

- **HTTP-only:** the app's own JavaScript can't read the cookie. If a malicious script ever got into the app, it still couldn't copy the sign-in.
- **30 days idle:** each signed-in request renews the cookie for 30 more days, so people who use the app daily stay signed in, offline included.
- **90 days absolute:** `issuedAt` is the moment of signing in and never moves. After 90 days the person signs in again, however active. A lost phone can't stay signed in forever.
- **`sessionVersion`** is a counter on the user in the database, checked on every request. Changing a password, phone number or email adds 1, so every other phone's cookie (with the old number) stops working at once. The phone that made the change gets a new cookie with the new number.
- Removing someone from a business (BE3) does **not** change `sessionVersion`: they lose that business only, not their other ones.

### Email links: one-time tokens

Confirming an email and resetting a password work by email link (`src/lib/tokens.js`):

1. The server makes 32 random bytes (the **token**), puts it in the link, and stores only its **SHA-256 hash**. A copy of the database is useless for opening links: you'd need the token itself, which exists only in the email.
2. When the link is used, the server hashes the token again and looks for that hash, unused and not expired.
3. It marks it used with one conditional update ("…where it isn't used yet"). If two requests race with the same link, only one of them changes the row, so the link works **exactly once**, without locking anything.
4. Asking for a new link makes the older ones unusable. Confirm links last 24 hours, reset links 30 minutes.

### Forgot password, without giving anything away

`POST /api/auth/forgot-password` **answers first**, always with the same sentence, and only then (in the background, `src/lib/background.js`) looks up the account and sends the email. So neither the words nor the response time show whether the account exists. A reset link goes only to a **confirmed** email: an unconfirmed address might belong to someone else. Every error in that background work is caught and logged, so it can never crash the server. Setting a new password ends **every** sign-in, on every phone.

### Emails: sent after saving, never lost

The email adapter (`src/lib/email.js`) sends through Brevo's HTTPS API in production, prints the whole email (link included) in the terminal in development, and keeps it in memory in tests. In production the log gets only the template's name and the user's ID, never the address or link.

Emails are sent **after** the database change is saved. If sending fails, nothing is undone. Sign-up and change-email still succeed and say `emailSent: false`, and the person taps **Send the link again** (that endpoint answers `502 EMAIL_NOT_SENT` when it fails, because sending is its whole job).

### Changing your email safely

A new email is kept as **pending** until its link is tapped; the old one keeps working until then. A notice goes to the old address, with the new one partly hidden (`ne***@example.com`), so someone whose account was taken over finds out. If another account takes the address before the link is tapped, confirming is refused and nothing changes.

### Terms

The privacy notice and terms are Markdown files in `legal/` (English and Twi; the Twi files are placeholders until translated). Sign-up records the version accepted and when. If the version ever goes up, people who accepted an older one get `403 TERMS_REQUIRED` on most endpoints until they accept the new one; `me`, sign-out, accept-terms, change-password and the language setting still work, so the app can get them there.
