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

---

## BE3: the team

### Which business? `X-Business` and `requireAuth`

One person can belong to several businesses: their own shop, its practice shop, and maybe another shop they work in. So every business request says which business it's for with the `X-Business` header, and the header is **required**. A missing one is answered `400 BUSINESS_REQUIRED`, so a bug in the app can never quietly land a record in the wrong shop.

`requireAuth` (`src/middleware/requireAuth.js`) then looks up the person's membership **in the database, on every request**:

- no membership in that business (or just an invitation not yet accepted) → **404**, exactly like a business that doesn't exist, so nobody can find out which businesses exist;
- a membership the owner ended → **403 `ACCESS_REMOVED`**, and the phone wipes that business's data;
- the business is closing → **403 `BUSINESS_CLOSING`**;
- a temporary password not yet replaced → **403 `PASSWORD_CHANGE_REQUIRED`**; terms not accepted → **403 `TERMS_REQUIRED`**.

Then `requireRole('owner')` checks the role it just read. The phone's own idea of its role is never trusted: if the owner changes someone's role, it counts on their very next request.

### Removing someone without signing them out everywhere

Removing a member ends their membership in **this** business only (`removedAt` is set). Their `sessionVersion` doesn't change, so they stay signed in and keep working in their other businesses (ADR-19). Their next request to this business is refused, because `requireAuth` re-reads the membership every time. Nothing they recorded is changed. From BE5, their phones for this business are revoked in the same step.

### Temporary passwords

When the owner adds someone new, the server makes a **temporary password** like `k7m4p-q2xnr`: 10 random characters, lower case, without look-alikes (no 0/o, 1/l/i), so it's easy to read out and type on a phone. It appears **once**, in that one answer, which is never cached. The database keeps only its argon2id hash, and it never appears in the logs or in the ChangeLog. The person must choose their own password at their first sign-in (`mustChangePassword`), then accept the terms.

### Invitations: why an existing account isn't "added"

If the phone number already has a Shop Book account (someone who also works in another shop), the owner **can't** be allowed to set its password, or one owner could take over a person's access to another business. So instead:

- the server creates an **invitation** (a membership waiting to be accepted); the account itself isn't touched;
- the owner sees only the **name and number they typed** and "Waiting for them to accept", never the account's real name or email;
- the answer has the same fields as for a new person, only without a temporary password;
- the person sees the invitation in `GET /api/auth/me` at their next sign-in and accepts or declines it. Only they can answer it.

### Resetting a staff member's password, safely

A staff member with no confirmed email who forgets their password asks the owner, who gets a new temporary password for them (all their sign-ins end). If that person **also belongs to another business**, the reset is refused (`RESET_NOT_ALLOWED`): a password works everywhere, so one owner must never be able to set it. They use **Forgot password** by email instead, or ask for help.

### The ChangeLog

Every team change (adding or inviting, accepting, declining, a role change, a password reset, a removal) adds a row to `ChangeLog` **in the same transaction** as the change: who, when, and what it was before and after. Because it's the same transaction, the history can never miss a change or show one that didn't happen. Rows are only ever added. From BE5 the same table records every edit of products, customers and settings.

### The database's state rule for memberships

A membership can only be in one of three states, enforced by a `CHECK` in MySQL: **active**; **invited** (not active, not ended, with an invitation time); **ended** (removed, or declined). An owner can never be an invitation, and the one-active-owner key from BE2 still applies.

---

## BE4: keeping businesses apart

Every shop's records are private: no other business, not even the neighbour, may see or change them. That's protected in **three layers**, so one mistake is never enough to break it.

### Layer 1: `requireAuth` chooses the business from the database

As in BE3: the business comes from the person's own memberships, read from the database on every request, never from what the phone claims.

### Layer 2: `scoped()`, the only way handlers touch business tables

`src/services/scoped.js` gives each business table five methods: `findOne`, `findAll`, `count`, `create` and `update`. Every one of them adds `businessId = <the request's business>` by itself:

```js
const s = scoped(req, models);
await s.Membership.findOne({ where: { id: membershipId } });
// really runs: WHERE id = … AND businessId = <this business>
```

- A query that tries to set its own `businessId` is refused (a bug, answered as a 500).
- `create` sets `businessId` itself; `update` needs a `where` and can never change `businessId`.
- There's **no `destroy`**: business records are only ever deleted by `deleteBusinessData`.
- `update` refuses **permanent records** (sales, repayments… as they arrive), which are never changed.

**Another business's ID is answered exactly like an ID that doesn't exist** (404, same words): a scoped search simply finds nothing. So nobody can even learn that a record exists in someone else's shop.

A test reads the code and fails if any file in `src/routes/` touches a business table directly or runs SQL itself. The few places that genuinely work across businesses (creating a business at sign-up, a person's own memberships and invitations, the "do they belong elsewhere?" check before a reset) live in `src/services/`, each with a comment saying why.

### Layer 3: the database refuses cross-business links (composite foreign keys)

Every business table has a unique key on `(businessId, id)`. When one business table points at another, it does so with **both** columns:

```sql
-- in the migration of a table that points at a product (e.g. SaleItem, BE8):
CONSTRAINT fk_saleitem_product FOREIGN KEY (businessId, productId)
  REFERENCES Product (businessId, id)
```

Now a sale line of business A pointing at a product of business B is impossible: the pair `(A, B's product)` doesn't exist in `Product`, so MySQL refuses the row, even if the code had a bug. **Every later migration follows this pattern** for references between business tables.

The first two (BE4):

- `ChangeLog (businessId, changedBy)` → `Membership (businessId, userId)`: a change in A can only be recorded as made by someone with a membership in A.
- `BusinessSettings (businessId, updatedBy)` → `Membership (businessId, userId)`: settings can only be marked as edited by a member of that business.

**NULL means "a system change".** `changedBy` and `updatedBy` may be empty when no person made the change (later scheduled jobs, BE13 and BE15). MySQL skips a foreign key check when one of its columns is NULL, so such rows are accepted; a test checks it.

### Proving it: `npm run test:isolation`

`tests/isolation/isolation.test.js` builds two businesses, A and B, each with an owner, a staff member, an invitation and a removed member, then:

- tries **every business endpoint** with B's IDs while working in A, and checks the answer is identical to a made-up ID (404) and that B's records didn't change;
- sends `X-Business: B` from A's people (404 everywhere);
- tries to answer B's invitations from A (404);
- inserts rows **straight in MySQL** that would link A to B's people, and checks the database refuses them.

It also **refuses to pass** if a route is marked `business: true` without a case, and another test refuses any route Express has that isn't marked `business: true` or `false`. So every later task must add its own isolation cases, or the build fails.

### Deleting: only two places

Only `deleteBusinessData` (BE15/BE16) deletes business records. The one other kind of delete is **housekeeping** of short-lived technical rows (expired nonces from BE5), and only those listed in `src/services/housekeeping.js`. That list is empty now, and a test pins it, so adding anything needs the owner's OK.

---

## BE4.5: international-ready, Ghana first

Shop Book is built so a business in another country could use it (Decision F-27), but **only Ghana is offered** until another country's legal texts, payment methods and translations are ready. So the code never assumes Ghana; it reads it from the business or from the reference tables.

### The reference tables (`src/locale/`)

Plain data, changed only by a code change with tests:

- **Countries** (launch: GH): dialling code `233`, trunk prefix `0`, 9-digit national numbers with the mobile prefixes, currency GHS, time zone `Africa/Accra`, payment methods cash and mobile money (shown "MoMo"), default language English.
- **Currencies** (launch: GHS): `minorUnits` 2 (pesewas), the symbol `GH₵`, and exactly how to write an amount.
- **Languages** (launch: `en` complete, `tw` draft): anything not translated falls back to English.
- **Payment methods:** `cash`, `mobile_money`.

The phone gets them from `GET /api/reference`.

### Money in minor units, written the same everywhere

Money is always a **whole number of the currency's smallest unit** (pesewas for GHS), in fields ending in `Minor`. Never decimals: `0.1 + 0.2` isn't exactly `0.3` in floating point, and a shop's money must never drift. How many decimals to show comes from the currency table.

`src/locale/money.js` writes an amount using only integer arithmetic: `120050` → "GH₵ 1,200.50", with a **non-breaking space** after the symbol so it never wraps onto two lines. The phone app writes amounts with the same rules (not the browser's `Intl.NumberFormat`, which can differ from one phone to another), so a receipt says exactly the same thing on every phone and on the server.

### Phone numbers in E.164

Every phone number is stored as **E.164**: `+`, the country code, then the number (`+233241234567`). A number typed in local form (`024 123 4567`) is read using a country: the business's country, or the one chosen on the sign-in screen (Ghana by default). The database refuses anything that isn't E.164. One form means one account per number, and WhatsApp links work.

### Each business's country, currency and time zone

A business gets its country at sign-up (Ghana by default), and with it its currency, time zone and payment methods. **Business days use the business's own time zone**, so "today" means the shop's today.

These three are **locked once money has been recorded** (`Business.moneyRecordedAt`, set by the first sale, repayment, debt brought forward, write-off or expense from BE8 on). Changing the currency afterwards would make every stored amount mean something else, and changing the time zone would move past sales to different days. Before that, the owner can change them (`PATCH /api/business/locale`); after it, the answer is `409 CURRENCY_LOCKED`.

### Payment methods per business

Each business lists the methods it uses (`paymentMethods`: cash and mobile money in Ghana). From BE8 a payment code that doesn't exist at all is refused (`PAYMENT_METHOD_UNKNOWN`), but a real method the owner has switched off since is **saved and flagged** `methodDisabled` (decided 9 Nov 2026): the money was really taken. The sale rules don't change: what was paid is the sum of the payments, whatever their method. Day closes (BE12) check **each method separately**: the drawer for cash, the MoMo balance for mobile money.

### The migration

`migrations/20261107100000-international.js` turned the existing data international without changing its meaning: every existing business became Ghana, GHS and Africa/Accra with cash and mobile money; languages became open tags (values kept); the phone rule became E.164 (existing `+233…` numbers already fit); `defaultCreditLimitPesewas` became `defaultCreditLimitMinor`.

---

# The phone app

Explanations for studying the app (the frontend project), written as each FE task is built.

---

## FE1: setup and app shell

### What the pieces are

- **Vite** builds the app: it turns the React files in `src/` into a few small files in `dist/` that phones download. `npm run dev` runs it on your computer with instant reloads.
- **React** draws the screens; **React Router** decides which screen an address shows (`/sell`, `/customers`, `/stock`, `/today`, `/more`).
- **Tailwind** styles them with short class names (`bg-primary`, `text-title`). The colours and sizes from `docs/design.md` are defined **once** in `src/index.css` as CSS variables, so no component contains a colour code, and a design change is made in one place.
- **Dexie** is a friendly layer over the phone's built-in database (IndexedDB). FE1 only declares the tables; later tasks fill them.

### Why the app works with no network

The app is a **PWA** (installable web app). `vite-plugin-pwa` writes a **service worker**: a small script the browser keeps that saves the app's own files the first time it opens. After that the app opens from those saved files, even in airplane mode. It **never** saves answers from `/api`: those must always come fresh from the server.

When a new version is published, the service worker downloads it quietly and the app says **"A new version is ready"** with **Update now** and **Later**. It never reloads by itself, and refuses while something is being entered (`src/lib/unsavedInput.js`), so an update can't wipe out a sale halfway through.

### One door to the server

Every request goes through `src/api/client.js`. It always calls `/api/...` on the app's **own** address, never the server's. Locally, Vite's proxy passes `/api` on to your backend; in production, `vercel.json` passes it to Render. Because the browser thinks it's talking to one site, the session cookie works simply, and the security policy can say "talk only to yourself" (`connect-src 'self'`).

The helper never throws for a network or server problem; it returns a result, and `src/api/errors.js` decides what that means, straight from the table in `api.md`. The most important rule there: **no answer, a timeout, or a 5xx is always temporary.** Treating one of those as "rejected" could lose a trader's record; retrying never can.

### The sleeping server

The free server sleeps when unused and can take up to a minute to wake. So when the app opens, it calls `/api/health` in the background (`src/api/health.js`): that wakes the server, and the header shows **"Connecting…"** meanwhile. Requests wait up to 60 seconds. Nothing on the phone waits for it.

### Money without floating point

Computers store numbers like 0.29 inexactly: `0.29 * 100` gives `28.999999999999996`. For money that's unacceptable, so the app never does that. Amounts are whole **minor units** (pesewas for the cedi), and `src/lib/money.js` reads typed amounts **by their digits**: "120.5" becomes the digits "120" and "50", joined into 12050. Formatting goes the other way, also with digits. The tests (`money.test.js`) include the classic traps (0.29, 1.15, 4.35). Quantities work the same way: yards are stored as **half-yard units** (5 = "2.5 yards").

Amounts are shown with a **non-breaking space** after the symbol, so "GH₵ 1,000.00" can never be split over two lines.

### Languages: one list of words per language

All the app's words are in `src/i18n/en.js` and `src/i18n/tw.js`, under the same keys. Screens ask for `t('nav.sell')`, never type words themselves. The chosen language is saved in the phone's `shopbook-app` database, so switching it changes every screen at once and survives closing the app. `npm run check:i18n` checks the dictionaries against each other, including that `{placeholders}` match (a Twi line missing `{n}` would drop a number from the screen).

The app's own name (**Ledga**) is in exactly one place, `app.name`; the install name and the page title read it at build time.

### Security headers (`vercel.json`)

- **Content-Security-Policy:** the browser may run scripts only from the app itself, and talk only to the app's own address. If someone ever slipped code into a page, it couldn't run or send data elsewhere. From FE3 this protects the phone's signing key.
- **Referrer-Policy: no-referrer:** password-reset links carry a token in the address; this stops the address being sent to any other site.
- **X-Frame-Options / frame-ancestors:** no other site can show the app inside a frame (to trick someone into tapping).
- **HSTS:** phones always use HTTPS for the app.

### The icons

The logo SVGs in `public/icons/` are turned into the PNG sizes Android needs by `npm run icons`, which uses Chrome on your computer. The **maskable** icon is a full green square with the drawing in the middle 70%, so Android's round mask never cuts it.

### Twi to check

Every Twi line in `src/i18n/tw.js` is a **draft written by Claude Code** and needs a Twi speaker's review before real traders use it (FE12). For FE1 that is **every key** in the file:

| Key | English | Draft Twi |
|---|---|---|
| `nav.main` | Main menu | Nhyehyɛe titiriw |
| `nav.sell` / `sell.title` | Sell | Tɔn |
| `nav.customers` / `customers.title` | Customers | Adetɔfoɔ |
| `nav.stock` / `stock.title` | Stock | Nneɛma |
| `nav.today` / `today.title` | Today | Ɛnnɛ |
| `nav.more` / `more.title` | More | Nkaeɛ |
| `common.back` | Back | San kɔ akyi |
| `sell.empty` | No products to sell yet. | Nneɛma biara nni hɔ a wobɛtɔn seesei. |
| `customers.empty` | No customers yet. | Adetɔfoɔ biara nni hɔ seesei. |
| `stock.empty` | No products in stock yet. | Nneɛma biara nni sotɔɔ no mu seesei. |
| `today.empty` | No sales today yet. | Wonntɔnee hwee ɛnnɛ seesei. |
| `language.title` | Language | Kasa |
| `language.en` | English | Borɔfo |
| `about.title` | App and server | App ne server |
| `about.appVersion` | App version | App no version |
| `about.serverVersion` | Server version | Server no version |
| `about.checkAgain` | Check again | Hwɛ bio |
| `server.connecting` / `sync.connecting` | Connecting… | Ɛrekɔ so ahyɛ ase… |
| `server.ok` | Working | Ɛreyɛ adwuma |
| `server.down` | Not working right now. Your records are safe on this phone. | Ɛnyɛ adwuma seesei. Wo nkrataa wɔ fon yi so dwoodwoo. |
| `server.unreachable` | Can't reach it right now. Your records are safe on this phone. | Yɛntumi nnu hɔ seesei. Wo nkrataa wɔ fon yi so dwoodwoo. |
| `server.offline` | No internet. Your records are safe on this phone. | Intanɛt nni hɔ. Wo nkrataa wɔ fon yi so dwoodwoo. |
| `sync.sending` | Sending… | Ɛremena… |
| `sync.notSentYet` | Not sent yet | Wɔmmɛmanee |
| `sync.notSentCount` | {n} not sent | {n} wɔmmɛmanee |
| `sync.allSent` | All sent | Wɔde ne nyinaa akɔ |
| `sync.needsAttention` | Needs attention | Ɛhia sɛ wohwɛ |
| `update.ready` | A new version is ready. | Version foforɔ wɔ hɔ. |
| `update.now` | Update now | Fa foforɔ no seesei |
| `update.later` | Later | Akyiri yi |
| `update.finishFirst` | Finish what you are entering first. The update will wait. | Wie deɛ wo kyerɛw no kane. Foforɔ no bɛtwɛn. |
| `update.offlineReady` | Ready to work without internet. | Ɛbɛtumi ayɛ adwuma a intanɛt nni hɔ. |

The words most likely to need a better choice: "Stock" (Nneɛma just means "things"), "More", "Connecting…", "Not sent yet", and whether traders would rather see English words like "server" and "version".

**Length matters too.** On a 360px phone with large text, tab labels have about 70px each: "Adetɔfoɔ" and "Nneɛma" then break mid-word onto a second line, and "Ɛrekɔ so ahyɛ ase…" wraps to four lines in the header. Nothing overlaps, but shorter words (one short word per tab, two or three for "Connecting…") will read better.

---

## BE5 Part A: phones and signed requests

### Why a phone needs its own key

A sign-in cookie proves "someone signed in as Ama". If it were ever copied off a phone, whoever has it could act as Ama from anywhere. So each phone also gets its **own key pair**, made on the phone by the browser (Web Crypto). The **private key can't be read out**, not even by the app's own code; it can only be asked to sign. The server keeps the **public key**, which can only check signatures.

Every business request is then **signed** (`src/lib/deviceSigning.js`). A copied cookie on another machine is useless: it has no key to sign with. A device ID on its own proves nothing either; only a valid signature does.

**Honest limit:** if malicious script ever ran *inside* the app, it could ask the browser to sign. The app's strict Content-Security-Policy (no outside scripts) is what prevents that.

### Registering a phone (enrolment)

This is the one moment a stolen cookie could be turned into a "trusted" phone, so it needs more than a sign-in:

1. **A challenge:** `POST /api/devices/challenge` gives 32 random bytes, valid 5 minutes, usable once (only their hash is stored, in `DeviceChallenge`).
2. **Proof of the key:** the phone signs the challenge with its new private key.
3. **The password:** `POST /api/devices` sends the public key, the signed challenge and the person's **current password**. The server checks all of it, then gives the phone its **device code** (3 characters such as `K7M`, from 29 letters and digits that can't be confused). Codes are never reused, not even after a phone is revoked, so receipt numbers like `K7M-0042` can never repeat.
4. The owner gets an email: "A new phone was added".

A device ID that already exists is refused (`DEVICE_ID_TAKEN`): a phone never swaps its key. A new key means a new device.

### What the server checks on every signed request (`requireDevice`)

The order is session → business (`requireAuth`) → **device** → role → handler:

1. **The device** must be this person's, in this business, and active. Anything else gets the same answer, `DEVICE_NOT_REGISTERED`, so nobody can probe someone else's phones.
2. **Not locked:** after 20 failed signatures in 15 minutes the phone is blocked for 15 minutes, and the owner sees it. Failures count **only** once the device is confirmed to be the person's own, so one member can't lock out another member's phone.
3. **The time** (`X-Signed-At`) must be within 5 minutes of the server's clock. Phones with a wrong clock still work: every answer carries `X-Server-Time`, and the phone signs with its clock **corrected** by the difference.
4. **The signature** covers the method, the exact path and query, the SHA-256 of the exact body bytes, the device, the business, the time and a nonce. Changing any of them after signing breaks it.
5. **The nonce** (16 random bytes) is saved in `DeviceRequestNonce` in its own short transaction, **before** the request's work. A unique key means two copies of the same request can't both pass, even at the same instant (`NONCE_REUSED`). Expired nonces of that phone are deleted on the same request: the one allowed "housekeeping" delete.

### Revoking a phone

The owner can revoke a lost or stolen phone (`DELETE /api/devices/:deviceId`). Its next request gets `DEVICE_REVOKED`, and the app wipes that business's data. Removing a member from the team revokes all their phones for that business in the same transaction.

### Trying signed endpoints yourself: `npm run dev:sign`

Postman can't sign with a key by itself, so `scripts/dev-sign.js` does it with a **throwaway test key** (kept in `.dev-device-key.json`, Git-ignored; the script refuses to run with `NODE_ENV=production`):

1. `npm run dev:sign -- new-key`
2. In Postman: `POST /api/devices/challenge` (signed in, `X-Business`), then `npm run dev:sign -- register-body --challenge <challenge>`. Paste the JSON into `POST /api/devices`, typing your password where it says so.
3. For each signed request: `npm run dev:sign -- headers --method GET --path /api/team --business <id>`, and copy the four headers into Postman. Each set works once and for 5 minutes.

---

## FE2: sign up, sign in, PIN

### Who is signed in, even offline

When someone signs in, the server's answer (`me`: the person, their businesses and roles, whether they accepted the terms) is saved in the phone's `shopbook-app` database (`src/auth/session.js`). That copy is what lets the app open **with no internet**, needing only the PIN. When the phone is online, the app asks the server again (`GET /api/auth/me`) on opening and on reconnecting, and replaces the copy.

The session itself is an HTTP-only cookie the app can't read. If the server says the session has ended (`401 NOT_SIGNED_IN`: 30 days unused, 90 days old, or the password changed elsewhere), the app **keeps everything** and only shows "Sign in again" above the tabs. Selling carries on.

### What happens after signing in, in order

`src/auth/nextStep.js` decides, from `me` and the phone's PIN record, which screen comes next: replace a temporary password → accept the current terms → answer invitations → "not part of any business" (if there's none) → **set a PIN** (required on each phone) → the PIN lock → the app. It's a small pure function with its own tests, so the order can't drift.

### The PIN

- A 4-digit PIN, set per person on each phone, **never sent anywhere**. Only a PBKDF2-SHA-256 hash is kept (random salt, 150,000 iterations; `src/crypto/pin.js`).
- A PIN has only 10,000 possibilities, so the hash alone wouldn't stop someone who copied the phone's storage. What protects it is the **5-tries rule**: each wrong PIN is counted on the phone *before* the screen reacts (closing the app can't reset it), and the fifth locks the app until the person signs in with their **password, online**. Then they choose a new PIN. Nothing on the phone is deleted.
- The lock comes back when the app opens and after **5 minutes in the background**.

### A different person on the same phone

If someone else signs in on a phone, the previous person's downloaded records (for an owner, cost prices and profit) must not be left for them to see. The rule (decided 6 Nov 2026): a different person may sign in **only when the previous person has nothing unsent**, with no way around it ("Ama has 3 records not sent. Connect to the internet to send them first."). Then the previous person's business data is removed; that removal arrives in FE3 with the sync engine.

### Email links and their tokens

Reset and confirm links carry a one-time token in the address. `src/lib/addressToken.js` takes it out **before the app even starts drawing** (`history.replaceState`), keeps it only in memory, and forgets it once used. So it never stays in the address bar, the history, or a screenshot.

### The privacy notice and terms, safely

The server sends them as Markdown. Instead of turning that into HTML (which could carry code), `src/lib/markdown.js` turns it into a plain tree of headings, paragraphs, lists, bold and italic, and React draws that tree as ordinary text. **Links are never clickable**: an `https:` address is shown after its words, and anything else (`javascript:`, `data:`…) is dropped. Tests prove no link can come out.

### Errors in words

`src/auth/formErrors.js` turns any failed request into words under the right field, or above the button, using only the error **code** from `api.md` (never the server's wording, which is English and may change). No internet, a timeout and a server error all say "try again"; a wrong login always says the same "Wrong phone number, email or password."

### Twi to check (FE2)

These lines were added in FE2. Like FE1's, they are drafts by Claude Code for a Twi speaker to check.

| Key | English | Draft Twi |
|---|---|---|
| `common.cancel` | Cancel | Gyae |
| `common.close` | Close | To mu |
| `common.save` | Save | Kora so |
| `common.wait` | Please wait… | Mesrɛ wo twɛn… |
| `field.show` | Show | Kyerɛ |
| `field.hide` | Hide | Fa sie |
| `role.owner` | owner | wura |
| `role.manager` | manager | ɔhwɛfoɔ |
| `role.associate` | sales associate | adetɔnfoɔ |
| `welcome.lead` | Your shop's sales, stock and debts, safe on your phone, even without internet. | Wo sotɔɔ no adetɔn, nneɛma ne ɛka, wɔ wo fon so dwoodwoo, mpo a intanɛt nni hɔ. |
| `welcome.signIn` | Sign in | Hyɛn mu |
| `welcome.createAccount` | Create a business account | Bue adwumayɛ akawnt |
| `signIn.title` | Sign in | Hyɛn mu |
| `signIn.againTitle` | Sign in again | Hyɛn mu bio |
| `signIn.login` | Phone number or email | Fon nɔma anaa email |
| `signIn.password` | Password | Ahintasɛm |
| `signIn.button` | Sign in | Hyɛn mu |
| `signIn.forgot` | Forgot password? | Wo werɛ afi wo ahintasɛm? |
| `signIn.reason.sessionEnded` | Your sign-in has ended. Sign in again to send your records. Everything on this phone is kept. | Wo hyɛn-mu no aba awieeɛ. Hyɛn mu bio na wo nkrataa nkɔ. Biribiara a ɛwɔ fon yi so wɔ hɔ. |
| `signIn.reason.forgotPin` | Sign in with your password, then choose a new PIN. | Fa wo ahintasɛm hyɛn mu, na afei paw PIN foforɔ. |
| `signIn.reason.lockedOut` | Sign in with your password, then choose a new PIN. | Fa wo ahintasɛm hyɛn mu, na afei paw PIN foforɔ. |
| `takeOver.blocked` | {name} has {n} records not sent. Connect to the internet to send them first. | {name} wɔ nkrataa {n} a wɔmmɛmanee. Fa intanɛt bɔ ho na fa kɔ kane. |
| `signUp.title` | Create account | Bue akawnt |
| `signUp.you` | You | Wo |
| `signUp.name` | Your name | Wo din |
| `signUp.phone` | Phone number | Fon nɔma |
| `signUp.phoneHint` | For example 024 123 4567 | Sɛ nhwɛsoɔ 024 123 4567 |
| `signUp.email` | Email | Email |
| `signUp.business` | Your business | Wo adwuma |
| `signUp.businessName` | Business name | Adwuma no din |
| `signUp.country` | Country | Ɔman |
| `signUp.passwordSection` | Password | Ahintasɛm |
| `signUp.password` | Choose a password | Paw ahintasɛm |
| `signUp.passwordHint` | At least 8 characters | Nkyerɛwdeɛ 8 anaa nea ɛboro saa |
| `signUp.termsSection` | Privacy and terms | Kokoam ne nhyehyɛeɛ |
| `signUp.readPrivacy` | Read the privacy notice | Kenkan kokoam nkra no |
| `signUp.readTerms` | Read the terms | Kenkan nhyehyɛeɛ no |
| `signUp.accept` | I accept the privacy notice and terms | Megye kokoam nkra ne nhyehyɛeɛ no tom |
| `signUp.button` | Create account | Bue akawnt |
| `legal.privacy` | Privacy notice | Kokoam nkra |
| `legal.terms` | Terms of use | Nhyehyɛeɛ |
| `forgot.title` | Forgot password | Wo werɛ afi ahintasɛm |
| `forgot.lead` | Type your phone number or email. If your email is confirmed, we will send you a link to choose a new password. | Kyerɛw wo fon nɔma anaa email. Sɛ wo email no ayɛ pi a, yɛbɛsoma link ama wo ma woapaw ahintasɛm foforɔ. |
| `forgot.button` | Send the link | Soma link no |
| `forgot.sent` | If that account has a confirmed email, we've sent a link. Check your inbox and spam. | Sɛ saa akawnt no wɔ email a ayɛ pi a, yɛasoma link. Hwɛ wo inbox ne spam. |
| `forgot.noEmail` | No email? Ask your shop owner to reset your password. | Wonni email? Ka kyerɛ wo sotɔɔ wura ma ɔnsesa wo ahintasɛm. |
| `forgot.backToSignIn` | Back to sign in | San kɔ hyɛn-mu |
| `reset.title` | New password | Ahintasɛm foforɔ |
| `reset.newPassword` | New password | Ahintasɛm foforɔ |
| `reset.again` | New password again | Ahintasɛm foforɔ no bio |
| `reset.button` | Save new password | Kora ahintasɛm foforɔ no |
| `reset.done` | Password changed. Sign in again. | Wɔasesa ahintasɛm no. Hyɛn mu bio. |
| `reset.signIn` | Sign in | Hyɛn mu |
| `reset.newLink` | Ask for a new link | Bisa link foforɔ |
| `confirm.title` | Confirm email | Si email so dua |
| `confirm.done` | Email confirmed. | Email no ayɛ pi. |
| `confirm.tryAgain` | Try again | San bɔ mmɔden |
| `confirm.continue` | Continue | Toa so |
| `ownPassword.title` | Choose your own password | Paw wo ankasa ahintasɛm |
| `ownPassword.lead` | Your shop owner gave you a temporary password. Choose your own now. | Wo sotɔɔ wura de ahintasɛm a ɛnnim kyɛ maa wo. Paw wo deɛ seesei. |
| `ownPassword.temporary` | Temporary password | Ahintasɛm a ɛnnim kyɛ |
| `ownPassword.button` | Save my password | Kora me ahintasɛm |
| `terms.title` | Privacy and terms | Kokoam ne nhyehyɛeɛ |
| `terms.lead` | Please read the privacy notice and the terms, then accept them to continue. | Mesrɛ wo kenkan kokoam nkra ne nhyehyɛeɛ no, na gye tom na toa so. |
| `terms.button` | Continue | Toa so |
| `invitations.title` | Invitations | Nsato |
| `invitations.text` | {business} invited you to join as {role}. | {business} to wo frɛ sɛ bɛyɛ {role}. |
| `invitations.accept` | Accept | Gye tom |
| `invitations.decline` | Decline | Mpene |
| `invitations.later` | Decide later | Akyiri yi |
| `noBusiness.text` | You're not part of any business any more. Ask a shop owner to add you. | Wonka adwuma biara ho bio. Ka kyerɛ sotɔɔ wura bi ma ɔmfa wo nka ho. |
| `session.ended` | Your sign-in has ended. Sign in again to send your records. | Wo hyɛn-mu no aba awieeɛ. Hyɛn mu bio na wo nkrataa nkɔ. |
| `session.signInAgain` | Sign in again | Hyɛn mu bio |
| `pin.setTitle` | Set your PIN | Hyɛ wo PIN |
| `pin.choose` | Choose a 4-digit PIN | Paw PIN a ɛyɛ nɔma 4 |
| `pin.again` | Type the same PIN again | Kyerɛw PIN no ara bio |
| `pin.mismatch` | The PINs didn't match. Choose your PIN again. | PIN abien no nyɛ pɛ. Paw wo PIN bio. |
| `pin.why` | The PIN opens the app on this phone, even without internet. | PIN no bue app no wɔ fon yi so, mpo a intanɛt nni hɔ. |
| `pin.lockTitle` | Enter your PIN | Kyerɛw wo PIN |
| `pin.enter` | Enter your 4-digit PIN | Kyerɛw wo PIN a ɛyɛ nɔma 4 |
| `pin.wrong` | Wrong PIN. {n} tries left. | PIN no nyɛ. Aka {n}. |
| `pin.lockedOut` | Too many wrong PINs. Sign in with your password to open the app (this needs internet). Nothing on this phone is lost. | PIN a ɛnyɛ no adɔɔso. Fa wo ahintasɛm hyɛn mu na bue app no (ɛhia intanɛt). Biribiara nyera wɔ fon yi so. |
| `pin.forgot` | Forgot PIN? Sign in with your password | Wo werɛ afi PIN? Fa ahintasɛm hyɛn mu |
| `pin.signInWithPassword` | Sign in with your password | Fa wo ahintasɛm hyɛn mu |
| `pin.delete` | Delete | Pepa |
| `pin.entered` | {n} of 4 digits entered | Nɔma {n} wɔ 4 mu |
| `account.title` | My account | Me akawnt |
| `account.noEmail` | No email | Email nni hɔ |
| `account.notConfirmed` | Email not confirmed. | Email no nnya nyɛɛ pi. |
| `account.pendingEmail` | Waiting for you to confirm {email}. | Ɛretwɛn wo ma wosi {email} so dua. |
| `account.sendLink` | Send the link again | Soma link no bio |
| `account.linkSent` | We've sent a new link. Check your inbox and spam. | Yɛasoma link foforɔ. Hwɛ wo inbox ne spam. |
| `account.changePassword` | Change password | Sesa ahintasɛm |
| `account.changePhone` | Change phone number | Sesa fon nɔma |
| `account.changeEmail` | Change email | Sesa email |
| `account.addEmail` | Add email | Fa email ka ho |
| `account.currentPassword` | Current password | Ahintasɛm a wode di dwuma seesei |
| `account.newPhone` | New phone number | Fon nɔma foforɔ |
| `account.newEmail` | New email | Email foforɔ |
| `account.emailNote` | We will send a link to the new email. Your old email keeps working until you tap it. | Yɛbɛsoma link akɔ email foforɔ no so. Wo email dada no bɛyɛ adwuma kɔsi sɛ wobɛmia so. |
| `account.otherPhones` | This signs you out on your other phones. This phone stays signed in. | Yei bɛyi wo afi wo fon afoforɔ no so. Fon yi deɛ, wobɛtena mu. |
| `account.done.password` | Password changed. | Wɔasesa ahintasɛm no. |
| `account.done.phone` | Phone number changed. | Wɔasesa fon nɔma no. |
| `account.done.email` | Check your new email and tap the link to confirm it. | Hwɛ wo email foforɔ no na mia link no so si so dua. |
| `account.signOut` | Sign out | Fi mu |
| `account.signOutTitle` | Sign out? | Wopɛ sɛ wofi mu? |
| `account.signOutText` | Your records stay on this phone. You will need your password to sign in again. | Wo nkrataa bɛtena fon yi so. Wobɛhia wo ahintasɛm na woahyɛn mu bio. |
| `account.signOutUnsent` | {n} records are not sent yet. They stay on this phone, but they will only be sent after you sign in again. | Nkrataa {n} nnya nkɔeɛ. Wɔbɛtena fon yi so, nanso wɔbɛsoma wɔn bere a woahyɛn mu bio nko ara. |
| `account.signOutSure` | Are you sure? {n} records are still not sent. | Wo ho akokwaw? Nkrataa {n} nnya nkɔeɛ. |
| `account.signOutAnyway` | Sign out anyway | Fi mu sa ara |
| `errors.offline` | No internet. Connect and try again. | Intanɛt nni hɔ. Fa bɔ ho na san bɔ mmɔden. |
| `errors.temporary` | The server isn't answering yet. Try again in a minute. | Server no nnya nnyee so. San bɔ mmɔden simma baako mu. |
| `errors.rateLimited` | Too many tries. Wait a few minutes and try again. | Wo bɔɔ mmɔden pii. Twɛn simma kakra na san bɔ mmɔden. |
| `errors.unexpected` | Something went wrong. Try again. | Biribi ankɔ yie. San bɔ mmɔden. |
| `errors.code.WRONG_LOGIN` | Wrong phone number, email or password. | Fon nɔma, email anaa ahintasɛm no nyɛ. |
| `errors.code.WRONG_PASSWORD` | That's not your current password. | Ɛnyɛ ahintasɛm a wode di dwuma seesei no. |
| `errors.code.PHONE_TAKEN` | This phone number already has an account. | Fon nɔma yi wɔ akawnt dada. |
| `errors.code.EMAIL_TAKEN` | This email already has an account. | Email yi wɔ akawnt dada. |
| `errors.code.INVALID_TOKEN` | This link has expired or has already been used. | Link yi abɔ ne bere so anaa wɔde adi dwuma dada. |
| `errors.code.TERMS_VERSION_MISMATCH` | The terms have just changed. Please read them again and accept. | Nhyehyɛeɛ no asesa seesei ara. Mesrɛ wo kenkan bio na gye tom. |
| `errors.code.NOTHING_TO_CONFIRM` | Your email is already confirmed. | Wo email ayɛ pi dada. |
| `errors.code.EMAIL_NOT_SENT` | Couldn't send the email. Try again later. | Yɛantumi ansoma email no. San bɔ mmɔden akyiri yi. |
| `errors.code.FORBIDDEN` | Your role can't do this. | Wo dibea ntumi nyɛ yei. |
| `errors.field.generic` | Check this and try again. | Hwɛ yei na san bɔ mmɔden. |
| `errors.field.name` | Enter your name (up to 60 letters). | Kyerɛw wo din (nkyerɛwdeɛ 60 mu). |
| `errors.field.phone` | Enter a valid mobile number, for example 024 123 4567. | Kyerɛw fon nɔma a ɛyɛ, sɛ nhwɛsoɔ 024 123 4567. |
| `errors.field.newPhone` | Enter a valid mobile number that is different from your current one. | Kyerɛw fon nɔma a ɛyɛ na ɛnyɛ deɛ wowɔ seesei. |
| `errors.field.email` | Enter a valid email address. | Kyerɛw email a ɛyɛ. |
| `errors.field.newEmail` | Enter a valid email that is different from your current one. | Kyerɛw email a ɛyɛ na ɛnyɛ deɛ wowɔ seesei. |
| `errors.field.businessName` | Enter the business name (up to 60 letters). | Kyerɛw adwuma no din (nkyerɛwdeɛ 60 mu). |
| `errors.field.password` | Use 8 to 128 characters, and not a very common password. | Fa nkyerɛwdeɛ 8 kɔsi 128, na ɛnyɛ ahintasɛm a nnipa pii de di dwuma. |
| `errors.field.newPassword` | Use 8 to 128 characters, not a very common password, and not your current one. | Fa nkyerɛwdeɛ 8 kɔsi 128, ɛnyɛ deɛ nnipa pii de di dwuma, na ɛnyɛ deɛ wowɔ seesei. |
| `errors.field.passwordEmpty` | Enter your password. | Kyerɛw wo ahintasɛm. |
| `errors.field.passwordsDiffer` | The two passwords don't match. | Ahintasɛm abien no nyɛ pɛ. |
| `errors.field.currentPassword` | Enter your current password. | Kyerɛw ahintasɛm a wode di dwuma seesei. |
| `errors.field.login` | Enter your phone number or email. | Kyerɛw wo fon nɔma anaa email. |
| `errors.field.language` | Choose a language. | Paw kasa. |
| `errors.field.country` | Choose a country. | Paw ɔman. |
| `errors.field.acceptTerms` | Tick the box to accept the privacy notice and terms. | Hyɛ ahwɛ no so na gye kokoam nkra ne nhyehyɛeɛ no tom. |


---

## BE5 Part B: sync (push and pull)

### Push: sending records, each one exactly once

The phone keeps every change in an **outbox** and sends it with `POST /api/sync/push` as **operations**, each with its own `opId` (a UUID made on the phone). The server answers each operation separately: `saved`, `duplicate` (already saved earlier, with the same answer as the first time) or `rejected` (with a code). One bad operation never blocks the others.

`runOperation` (`src/sync/runOperation.js`) handles one operation in one transaction:

1. **Reserve the `opId`** in `ProcessedOperation`. If another request already has it, this one waits, and then gets the stored answer (`duplicate`) or `OP_ID_CONFLICT` if the payload, type or phone is different (a bug in the phone: two different things sent with one ID).
2. **Lock rows in one fixed order** (customer → sale → … → `SyncSequence` last). Two transactions taking locks in the same order can't wait for each other in a circle, which is how deadlocks happen.
3. **Run the handler** inside a savepoint: if it rejects, only its own writes are undone, and the rejection is stored.
4. **Stamp sequence numbers** (`serverSeq`) on every row it wrote, last of all, then store the answer and commit, all together.

A **temporary** failure (the database went away, a deadlock that didn't clear after 3 tries) rolls everything back, **including the reservation**, so the phone's retry is treated as new. It's never stored as a rejection: that would lose a real sale.

### Pull: getting other phones' changes

Every synced row has a `serverSeq`, numbered 1, 2, 3… per business. The phone asks `GET /api/sync/pull?since=<cursor>`. The server reads the **watermark** (the highest number fully committed) and scans `since+1 … min(since+limit, watermark)`. It returns only the rows **this person may see** (Who sees what), and `nextCursor` is the last number **scanned**, not the last row returned. So an associate whose page held only hidden rows (for example the owner's team list) still moves forward, instead of asking for the same page forever.

---

## BE5.5: the sync torture test

### What it is

`npm run test:sync` starts a **real server** on a random local port and several pretend **phones** (`tests/torture/harness.js`) that talk to it over real HTTP, each with its own cookie, its own signing key and its own clock. Then it does to sync everything a market day can do to it: bad networks, retries, two phones at once, a database that falls over. It runs the whole suite **three times in a row** (`scripts/repeat-tests.js`): problems with timing don't always show up the first time, so one pass isn't enough. It's part of `npm run test:all`, not the everyday `npm test`.

Sales, debts and returns don't exist yet, so locations stand in for "a record". BE8, BE9 and BE10 add their own cases (receipt numbers, a late offline sale, two phones returning the same item).

### Test-only operations, and why they can't reach production

The test needs records it can create in bulk, and failures it can switch on. So the harness defines three operations of its own: `test.addLocation`, `test.failAt` (fails as if the database stopped) and `test.deadlockOnce` (fails as if MySQL broke a deadlock). They live **only** in the test folder and are handed to the test server by the test code. The real list of operations (`src/sync/operations`) has none of them, and the failures are switched on only by the test code itself (a plain variable), never by a header, a query or an environment variable. Two tests prove it: no file in `src/` even names them, and a server started exactly as in production answers `UNKNOWN_OPERATION` for all three, even when the request asks for them.

### The cases, in plain words

| Case | What happens in real life | What must happen |
|---|---|---|
| The same push twice, and twice at the same moment | The phone thought the first try failed and sent again | Saved once; the copies get `duplicate` |
| The answer is lost | The shop's network drops just as the server answers; the server saved it, the phone doesn't know | The phone retries as a **new** request (new nonce, new signature) and gets `duplicate`. Someone who copies the exact old request and sends it again gets `NONCE_REUSED`: a recorded request can't be replayed |
| Four copies at the same moment | A phone's retry runs into its own first try | Exactly one location; three `duplicate` |
| Operation 3 of 10 is invalid | A bug, or an old app version | 9 saved, 1 rejected, and the rejected one isn't reserved, so a corrected one can use the same `opId` |
| The database stops at operation 5 of 10 | Aiven restarts in the middle of a push | 1–4 stay saved; 5 leaves nothing at all (no half row, no `ProcessedOperation` row); the phone's retry saves 5–10, and 1–4 come back `duplicate` |
| Same `opId`, different payload or type, or from another phone | A bug in the phone | `OP_ID_CONFLICT` for that operation only; nothing applied; the rest of the batch is still saved |
| A deadlock | Two busy phones collide in the database | Retried automatically; one `ProcessedOperation` row, one location |
| A phone's clock is 10 minutes slow | Phones' clocks are often wrong | First request `CLOCK_OUT_OF_RANGE`; the phone reads `X-Server-Time` from that answer and corrects itself; the retry is saved once |
| Five phones push 50 operations at the same moment | A busy Saturday | All 50 saved; every sequence number unique (`check:sequences` agrees) |
| Two owner phones edit the settings offline | Owner and their second phone both changed the receipt note | The last received wins; both are in the history, the later one marked `conflict` |
| An associate's page of only hidden rows | New team members and phones the associate isn't allowed to see | The cursor still moves on, no endless asking |
| Rows saved while a phone is paging | Another phone pushes during a long pull | They come in the next pages, exactly once, never skipped |
| 2,000 rows, pages of 500 | A phone that was offline a long time | Each row exactly once; server memory steady (below) |
| Role filtering | Who sees what | Owner gets settings, locations, memberships and phones; managers and associates only settings and locations |
| A removed member, a revoked phone | Someone leaves; a phone is stolen | `ACCESS_REMOVED` and `DEVICE_REVOKED` on push and pull; the removed person still works in their **own** business |
| Afterwards | | `check:sequences` and `check:operations` find nothing wrong |

### The memory check and its margin

After paging through the 2,000 rows once, the test pages through them **five more times**, forcing a garbage collection after each (that's why the tests run with `node --expose-gc`), and checks that the server's heap has grown by **less than 64 MB**.

Why so generous? The test, the server and the test's phones all share one Node process, and the heap moves for reasons that have nothing to do with a leak: Jest's own bookkeeping, MySQL connection buffers, compiled code, and when exactly V8 decides to free memory. Those moves are a few megabytes and change from run to run. A leak looks different: if the server kept each page's rows, five more passes over 2,000 rows would keep growing round after round, and a real leak at real sizes grows without stopping. 64 MB is far above the normal wobble, so the test doesn't fail at random (it must pass three runs in a row), and still catches the kind of leak that matters. It isn't a performance measurement; the server's real memory is watched in production in BE14.

### Running it

`npm run test:sync` (needs the test database, `.env.test`). It takes a few minutes per run, mostly the password hashing at sign-up and sign-in (deliberately slow). If any run fails, the script stops and says which run.

---

## BE6: products, sizes and prices

### Products go through sync, like everything a phone records

Adding or editing a product is a **sync operation** (`product.upsert`), not an ordinary endpoint, because the owner may do it with no network. The phone makes the product's ID itself (`crypto.randomUUID()`), saves it locally, and pushes it later. "Upsert" means: a new ID adds the product, a known ID edits it. Each size is its own operation (`size.upsert`), pushed after its product. A shoe with 11 sizes is 12 operations, which is fine: a push takes up to 200.

The ready-made size ranges (shoes 30–46, clothing XS–XXXL, children 1Y–12Y) are **data** in `src/catalog/sizeRanges.js`, sent in `GET /api/reference`. The phone turns "30 to 40" into 11 sizes, each with its position (`sortOrder`), so sizes show in natural order (30, 31 … 40; S, M, L) and never alphabetically. Adding a range later means adding one entry to that file.

### Versions, and why every price is remembered

Every accepted change makes a new `version` of the product or size, and its prices and cost at that version are written to **`PriceVersion`** in the same transaction. Nothing ever changes or deletes those rows (they're on the permanent-records list).

Why? Picture this: on Monday the owner raises a sandal from GH₵ 120.00 to GH₵ 130.00. On Saturday a sales associate's phone, offline since Friday, still shows GH₵ 120.00 and sells it at that price. When the sale syncs (BE8), the server must check that GH₵ 120.00 really was the price the phone was showing, and work out the profit from the cost **at that moment**. The sale will name the version it used, and `PriceVersion` answers "what were the prices in version 1?". The new version is also in the operation's stored result, so a sale made right after an offline price edit can name that edit by its `opId`.

The version is also how editing works: "last change received wins, with history". The phone says which version it edited (`baseVersion`). If someone else changed the product in between, the change is still applied (the later one wins), and the history marks it as a **conflict**, so the owner can see that two phones changed it at once.

### Cost prices belong to the owner

- Only the owner sends `costMinor`. A manager's operation with a cost is rejected `FORBIDDEN`; a manager's edit keeps the existing cost.
- In the **pull**, the owner's product and size rows have `costMinor`; everyone else's rows don't have the field **at all**, so it can never be found in a staff phone's storage.
- The **`BELOW_COST` warning** goes only to the owner: telling a manager "this price is below cost" would tell them roughly what the cost is.
- The **history** (`GET /api/products/:productId/history`) keeps cost in the server's `ChangeLog`; for a manager the endpoint removes it, and leaves out changes that were only about cost.

When the owner adds a product, the cost is required. When a manager adds one, it's saved without a cost, and the owner's phone shows it in a "Cost price needed" list (the products whose `costMinor` is `null`), until the owner adds it.

### Warnings, not errors

Some things are worth telling the person but must never stop a save:

- the wholesale price is higher than the retail price;
- a selling price is below the cost (owner only);
- **another product already has this name** (`PRODUCT_NAME_DUPLICATE`), or another size of the product has this label (`SIZE_LABEL_DUPLICATE`).

The duplicate-name rule was decided on 8 Nov 2026. Two phones offline may both add "Black sandal" and **both sell it** before either syncs. If the server rejected the second product, every sale on that phone that used it would land in "Needs attention", which is exactly the kind of mess the app exists to prevent. So both are saved, and the one that arrives second gets the warning with the other's ID; the owner can then hide one. The comparison ignores capitals and extra spaces ("  black   SANDAL" is the same as "Black sandal").

### Units and the yard

Quantities are whole numbers everywhere. Fabric sold by the yard can be sold in half yards, so for yards the server sets `unitScale` to 2 and quantities count **half yards**: 2.5 yards is stored as 5. Every other unit has `unitScale` 1. The phone never sends `unitScale`; the server works it out from the unit. Fabric is sold by the piece or the yard only, and has no sizes.

### The database helps too

- Prices must be above zero, `unitScale` must match the unit, fabric can't have another unit, and a shop's own unit must have a name: all `CHECK` constraints in MySQL, so even a bug can't save a broken product.
- `PriceVersion` can't hold the same version twice for one product or size. MySQL can't have a NULL column in a primary key, and a product's own prices have no size, so the table has an ordinary `id` and a unique key on `(businessId, productId, sizeKey, version)`, where `sizeKey` is a column MySQL fills in itself: the size's ID, or empty for the product.
- Sizes and price rows point at their product with **composite foreign keys** `(businessId, productId)`, so they can't point at another business's product.
- `ChangeLog` gained `seq`, a number MySQL counts up for every row, so history always shows in the order changes were saved (two changes can happen in the same millisecond).

### What waits for BE7

Starting stock (the first stock entry when a product is added), refusing to remove a size that still has stock, and refusing to switch a product between yards and other units once it has stock all need stock, which arrives in BE7. They're written into BE7's "Done when".

### A lesson about migrations (8 Nov 2026)

While building BE6, the products migration was changed after it had already run on the **test** database (`ChangeLog.seq` was added to it). The test database still had the old version, so the migration had to be undone there first. But undoing ran the **new** `down()`, which tried to remove `seq`, something the old version never created. It failed halfway: the three product tables were dropped, yet the migration was still marked as done in `SequelizeMeta`. From then on `db:migrate` would have skipped it, and the tables would simply have been missing. It was fixed on the test database by removing that mark (after checking the database's name ended in `_test`), and then migrating again. Development and production were never affected.

The lesson is that a migration file is a **record of something that already happened** to a database. `SequelizeMeta` remembers only the file's *name*, not what was in it. If the file changes afterwards, the database and the file quietly disagree, and on the next undo or on a fresh database the two give different results. That's why the project now has this rule (in CLAUDE.md):

- Once a migration has run on **production**, it is never edited. Any change, however small, is a **new** migration.
- **Before** production, a migration may be edited only after undoing it on **every local database** (development and test), while its `down()` still matches what its `up()` did. Then it's applied again from the new file.

The rule was used straight away. BE6's migration gave `ChangeLog` its `seq` column, but MySQL numbered the rows that **already existed** in the order of their primary key, a random UUID, so older history (team, phones, settings) got its numbers in random order. That migration had already run on production, so it wasn't edited: a **new** migration (`20261111100000-changelog-seq-order`) renumbers every row by `(changedAt, seq)`. Older rows fall into time order; newer rows, whose `seq` was already right, keep it as the tie-breaker for two changes in the same millisecond. Its `down()` does nothing, because a random order isn't worth restoring.

---

## BE7: stock

### Stock is a list of things that happened

The server never keeps a "stock = 7" number that gets changed. Instead it keeps **what happened**: goods arrived (`opening`, `restock`), goods left (`removal`; from BE8 `sale`), and people counted the shelf (`StockCount`). Each is a **permanent record**: saved once, never changed or deleted. A mistake is balanced by another movement or a new count. Stock is worked out from those records every time it's needed.

Why? Because phones are offline. Two phones can each sell the last pair of sandals; a delivery recorded on Monday can reach the server on Wednesday. If the server kept one number and changed it, the order in which phones happened to sync would decide the answer, and some changes could be lost. A list of events gives the same answer whatever order they arrive in.

### The stock rule

1. Put every movement and count of one size in order of **when it happened** (`recordedAt`, and the ID for a tie), never in order of arrival.
2. **No count yet:** stock is the sum of the movements.
3. **With counts:** stock is the **latest count** plus the movements after it. Movements before a count are already "inside" what was on the shelf.

The worked example: phone A shows 10. Phone B, offline, sells 3 at 09:58. At 10:00 phone A counts 8. B's sale arrives at 11:30. Stock is **8** (the count, since the sale happened before it), and the count's difference is 8 − (10 − 3) = **+1**: one more than expected, not 2 missing. When the count was first saved the server could only say −2; once B's sale arrived, the difference corrected itself. That's why a count stores **what was on the shelf**, never a difference.

**Check this count:** if a sale recorded within 10 minutes of a count reaches the server *after* the count, a wrong phone clock could have put it on the wrong side, so the count shows "Check this count". This is **worked out** from the arrival times, never stored, because a count is a permanent record that late records mustn't change.

The rule lives in one small file, `src/services/stockRule.js`, with no database in it, so the phone app can copy it exactly. Both sides test their copy against the same examples (`tests/fixtures/stock-rule.json`, also printed in `api.md`; a test checks the two copies are identical). The server's database side (`src/services/stock.js`) loads only the latest count and the movements after it, so a size with years of history stays fast.

### Never refused for short stock

If a removal (or, from BE8, a sale) takes stock below zero, it's **saved anyway** (Decision F-8): the goods really left the stall, and refusing would make the records wrong. The movement gets the flag `belowZeroOnArrival`, set once when it's saved, and the owner and manager see "Below zero: check the shelf". The flag is a note about that moment; the current stock always comes from the rule, so a later restock or count fixes it. When two phones remove the last items at the same moment, the product row is **locked** for the first one, so the second sees the first's movement and is the one flagged.

`clockSkew` marks a record whose phone clock looked wrong: more than 10 minutes in the future, or "made online" but arriving more than 10 minutes from its time.

### Who can do what

Only the owner and managers add, remove or count stock (Decision F-17); an associate's attempt is refused. Everyone receives the stock rows, because everyone needs to answer "Do you have size 42?". Associates get only the fields the rule needs (quantities and times), not who removed what, the reasons or the notes.

### Units

Quantities are whole numbers. Products sold by the yard count **half yards**, so 2.5 yards is 5 units, and the limit of 100,000 yards is 200,000 units. A size whose stock isn't 0 can't be removed ("This size still has 3 in stock."), and once a product has any stock record it can't switch between yards and another unit, because every stored quantity would suddenly mean something else.

### check:stock

`npm run check:stock` (read-only) works out every size's stock two independent ways, the rule over **all** its rows and one plain SQL query, and reports any size where they disagree. Since stock is never stored, this is how we know the rule, the server's shortcut (latest count plus later movements) and the data all agree.

---

## BE8: sales

### One sale, one transaction

`sale.create` saves a sale with everything that belongs to it: its lines (`SaleItem`), its payments (`SalePayment`), one stock movement per line, its receipt number in the registry, and the customer's new balance. All of it happens in **one transaction** inside `runOperation`, so a sale is never half saved: if anything fails, nothing of it exists, and the phone's retry starts clean. Like stock movements, a sale is a **permanent record**: no code can change or delete it. A mistake is fixed with a correction (BE10), and the original stays visible.

### The server recalculates, the phone's numbers are only checked

The phone shows the seller every number before they confirm, and sends them all. The server works them all out again itself and compares:

- **The set price** comes from the **version** of the product (and size) the phone was showing. Every price change made a numbered version in BE6 (`PriceVersion`), so even a sale made offline on Saturday, at Monday's old price, is checked against the price the phone really showed. If the phone edited the price itself and sold before syncing, the line names that edit by its `opId` instead of a number.
- **The line total** is quantity × agreed price, divided by `unitScale` for yards. Half a yard at GH₵ 15.05 is 752.5 pesewas, which isn't a whole number. The rule (decided 9 Nov 2026) is to round to the nearest pesewa, halves up: 753. The phone shows the rounded total before confirming, and the sale is saved with the `roundedLine` flag so the owner can see it. The phone and the server must round exactly the same way, so the rule lives in one small file (`src/services/saleRule.js`), with examples in `tests/fixtures/sale-rule.json` that both sides test against (printed in `api.md`).
- **Subtotal, paid and credit** must add up exactly: credit = subtotal − paid, never below zero, and any credit needs a customer.
- **The cost** is never sent by the phone. The server takes it from the same version, so profit is right even if the cost changed later. Only the owner ever sees it.

If the numbers don't match, the sale is rejected (`SALE_TOTALS_MISMATCH`, `PRICE_VERSION_MISMATCH`): that only happens through a bug or tampering, because the phone uses the same rule.

### Saved and flagged, never refused

Some things look wrong but really happened in the shop, and refusing the sale would lose a real sale. These are **saved** with a flag for the owner (and manager) to review:

| Flag | What happened |
|---|---|
| `belowZeroOnArrival` | Two phones sold the last pair; stock went below zero |
| `overCreditLimit` | The customer now owes more than their limit (the phone stops associates; the owner and manager may go ahead, Decision 3-3) |
| `belowCost` | Sold below cost (owner only: telling anyone else would reveal the cost) |
| `olderPrice` | The phone used a price that had already changed (Decision 3-8) |
| `roundedLine` | A half-yard total was rounded |
| `methodDisabled` | Paid with a method the owner had just switched off (an unknown method code is still refused) |
| `clockSkew` | The phone's clock looked wrong |

### Receipt numbers

Receipt numbers are made **on the phone** (`K7M-0042`: the phone's code, then its own counter), so a sale has its number the moment it's confirmed, even offline. The server never makes one; it checks it. The number must start with **this phone's** code, and the `ReceiptNumber` registry makes sure it's used only once in the business, across sales, corrections and repayments. `check:receipts` (read-only) confirms every registry row has its record and every sale its registry row.

### Customers and balances

A credit sale needs a customer, and the seller may add one in the middle of a sale (`customer.upsert`, add only for now; editing comes with BE9). The customer's `balanceMinor` is a **cache** the server updates in the sale's own transaction, so an associate, who only receives their own sales, still sees every customer's correct balance. It's never the truth on its own: `check:balances` works every balance out again from the sales and reports any difference. In BE9 balances become proper debt lots (oldest debt paid first, credit, returns).

### Who sees what

- **Associates receive only their own sales** (they can't see other people's customers' purchases), but every stock movement's quantities, so their stock is right. Their pull cursor still moves past the sales they don't receive.
- **Cost (`unitCostMinor`) and the "sold below cost" flag** go only to the owner. Managers see the other flags; associates see only "below zero" and the clock flag.
- A sale's lines and payments travel **inside** the sale's own pull row, so a page can never contain half a sale.

### The first sale locks the currency

The business's first money record sets `moneyRecordedAt`. From then on its country, currency and time zone can't change (`localeLocked`), because every stored amount and business day would suddenly mean something else.
