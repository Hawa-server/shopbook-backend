# Shop Book: Server Plan (backend project)

How to build the **server** for Shop Book, an offline-first bookkeeping app for market traders. The phone app has its own plan: `docs/app-plan.md`.

The server is an Express API with a MySQL database. Many businesses use it; each business's records are completely private. It receives records from phones (**push**), sends back everything a phone is allowed to see (**pull**), and recalculates every total, balance and stock figure itself.

---

## Repository and documents

```text
STOREBOK_BACKEND/                 the backend project (its own Git repository)
├── CLAUDE.md                     all the rules for backend tasks
├── docs/
│   ├── backlog.md                what to build and why (the same file in both projects)
│   ├── server-plan.md            this file: how to build the server
│   ├── app-plan.md               the frontend's plan, for reference only
│   ├── api.md                    written here, as the server is built; copied to the frontend by me
│   └── guide.md                  plain-language explanations for studying
├── src/  migrations/  seeders/  tests/  scripts/  legal/
└── package.json  .nvmrc  .env.example

STOREBOK_FRONTEND/                the frontend project (its own Git repository)
├── CLAUDE.md                     all the rules for frontend tasks
├── docs/
│   ├── backlog.md                the same file as in the backend
│   ├── app-plan.md               how to build the app
│   ├── server-plan.md            for reference only
│   ├── api.md                    a copy from the backend, never edited here
│   └── guide.md
├── src/  public/
└── package.json  vite.config.js  vercel.json
```

**Keeping the two projects in step:** after every backend task, I copy `docs/api.md` from the backend to the frontend. When a planning document changes (`backlog.md` or either plan), I put the same new copy in both projects.

**Order of authority:** `backlog.md` (what) → the two plans (how) → `api.md` (the exact contract) → code.

- The app uses only what `api.md` lists. If a plan and `api.md` disagree about a request or response shape, `api.md` wins, and the plan is corrected.
- **If any two documents conflict, or the code would have to break a rule to work: stop, say which documents disagree, propose which one to update, and wait.** Never quietly pick one.

---

## Build order (whole project)

| Phase | Tasks | Notes |
|---|---|---|
| 1. Server foundations | BE0–BE4, **BE4.5**, BE5 | Accounts, team, isolation, international-ready (Ghana first), sync |
| 2. Server sync torture test | **BE5.5** | Scripts only; must pass before any app sync work |
| 3. App foundations | FE0–FE4 | Shell, sign-in, sync engine, team |
| 4. Phone torture test | **FE3.5** (in the app plan) | Two real phones; must pass before FE5 |
| 5. Features, server then app | BE6 → FE5, BE7 → FE6, BE8 → FE7, BE9 → BE13 (reminders, used by FE8) → FE8, BE10 → FE9, BE11 → FE10, BE12 → FE11 | One epic at a time |
| 6. Accounts, privacy and support | BE15 → FE13, BE16 → FE14, BE17 | Download, closing a business, practice shop, Help, support tools and monitoring |
| 7. Finish | BE14, FE12 | Production review (live since BE1 and FE1), security review, a full day in the test shop |

---

## Stack

| Part | Choice |
|---|---|
| Runtime | Node.js 26 (pinned in `package.json` `engines`, `.nvmrc`, and Render's `NODE_VERSION`) |
| Framework | Express 5 (errors thrown in `async` route handlers reach the error handler without a wrapper) |
| Database | MySQL 8 with Sequelize, the `mysql2` driver, and `sequelize-cli` migrations (never `sync({ alter })`) |
| Validation | Zod, including the environment variables at start-up (a missing or wrong variable stops the server with a clear message) |
| Passwords | argon2 (argon2id, the library's default settings); ask before falling back to `bcryptjs` |
| Sessions | JWT in an HTTP-only cookie: `jsonwebtoken` (HS256, secret `JWT_SECRET`) and `cookie-parser` |
| Cryptography | Node's built-in `crypto` (no library): device signature checks (ECDSA P-256), SHA-256 for payload hashes, email tokens and body hashes, random tokens and challenges, constant-time comparisons |
| CORS | `cors`, allowing only `CLIENT_URL` (and the local development address when `NODE_ENV=development`) |
| Rate limits and security headers | Written in the project (no library): a small rate limiter (in memory while there's one server instance, see Security) and a middleware that sets the security headers |
| Phone numbers | A small function written in the project with a per-country table (BE4.5; launch: Ghana): local (`024…`, `24…`) and international (`+233…`, `00233…`) forms → **E.164** (`+233…`), with unit tests; no library |
| Countries, currencies, languages, payment methods | Reference tables in `src/locale/` (BE4.5; launch: Ghana, GHS with 2 decimals, English and Twi, cash and mobile money "MoMo"); a money formatter written in the project (symbol, non-breaking space, minor units, integer arithmetic only) |
| Environment | Node's built-in `--env-file=.env` for local development (no `dotenv`); `node --watch` instead of nodemon; values checked with Zod at start-up |
| Logging | A small JSON logger written in the project (no library) |
| Unit and API tests | **Jest + Supertest** (dev only); test scripts create and clean up their own test businesses |
| Manual tests | Postman collection (`docs/postman_collection.json`) |
| Email | The provider's **HTTPS API** called with `fetch` (Brevo free plan), **no SMTP, no Nodemailer**; behind a small adapter (`sendEmail({ to, template, data })`). In development and tests it writes to the log instead of sending |
| Error monitoring | Sentry free (`@sentry/node`), with no personal data (Decision F-25) |
| Hosting | Free plans for testing: Render (API), Aiven (MySQL); the app on Vercel rewrites `/api/*` to the API (see Free-tier hosting) |

No other libraries without asking.

---

## Free-tier hosting

Free plans are for building and testing with the test shop (Decision F-12). These are the limits we found on Adorn and Agyefam, and how this project deals with them.

| Limit | What it means here | What we do |
|---|---|---|
| **Render free sleeps** after about 15 minutes without requests; waking takes up to a minute | The first sync of the morning is slow | Phones treat a slow or timed-out sync as temporary and retry (app plan); the app calls `GET /api/health` when it opens to start waking the server |
| **One free Render service** with about 750 hours a month per workspace | Enough for one always-on service | The API is **one service**; Shop Book has no background jobs (reminders are worked out on request by `GET /reports/reminders`) |
| **Render free blocks SMTP** | Email can't be sent with Nodemailer | Account emails (confirm email, reset password) go through the email provider's **HTTPS API** (Decision F-20); customer messages still go from the phone through WhatsApp |
| **Brevo free:** about 300 emails a day, and a Gmail sender address is rewritten (it may land in spam) | Plenty for account emails while testing | Use a verified sender; before real shops use it, send from a domain you own. A quota error answers "Couldn't send the email. Try again later" |
| **Aiven free MySQL** is small and may be powered off after a long time unused | Data could be unreachable after weeks of no use | Use it for testing only; check the console if `/api/health` reports the database down; manual backups (Backups and restore) |
| **Requests pass through Vercel, then Render** | `req.ip` could be a proxy's address, so rate limits would lump every phone together | In BE1, log `req.ip` from a real phone in production and set `trust proxy` to the number of proxies in front, so rate limits use the phone's own address |

**Before real shops rely on it daily:** move the API to a paid Render instance (no sleeping) and the database to a paid plan with point-in-time restore. Neither needs code changes.

---

## The rules that matter most (invariants)

These are never broken. A task that seems to need breaking one is a conflict: stop and ask.

1. **Business isolation.** Every table holding business data has `businessId`. Every query is scoped with the signed-in user's `businessId`, read from the database, **never** from the request. Another business's record is answered as **404 "Not found"**. (A user can belong to two businesses: the real one and its practice shop. The phone says which one it's working in with the `X-Business` header; the server only uses it to **choose among the user's own active memberships**, read from the database. A business the user isn't a member of is answered as 404, and every query then uses that membership's `businessId`.)
   **The database enforces it too:** every business table has a unique key `(businessId, id)`, and references between business tables are **composite foreign keys** (for example `(businessId, productId)` → `Product (businessId, id)`), so a row can never point at another business's record even if the code has a bug. Where a reference can't be a foreign key (the receipt registry's `recordId`), a check command looks for mismatches (Testing).
2. **Roles on the server.** Every request re-reads the user's **current** membership (role and active status). The phone's idea of its role is never trusted.
3. **Field privacy.** Cost prices, profit, and anything derived from them are **removed before sending** to anyone but the owner, in every endpoint and every sync pull.
4. **Permanent records are never changed.** Sales, sale items, payments, corrections, correction items, repayments, debt write-offs, debts brought forward, stock movements, expenses and day closes are **insert only**. There are no update or delete routes for them, and the code contains no update or delete calls on those models. **The only exceptions:** deleting a whole business that its owner closed (BE15, after 30 days) and resetting a **practice** shop (BE16). Both live in one module (`src/services/deleteBusinessData.js`), delete every record of one business inside a transaction, and refuse anything else (a real business that isn't closed and past its 30 days).
5. **Idempotency.** Every record has an ID made on the phone (UUID), and every push operation has an `opId`. The same operation twice is saved once and answered "duplicate". The **same `opId` with a different device, type or payload** is a bug, never a duplicate: that operation is answered `rejected` with code `OP_ID_CONFLICT` (inside the normal 200 answer; the rest of the batch carries on) and nothing is applied. A **temporary** server failure (database down, deadlock, timeout) rolls back and is never stored as a rejection, so the phone simply retries.
6. **The server recalculates.** Totals, balances, stock and profit come from the underlying records. Totals sent by a phone are only checked for mismatch.
7. **Money** is whole **minor units** of the business's currency (integers; pesewas for GHS). Money fields end in `Minor` (`amountMinor`, `retailMinor`…); how many decimals a currency has (0, 2 or 3) comes from the server's currency table. **Quantities** are whole **units** (integers); products sold by the yard use half-yard units (`unitScale` = 2), so 2.5 yards is stored as 5. No floating-point money anywhere.
8. **Error format:** `{ "error": { "code", "message", "fields"? } }`. No stack traces, SQL or secrets in responses.
9. **Time:** store UTC. Business days use the **business's own time zone** (`Business.timezone`, IANA, e.g. `Africa/Accra`). Every synced record keeps the phone's `recordedAt` and the server's `receivedAt`.
10. **Comments for learning:** a short purpose comment at the top of every file and above every function, explaining the *why*.

---

## Security

#### Accounts and sessions

- Passwords hashed with **argon2id**; minimum 8 characters (backlog AC5), and the most common passwords (a short list kept in the project, such as `12345678` and `password`) are refused with a clear message. Long passphrases are allowed (up to 128 characters).
- **Sign-in by phone number or email** (Decision F-3): the login field is treated as an email if it contains `@`, otherwise as a phone number (normalised). Both are unique per user. The owner must have an email; staff may not.
- **One-time email tokens** (confirm email, reset password, change email): 32 random bytes sent in the link, only their **SHA-256 hash** stored, single use, compared in constant time. Confirm-email and change-email links last 24 hours; reset links 30 minutes. Asking for a new link cancels older unused ones of the same kind.
- **Forgot password never reveals who has an account:** always the same answer and roughly the same response time. A reset link goes only to a **confirmed** email. Setting a new password bumps `sessionVersion` (every other sign-in ends) and uses the token.
- **Changing your phone number or email** needs the current password; a new email is saved as pending until confirmed, and a notice goes to the old email.
- **Terms:** sign-up and a staff member's first sign-in record the accepted privacy notice and terms version (`termsVersion`, `termsAcceptedAt`); requests are refused with 403 `TERMS_REQUIRED` until accepted, except the endpoints that show and accept them.
- Session JWT in an HTTP-only, `SameSite=Lax`, `Secure` (production) cookie. The payload holds only `userId`, `sessionVersion` and `issuedAt` (the start of this sign-in).
- **Two lifetimes:**
  - **Idle:** 30 days. Every successful request or sync renews the cookie for another 30 days.
  - **Absolute:** 90 days from `issuedAt`. After that the user must sign in again, even if active. Renewal never moves `issuedAt`.
- `sessionVersion` on the user is incremented only for things that concern **the person**, in every business: changing or resetting their password (by them, the owner, the reset link or a support tool) and changing their phone number or email. Old sessions stop working immediately.
- **Business-level changes never touch `sessionVersion`**: removing someone from a business, revoking a phone, or closing a business. Each request re-reads the membership, the device and the business's status, so access to **that business** ends at once while the person stays signed in to any other business (for example, their practice shop or another shop they work in).
- Sign-in errors never reveal whether a phone number or email has an account ("Wrong phone number, email or password.").
- Phone numbers normalised to **E.164** (`+<country code><number>`, e.g. `+233XXXXXXXXX`) before storing or comparing; a local number is read with the business's country, or the country chosen on the sign-in screen.
- Temporary staff passwords are shown once, stored only as a hash, and force `mustChangePassword`.

#### Requests

- **CSRF**, in layers: the `SameSite=Lax` cookie; state-changing requests must send `X-Requested-With: XMLHttpRequest`; and on POST, PUT, PATCH and DELETE an `Origin` header, when present, must be `CLIENT_URL`, otherwise 403. On the **account endpoints** (sign-up, sign-in, forgot and reset password, device bootstrap), `Origin` must be **present** and match. The local development address and Postman are allowed only when `NODE_ENV=development`, never by a production setting. CORS alone is never treated as CSRF protection.
- **CORS** only for `CLIENT_URL`; `trust proxy` set to the number of proxies in front (Vercel and Render), checked in production in BE1 by logging the real chain of `X-Forwarded-For` from a phone (see Free-tier hosting). The hop count is written in the README with the date it was checked, and **re-checked whenever hosting changes** (a custom domain, a paid plan, Cloudflare); a test in BE14 confirms a forged `X-Forwarded-For` from a phone doesn't change `req.ip`. Phones normally call the same-site `/api` through the Vercel rewrite, so CORS mainly matters for local development.
- **Body size limit:** `express.json({ limit: '1mb' })` (a 200-operation push fits well inside it).
- **Rate limits:** sign-in 10 per 15 minutes per login (phone number or email) and per IP; sign-up 5 per hour per IP; forgot password and "send the link again" 3 per hour per account and 10 per hour per IP; adding a team member 20 per hour per owner and 30 per hour per IP; the owner resetting a staff password 10 per hour per owner and 20 per hour per IP; device registration 5 per hour per user and per IP; failed device signatures 20 per 15 minutes per device (then that device is refused for 15 minutes and the owner sees it); sync 120 per 15 minutes per user.
- **Where the counts live:** in memory is acceptable while the API runs as **one** Render instance (a restart resets them, which is written down as a known limit). Before running more than one instance, move them to a MySQL table (`RateLimitHit`) so every instance shares them.
- **Security headers,** set by a small middleware (no library): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` (production only), `Cache-Control: no-store` on every `/api` response; remove `X-Powered-By`.

#### Logging

- Every request gets a **request ID** (a UUID), sent back in an `X-Request-Id` header and included in every log line and in 500 error responses ("Something went wrong. Reference: …"), so a problem a user reports can be found in the logs.
- **Structured logs:** one JSON line per request: time, request ID, method, path, status, duration, `userId` and `businessId` when known. Sync requests also log operation counts (saved, duplicate, rejected).
- **Never logged:** passwords, PINs, tokens (including email links), cookies, full request bodies, customer phone numbers, email addresses. Log user and business IDs instead.
- **Error monitoring (Sentry):** an **allow-list**, not a block-list: `beforeSend` builds a new event with only the error type and message, stack (file names and lines, no local variables), route pattern (`/api/sync/push`, no query string), method, status, request ID, user, business and device IDs, app version. Bodies, headers, cookies, query strings, breadcrumbs with user input and local variables are never sent (`sendDefaultPii: false`, `includeLocalVariables: false`). A test sends a fake error carrying a phone number, email and token and checks none of them leave.
- **Health:** `GET /health` answers only `{ status, database, version }`: **200** with `status: "ok"` when the database answers, **503** with `status: "down"` and `database: "down"` when it doesn't; never error messages, hostnames or SQL. `version` comes from `package.json` until BE17 switches it to `APP_VERSION`.

#### Devices

- Each phone registers once per business and gets a `deviceCode`. The owner can see the business's devices and **revoke** one (a lost or stolen phone). A revoked device's next request gets **403 `DEVICE_REVOKED`**, and the phone wipes that business's local data (as with `ACCESS_REMOVED`). The person can sign in again on a new phone, which registers as a new device with a new code and a new key.
- **A device ID or code is an identifier, never a credential** (ADR-15). Every phone proves it is the registered device with its own **signing key**:
  - **Registration (enrolment)** is the one moment a stolen cookie could be turned into a trusted device, so it needs more than a session:
    1. The app creates an **ECDSA P-256** key pair with Web Crypto, with the private key **non-extractable**, and keeps it (a `CryptoKey`) in that business's Dexie database.
    2. `POST /devices/challenge` (signed in) returns a random **challenge** (32 bytes), stored hashed for 5 minutes, single use.
    3. `POST /devices` sends the device ID, name, **public key** (JWK), the challenge, a **signature of the challenge with the new private key** (proof the phone really holds that key), and the person's **current password**. The server checks all of it: valid session, active membership, the password (argon2), the challenge (unused, not expired, issued to this user), the signature against the sent public key.
    4. A device ID that already exists is refused with `409 DEVICE_ID_TAKEN` (a phone never swaps its key; a new key means a new device).
    5. Limits: 5 registrations per hour per user and per IP; a wrong password counts towards the sign-in rate limit. Every registration is recorded in `ChangeLog` for the business, the owner's phone list shows it at once, and the owner gets an email ("A new phone, [name], was added to [business] by [person]").
    - Signing in on the phone and registering happen together on a new phone, so the password the person just typed is reused for step 3 without asking twice; registering later (for example after storage was cleared) asks for it again.
    - **Recovery when every phone is lost:** the person signs in on a new phone with their password (or resets it by email, F-18; or the support tool, AC35) and registers it; the owner revokes the lost ones. Nobody is ever locked out by losing their keys.
  - **Every business request** (anything with `X-Business`: sync, team, devices, reports, export, close, practice) carries `X-Device-Id`, `X-Signed-At` (a timestamp), `X-Nonce` (16 random bytes) and `X-Signature`, signed over this exact text, one item per line: method, path with its query string, the SHA-256 of the exact body (of an empty body for GET), device ID, business ID, timestamp, nonce.
  - **The server checks**, in this order: the session; `requireAuth` (the business from `X-Business` among the person's own memberships); then the device and signature, **before the role and the handler**: the device exists, is active, and belongs to this user and this business (otherwise **403 `DEVICE_NOT_REGISTERED`**, also for another member's device, so nobody can probe or lock out someone else's phone; the app registers this phone again; a revoked one gets 403 `DEVICE_REVOKED`); the signature is valid for its public key; the timestamp is within **5 minutes of the server's clock**; the nonce hasn't been used by this device in the last 10 minutes (stored in `DeviceRequestNonce` with a unique key, so two copies of a request racing each other can't both pass; expired nonces for that device are deleted on the same request, so no background job is needed). Failures: 401 `DEVICE_SIGNATURE_INVALID`, 401 `CLOCK_OUT_OF_RANGE` (with the server time in `X-Server-Time`, so the app corrects itself and retries once), 401 `NONCE_REUSED`. A failed signature counts towards the lock-out (20 in 15 minutes, then 15 minutes refused with `429 RATE_LIMITED`, saved as `signatureLockedUntil` so the owner sees it) **only once the device is confirmed to be this person's in this business**; anything else is answered as an unknown device and counts nothing.
  - **Exact formats** (so the phone and server always build the same text):
    - method in capitals; the path and query string **exactly as sent** (no decoding, no re-ordering), e.g. `/api/sync/pull?since=120&limit=500`;
    - body hash: SHA-256 of the **raw request bytes** as received (Express keeps them with `express.json({ verify })`), as lowercase hex; for an empty body, the hash of zero bytes;
    - device ID and business ID as lowercase UUIDs; timestamp as integer milliseconds since 1970 (UTC); nonce as 16 random bytes in base64url;
    - the seven items joined with `\n`, UTF-8; signature: ECDSA P-256 with SHA-256 in the **IEEE P1363** format Web Crypto produces (64 bytes, r‖s), sent as base64url; Node verifies with `crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)`. Public keys are stored as JWK (`kty: EC`, `crv: P-256`) and checked to be on the curve when registered.
  - **Nonce timing:** the signature is checked first; then the nonce is inserted in **its own short transaction, committed before the request's operations run**. The unique key makes two copies racing for the same nonce impossible (one insert wins). If the request then fails, the phone's retry is a new request with a new nonce, and `opId` idempotency makes the retry safe. Nonces live 10 minutes; each request deletes that device's expired ones.
  - `lastSeenAt` / `lastSyncAt` are written at most once every 5 minutes per device, not on every request.
  - **Not signed** (the complete list): `GET /health`, `GET /legal/current`, the account endpoints under `/auth` (sign-up, sign-in, sign-out, `me`, change password, terms, confirm email, forgot and reset password, change phone or email; they're protected by the session, the password where needed, rate limits and the `Origin` check), and device bootstrap (`POST /devices/challenge`, `POST /devices`, protected by the password and proof of the key). Everything else that uses a business is signed.
  - **Wrong phone clocks:** every response carries `X-Server-Time`; the app keeps the difference from its own clock and signs with **server-corrected time**, so a phone set to the wrong day still signs correctly. Records still keep the phone's own `recordedAt` for the clock-skew flag (F-10).
  - **A signature never replaces the other checks:** the session, membership, business status, device ownership, role and `opId` idempotency are all still checked.
  - **Honest limits (written in `docs/guide.md`):** a non-extractable key stops the key being copied off the phone, so a stolen cookie alone can't be used from another machine. It does **not** stop malicious script running inside the app from asking the browser to sign, and it doesn't protect a phone someone has unlocked and is holding. Preventing script injection (a strict Content-Security-Policy on the app, no `dangerouslySetInnerHTML`, no unreviewed libraries) stays essential. Revocation takes effect on the device's next request; a phone that stays offline can't be wiped remotely until it connects.
  - **Lost key** (the phone's storage was cleared): the app signs in again and registers as a new device; the old one stays listed for the owner to revoke.

---

## Data model

All IDs are UUIDs (`CHAR(36)`). Business data tables have `businessId`, `createdAt` and a **`serverSeq`** (see Sync protocol). Money columns end in `Minor` (whole minor units of the business's currency); quantity columns end in `Units`.

#### Accounts and team

- **Business:** `id, country (ISO 3166, e.g. GH), currency (ISO 4217, e.g. GHS), timezone (IANA, e.g. Africa/Accra), moneyRecordedAt? (when its first money record was saved: a sale, repayment, debt brought forward, write-off or expense, set in that record's transaction from BE8 on; from then on country, currency and time zone are locked, 409 CURRENCY_LOCKED), status (active|closing), isPractice (default false), practiceForBusinessId? (on a practice shop: its real business), closeRequestedAt?, closeRequestedBy?, createdAt`
- **BusinessSettings** (editable, synced; **the one intentional exception** to the `(businessId, id)` key: exactly one row per business, so `businessId` is its key): `businessId (primary key), businessName (1–60 characters; typed once at sign-up, then changed only here), receiptPhone? (the shop's number printed on receipts), receiptNote? (up to 120 characters, e.g. "Goods sold are returnable within 7 days"), paymentMethods (the payment-method codes this business uses, from its country: `["cash", "mobile_money"]` in Ghana), defaultLanguage (a supported language tag; launch `en` or `tw`), lowStockThreshold (default 3), returnPeriodDays (default 7), defaultCreditLimitMinor?, version, updatedBy?, updatedAt, serverSeq`. `updatedBy` is a member of this business (composite key `(businessId, updatedBy)` → `Membership (businessId, userId)`, BE4), or NULL for a system change. Settings sync like any editable record (with a version and `ChangeLog`), so they're never changed without a sequence number. Owner only. **The business name lives only here** (there's no `Business.name`): sign-up writes it here, and the app header, receipts, reminders, statements, emails and the close-business confirmation all read it from here, so nobody ever types it again.
- **User:** `id, name, phone (unique, E.164, e.g. +233…), email? (unique when set, lower case), emailConfirmedAt?, pendingEmail?, passwordHash, mustChangePassword, language (a supported language tag), sessionVersion, termsVersion?, termsAcceptedAt?, createdAt`
- **EmailToken:** `id, userId, purpose (confirm_email|reset_password|change_email), tokenHash (unique), email (the address it was sent to), expiresAt, usedAt?, createdAt`. Not business data (no `businessId`, never synced).
- **SupportAction:** `id, action, businessId?, userId?, reason, performedBy (the developer's name), createdAt`: every support-tool change (Decision F-25). Insert only; never synced. `businessId` and `userId` are **plain values, not foreign keys**, so these records survive a business being purged (kept 2 years).
- **Membership:** `id, businessId, userId, role (owner|manager|associate), invitedName? (the name the owner typed for an invitation), invitedAt?, isActive, createdBy, removedAt?, declinedAt?, serverSeq` (unique `businessId+userId`; exactly one active owner per business). Three states, enforced by a `CHECK`: **active** (`isActive`), **invited** (not active, not ended, `invitedAt` set: the person already had an account and hasn't accepted yet; an owner is never invited), **ended** (`removedAt` set: removed by the owner, or declined with `declinedAt`).
- **Location:** `id, businessId, name, type (shop|warehouse), serverSeq` (stage 1: one shop created at sign-up)
- **Device:** `id (from the phone), businessId, userId, deviceCode, name, publicKey (JWK), keyAlgorithm ('ECDSA-P256'), isActive, lastSeenAt, lastSyncAt?, signatureLockedUntil? (after too many failed signatures), revokedAt?, revokedBy?, createdAt, serverSeq (Part B)` (unique `businessId+id`; unique `businessId+deviceCode`, so codes are never reused; composite key `(businessId, userId)` → `Membership`). A revoked device is never reactivated; the phone registers a new device with a new key.
- **DeviceRequestNonce:** `businessId, deviceId, nonce, expiresAt` (primary key `businessId+deviceId+nonce`). Never synced. Expired rows are deleted by the housekeeping clean-up (`src/services/housekeeping.js`), the one allowed delete outside `deleteBusinessData`.
- **DeviceChallenge** (BE5): `id, businessId, userId, challengeHash (SHA-256, unique), expiresAt (5 minutes), usedAt?, createdAt`. The one-time challenge a phone signs when registering; never deleted (a used or expired one can't be used again). Never synced.
  - `deviceCode`: 3 characters from an alphabet without look-alikes (no 0/O, 1/I/L), unique per business, **never reused** (even after revocation). Picked at random from the 24,389 possible codes (29 letters and digits, 3 places), trying again on a clash (the unique key decides). If a business ever used half of them, new codes become 4 characters; receipts stay readable either way.

#### Editable records (last change received wins, with history)

- **Product:** `id, businessId, name, nameNormalized, type (clothing|shoes|fabric|other), unit (piece|pair|set|dozen|yard|custom), unitLabel?, unitScale (1|2), retailMinor, wholesaleMinor?, costMinor?, lowStockLevelUnits? (null = the business's level), lowStockWarnings (default true), isHidden, version, updatedBy, updatedAt, serverSeq` (`businessId+nameNormalized` **indexed, not unique**: two phones may add the same name offline and each sell it before syncing, so both are kept and the later one gets the `PRODUCT_NAME_DUPLICATE` warning; the same for size labels within a product, `SIZE_LABEL_DUPLICATE`; decided 8 Nov 2026. `lowStockLevelUnits` and `lowStockWarnings` arrive with BE7)
- **ProductSize:** `id, businessId, productId, label, sortOrder, retailMinor?, wholesaleMinor?, costMinor?, isActive, version, serverSeq` (null price = use the product's)
- **PriceVersion** (server-only history, insert only, never synced): `id, businessId, productId, sizeId? (null = the product's own prices), sizeKey, version, retailMinor, wholesaleMinor?, costMinor?, createdByOpId, createdAt`. Primary key `id`, plus a **unique key `(businessId, productId, sizeKey, version)`**, where `sizeKey` is a generated column (`sizeId`, or `''` for the product's own prices): MySQL doesn't allow a NULL column in a primary key (decided 8 Nov 2026). A row is written **in the same transaction** as every accepted product or size change, so the server can always answer "what were the prices and cost in version 7?" (see Sale prices below).
- **Customer:** `id, businessId, name, nameNormalized, phone?, language, isHidden, creditLimitMinor?, balanceMinor (server-calculated, read-only), oldestUnpaidAt?, version, updatedBy, updatedAt, serverSeq`. `version` counts **edits to editable fields** only. A change to the cached balance doesn't change `version` (it isn't an edit and can't conflict) but does take a new `serverSeq`, so every phone receives the new balance.
- **ExpenseCategory:** `id, businessId, name, isActive, version, updatedBy, updatedAt, serverSeq`
- **Every editable record** (Product, ProductSize, Customer, ExpenseCategory, BusinessSettings) has `version`, `updatedBy`, `updatedAt` and `serverSeq`; ProductSize gains `updatedBy, updatedAt` too.
- **ChangeLog:** `id, businessId, entity, entityId, changedBy?, changedAt, before (JSON), after (JSON), conflict, seq` (`seq`, from BE6: AUTO_INCREMENT, the order rows were written; history is shown in that order, since two changes can share a millisecond; rows from before BE6 were renumbered in time order by migration `20261111100000-changelog-seq-order`) (`changedBy` is a member of this business, enforced by the composite key `(businessId, changedBy)` → `Membership (businessId, userId)` from BE4, or **NULL for a system change** made by no person, such as the later scheduled jobs in BE13 and BE15): every edit of an editable record, cost fields included (owner-only view), and (from BE3, where the table is created) every team change: add or invite, accept, decline, role change, password reset (recorded without the password), removal. Insert only.

#### Permanent records (insert only)

- **StockMovement:** `id, businessId, locationId, productId, sizeId?, quantityUnits (+ in, − out), type (opening|restock|sale|return_in|exchange_in|exchange_out|removal), reason? (removals: damaged|lost|supplier_return|used|other), note?, saleId?, correctionId?, flags (JSON, **set once when saved, never changed**: `belowZeroOnArrival` = the size's stock was below zero right after this arrived; `clockSkew`), recordedBy, recordedAt, receivedAt, serverSeq` (decided 9 Nov 2026: current stock always comes from the count rule, never from the flag)
- **StockCount** (a physical count, Decision 2-5): `id, businessId, locationId, productId, sizeId?, countedUnits, baselineUnits (what the phone showed), baselineCursor (the phone's sync cursor then), reason? (only when counted ≠ baseline, and then required: `damaged`, `lost_or_stolen`, `miscounted_before`, `other`), note? (1–200 characters, required for `other`), recordedBy, recordedAt, receivedAt, serverSeq`. A count records **what was on the shelf**, never a difference; how it's used is in Calculated. **No flags column** (decided 9 Nov 2026): `countCheck` is worked out, never stored, because a count is a permanent record and late records would otherwise have to change it.
- **Sale:** `id, businessId, locationId, deviceId, receiptNumber, customerId?, priceType (retail|wholesale), subtotalMinor, paidMinor, creditMinor, recordedBy, recordedAt, receivedAt, flags (JSON, set once when saved: belowZeroOnArrival, clockSkew, overCreditLimit, afterDayClose, belowCost, olderPrice, roundedLine, methodDisabled; who sees which is in `api.md`), serverSeq` (unique `businessId+receiptNumber`; decided 9 Nov 2026: the below-zero flag is `belowZeroOnArrival`, as on stock movements)
- **SaleItem:** `id (made on the phone; also the ID of the line's `sale` stock movement), saleId, businessId, productId, sizeId?, productName, sizeLabel?, unit, unitLabel?, unitScale, quantityUnits, productVersion, sizeVersion?, setPriceMinor, agreedPriceMinor, lineTotalMinor, priceNote?, unitCostMinor? (owner-only, set by the server)`. The name, size, unit and `unitScale` are **copies made at the time of the sale**, so later product changes never change an old receipt (2.5 yards stays 2.5 yards). `productVersion` and `sizeVersion` say exactly which prices the phone was showing.
- **SalePayment:** `id, saleId, businessId, method (a payment-method code the business uses: `cash`, `mobile_money` at launch), amountMinor`
- **Correction:** `id, businessId, locationId, deviceId, receiptNumber, originalSaleId, customerId?, type (return|exchange), reason, note?, valueInMinor (goods coming back, server-calculated), valueOutMinor (goods going out, exchanges), debtReducedMinor, refundMinor, refundMethod? (cash|momo), keptAsCreditMinor, noRefundMinor, extraPaidMinor, extraPaidMethod? (cash|momo), extraCreditMinor, recordedBy, recordedAt, receivedAt, flags, serverSeq`. How these must add up is in "Returns and exchanges" below.
- **CorrectionItem:** `id, correctionId, businessId, direction (in|out), originalSaleItemId? (required when direction = in), productId, sizeId?, quantityUnits, priceMinor, condition? (restock|damaged, for items coming back)`. An item coming back always points to the **exact line** of the original sale; its product and size must match that line, and its price can't exceed the line's agreed price.
- **Repayment:** `id, businessId, customerId, deviceId, receiptNumber, amountMinor, method (a payment-method code the business uses: `cash`, `mobile_money` at launch), note?, correctsRepaymentId?, correctionReason?, recordedBy, recordedAt, receivedAt, flags (overpaid), serverSeq` (a correction reverses the original's amount; owner and manager only)
- **DebtWriteOff:** `id, businessId, customerId, amountMinor, reason (moved|died|disputed|other), note?, correctsDebtWriteOffId?, correctionReason?, recordedBy (owner only), recordedAt, receivedAt, serverSeq` (a correction reverses a wrong write-off in full; see Reversals)
- **OpeningDebt** (debt brought forward, Decision 4-8): `id, businessId, customerId, deviceId, amountMinor, owedSince (date, may be in the past), note?, correctsOpeningDebtId?, correctionReason?, recordedBy (owner or manager), recordedAt, receivedAt, serverSeq` (a correction reverses the original's amount)
- **Expense:** `id, businessId, locationId, categoryId?, description, amountMinor, method (a payment-method code the business uses: `cash`, `mobile_money` at launch), correctsExpenseId?, correctionReason?, recordedBy, recordedAt, receivedAt, flags, serverSeq`
- **DayClose:** `id, businessId, locationId, businessDate, closeNumber (1, 2, …), replacesDayCloseId?, replaceReason?, notes?, closedBy, recordedAt, receivedAt, serverSeq` (unique `businessId+locationId+businessDate+closeNumber`; unique `replacesDayCloseId`), with **one `DayCloseLine` per payment method the business uses** (`dayCloseId, businessId, method, expectedMinor, countedMinor`; unique `dayCloseId+method`; BE4.5): cash and mobile money in Ghana, any other method elsewhere, so the drawer and each mobile-money balance are checked separately. A wrong close (a miscounted drawer) is never edited: the owner or manager records a **new close for the same day** that replaces the latest one, with a reason. Reports use the latest close and show the earlier ones beneath it.

#### Sync bookkeeping

- **SyncSequence:** `businessId (primary key), lastSeq`
- **ReceiptNumber** (the receipt registry): `businessId, receiptNumber, recordType (sale|correction|repayment), recordId, deviceId, createdAt`, primary key `(businessId, receiptNumber)`. One table for every kind of receipt, so a number can never be used twice across sales, corrections and repayments. Written in the **same transaction** as the record it belongs to.
- **DebtLot** (server-made projection, rebuildable): `id, businessId, customerId, sourceType (opening_debt|credit_sale|exchange_credit), sourceId, originalMinor, outstandingMinor, effectiveAt, orderKey` (unique `businessId+sourceType+sourceId`). One lot per thing that creates a debt: what the customer owes the shop.
- **CreditLot** (server-made projection, rebuildable): `id, businessId, customerId, sourceType (repayment_excess|write_off_excess|return_kept_as_credit|return_excess), sourceId, originalMinor, remainingMinor, effectiveAt, orderKey` (unique `businessId+sourceType+sourceId`). One lot per thing that creates credit: what the shop owes the customer.
- **DebtAllocation** (server-made projection, rebuildable): `id, businessId, customerId, debtLotId (always set), sourceType (repayment|write_off|return_debt|credit_lot), sourceId (the record, or the `CreditLot` for credit_lot), amountMinor (> 0), orderKey`. Every reduction of a debt and exactly which lot it reduced; when credit pays a debt, `sourceType = credit_lot` names **which** credit lot was used.
- Phones never create or receive lots or allocations; they're **not financial facts**, only a worked-out view of the permanent records, so `check:balances` can rebuild them from scratch and compare. The rules are in Calculated.
- **ProcessedOperation:** `businessId, opId, deviceId, userId, type, payloadHash, status (pending|saved|rejected; `pending` exists only inside the operation's own transaction, between the reservation and the final result, so a committed row is never `pending`, which `check:operations` verifies), errorCode?, resultJson, processedAt` (unique `businessId+opId`). `payloadHash` is SHA-256 of the **validated, normalised** payload, worked out by the server (never sent by the phone); `resultJson` is the answer to repeat on a duplicate. Every operation's outcome is recorded here **in the same transaction** as its effect, so a repeated operation (a phone that never got the response) gets the same answer again without being applied twice. This covers editable records too, which have no natural "already saved" check.

#### Calculated (never stored as editable numbers)

- **Stock on hand** (per product, size and location), ordered by `stockKey = (recordedAt, id)`:
  - with no count: the sum of all movements;
  - after a count: **the latest count's `countedUnits` + the movements after it** (by `stockKey`). Movements before the count are already reflected in what was on the shelf, so a sale recorded at 09:55 that reaches the server after a 10:00 count is absorbed correctly, and one at 10:05 is subtracted.
  - The **count difference** (the loss or gain the owner sees) = `countedUnits` − what the movements up to the count say. It's worked out, never stored as a movement, so it's always right after late records arrive.
  - Example: Phone A shows 10. Phone B sells 3 at 09:58 (offline). Phone A counts 8 at 10:00. Stock on hand = 8 (not 5); the difference shown is 8 − (10 − 3) = **+1** (one more than expected), not −2.
  - **Wrong clocks near a count:** if a movement with `recordedAt` within 10 minutes of a count arrives after that count was received, the count **needs a check** (`countCheck`, "Check this count: a sale near the count time arrived late"), because a phone clock could have put it on the wrong side. It's **worked out** from the rows (`receivedAt` of both), never stored.
  - **One rule, two places:** the server (`src/services/stockRule.js`) and the phone implement exactly this rule, and both are tested against the same fixtures (`tests/fixtures/stock-rule.json`, shown in `api.md`).
  - The server keeps no editable stock number; the phone's `stockLevels` is rebuilt with the same rule.
- **Customer balance** is **defined by the lot rules just below** (they're the single definition; nothing else calculates a balance): in short, everything owed (debts brought forward, the credit part of sales, exchanges on credit) minus everything paid off (returns' debt part, repayments, write-offs), with money paid beyond what's owed (overpayments, returns kept as credit, returns beyond the sale's debt) held as credit. Reversed records and their reversals drop out. It can go **below zero** ("in credit", Decision 4-5); a later debt uses that credit first. `oldestUnpaidAt` comes from paying the oldest debt first (Decision 4-7).
  - **How it's worked out: debt lots, credit lots and allocations (ADR-20).** Inside the transaction of every customer-affecting record (customer row locked), the server rebuilds that customer's lots and allocations from scratch from the permanent records that are **in effect** (an original that has been reversed, and its reversal, both drop out; see Reversals), processing events one at a time in one fixed order:
    - **`orderKey = (effectiveAt, recordedAt, kindRank, id)`**, built only from values stored on the records themselves, **never** from `serverSeq` or `receivedAt`, so it doesn't depend on which phone's records reached the server first. `effectiveAt` is the debt brought forward's `owedSince` (start of that day, Accra), or the record's own `recordedAt` for everything else, exactly as the phone sent it (no capping: a future-dated record keeps its date and its `clockSkew` flag). `kindRank` puts, at the very same instant, debts before the reductions recorded with them (opening debt 1, credit sale 2, exchange credit 3, return 4, repayment 5, write-off 6). `id` (a UUID) breaks any remaining tie.
    1. **A debt event** (debt brought forward, the credit part of a sale, the credit part of an exchange) creates a **debt lot**. If the customer has credit lots with money remaining, they pay the new lot straight away, **oldest credit first** (`credit_lot` allocations, AC25).
    2. **A return's debt part** (`debtReducedMinor`) reduces **only the lot of the sale it returns**. If that lot has less outstanding than the debt part (other money already paid it), the rest becomes a **credit lot** (`return_excess`): the customer has now paid for goods she gave back, so the shop owes her.
    3. **Repayments and write-offs** pay debt lots **oldest `orderKey` first**; anything left over becomes a credit lot (`repayment_excess`, `write_off_excess`), never negative debt (Decision 4-5).
    4. **A return's `keptAsCredit`** creates a credit lot (`return_kept_as_credit`).
    5. `balanceMinor` = Σ debt lots' outstanding − Σ credit lots' remaining (negative = "in credit"); `oldestUnpaidAt` = the `effectiveAt` of the oldest debt lot with something outstanding (null when none).
  - **Speed (rebuilding without slowing down as history grows):**
    - **The usual case, a new event that is the customer's newest** (its `orderKey` is after the last one processed, and it isn't a reversal): applied **incrementally** to the current lots, without replaying anything.
    - **A late event or a reversal** (rarer): the customer's lots and allocations are **rebuilt in full** from their records, which keeps one simple, well-tested path for the hard case. If the benchmark below ever fails, the next step is replaying only from the earliest affected event, not a different design.
    - Both happen inside the operation's transaction, with the customer row locked, so nobody ever sees a half-rebuilt balance.
    - **Benchmark (BE9 Done when):** a customer with 5,000 events; a newest-event update under 20 ms and a full rebuild under 500 ms on the free database. `check:balances` always does full rebuilds, so the incremental path is checked against the full one.
  - **What "independent of arrival order" means exactly:** for the **same set of accepted records**, the lots and allocations are identical whatever order they arrived in (tested by pushing the same records in shuffled orders). It can't promise more: whether a record is **accepted** at all can depend on arrival (for example, the second of two returns of the same last item is rejected), and in that case the accepted set itself differs. Earlier allocations may move when a late record arrives; that's expected, because they're a worked-out view, and every permanent record stays unchanged. A rebuild touches **one customer**, so it stays fast.
  - **Worked example** (in the tests): Ama owes GH₵ 500.00 from the notebook (lot A). She buys GH₵ 300.00 on credit (lot B). She repays GH₵ 400.00: oldest first, so A goes to GH₵ 100.00 and B stays GH₵ 300.00. She returns goods worth GH₵ 100.00 from the newer sale: that reduces **B** to GH₵ 200.00, never A. Balance GH₵ 300.00, owed since lot A's date.
  - The server keeps the result cached on the customer (`balanceMinor`, `oldestUnpaidAt`), updated in the **same transaction** (bumping the customer's `serverSeq`), so sales associates, who don't receive everyone's sales, still see correct balances. Phones never send a balance. The cache is never the source of truth: `check:balances` rebuilds every customer from the permanent records and reports any difference without changing anything.
- **Profit** = sales at agreed prices − cost of items sold − expenses (owner only).

---

## Business rules the server enforces

#### Sale invariants

Checked on every `sale.create`; any failure rejects the operation with `SALE_TOTALS_MISMATCH` or a more specific code:

- each line: `lineTotal = quantityUnits × agreedPrice ÷ unitScale`, **rounded to the nearest minor unit, halves up** (decided 9 Nov 2026, the sale rule in `api.md`, shared fixtures for phone and server); a rounded line is **saved and flagged `roundedLine`**, never rejected
- `subtotal = sum of line totals`
- `paid = sum of payments`
- `credit = subtotal − paid`
- `paid ≤ subtotal` and `credit ≥ 0`
- `credit > 0` requires a customer
- a line whose agreed price differs from the set price **of the version the phone used** (Sale prices, below) needs a `priceNote`

A valid sale is **never refused because stock is short**: it's saved with the `belowZeroOnArrival` flag.

#### Returns and exchanges

Inside the correction's transaction, the server locks (in the lock order below) the customer, the original sale and its sale lines, then works everything out itself from the stored records. The phone's figures are only checked.

**1. What can come back.** For each original sale line (`originalSaleItemId`): items returned so far + this return ≤ items sold on that line, otherwise `409 RETURN_EXCEEDS_SALE`.

**2. What the goods are worth.** `valueIn` = Σ quantity coming back × that line's **agreed** price per unit (half yards: `quantityUnits × agreedPrice ÷ unitScale`, a whole number of pesewas). The seller may give back less (with a note, AC30), never more.

**3. How a return is settled (Decision 3-10).** The value is settled in this order, and the parts must add up exactly: `debtReduced + refund + keptAsCredit + noRefund = valueIn`.
- **Debt first:** if the sale's own debt lot still has money outstanding, `debtReduced` = the smaller of `valueIn` and that outstanding amount. It can't be skipped: nobody gets cash back for goods they still owe for.
- **Then money back:** `refund` (cash or MoMo) ≤ what was actually paid for this sale: its cash and MoMo payments, plus repayments allocated to its lot, minus **all** money already handed back for it by earlier corrections, **including refunds that were flagged `refundCheck`** (the money left the drawer either way). This stops the same money being refunded twice. "Repayments allocated to its lot" means the allocations of the lot rebuild **at the time this correction is processed**, never a customer's total repayments.
- **Or kept as credit** for her next purchase (`keptAsCredit`, needs a customer), **or no refund** (`noRefund`, needs a note: for example the shop's policy on worn items).
- A sale with no customer (paid in full, cash or MoMo) has no debt part; its refund is limited by what was paid, as above.
- **Who enforces what:** the phone applies these rules with what it knows and won't let the seller break them. The server recalculates with the latest records. Cash or MoMo already handed back is **real money that left the drawer**, so, like an overpayment (Decision 4-5), the server **never rejects** a correction just because its own figures differ: it saves the correction exactly as recorded, works out `debtReduced` from the rest (the calculation below), and adds the **`refundCheck`** flag for the owner whenever money back was more than these rules allow (debt still owed on the sale, or more than was paid). Only impossible requests are rejected: more items than sold (`RETURN_EXCEEDS_SALE`), a value above the agreed price, or parts that don't add up.

**4. Exchanges.** `valueIn` is worked out as above; `valueOut` = items going out at today's price for the sale's retail or wholesale choice (or a changed price with a note). Then:
- if `valueOut > valueIn`, the customer pays the difference: `extraPaid` (cash or MoMo) + `extraCredit` (a new debt lot, `exchange_credit`, needs a customer) = `valueOut − valueIn`;
- if `valueIn > valueOut`, the difference `valueIn − valueOut` is settled exactly like a return (step 3);
- if equal, nothing more.

**5. All effects in the same transaction:** stock movements (in, out, damaged removal), the receipt registry, the customer's lots and allocations, the cached balance, and `serverSeq`. If any check fails, nothing is saved.

Every step's rule has a unit test with the numbers written out, including a sale paid half in cash and half on credit, a sale whose credit was already partly repaid, and a second return on the same line.

**The calculation, written out.** The phone records the split it used: `refund`, `keptAsCredit`, `noRefund` (facts about what was handed over or agreed). The server sets `debtReduced = valueIn − refund − keptAsCredit − noRefund` (never negative; if the phone's parts exceed `valueIn`, the correction is rejected as impossible). Then, in the lot rebuild, `debtReduced` reduces the sale's own lot **only as far as that lot is still outstanding**; any remainder becomes a `return_excess` credit lot. Separately, the server checks the money-back limits and flags `refundCheck` if they were broken. **It never reduces the debt by money that was handed back in cash**, so a large cash refund can't also wipe the debt and create credit twice.

Three cases, each a required test with these exact numbers:

1. **Too much cash back.** Sale GH₵ 200.00 (paid GH₵ 100.00 cash, GH₵ 100.00 credit, lot outstanding GH₵ 100.00). Everything returned; the phone (out of date) handed back GH₵ 200.00 cash. Saved: `refund` 200, `debtReduced` 0. The lot stays at **GH₵ 100.00 owed**, no credit is created, `refundCheck` is flagged (GH₵ 100.00 more cash back than was paid). Balance GH₵ 100.00.
2. **A second return on the same line.** Same sale, 2 pairs at GH₵ 100.00 each, nothing repaid. Return 1: one pair, `debtReduced` 100 → lot GH₵ 0.00. Return 2: the other pair, the phone gives GH₵ 100.00 cash: allowed, since GH₵ 100.00 was paid in cash and nothing was refunded yet. A third return is rejected (`RETURN_EXCEEDS_SALE`).
3. **A repayment that arrives late.** Same sale; the customer repaid GH₵ 100.00 at 10:00 on phone B (offline). At 11:00 phone A records a full return with `debtReduced` 100, `refund` 100. Phone B's repayment reaches the server afterwards. Rebuild in `orderKey` order: the repayment (10:00) pays the lot to GH₵ 0.00; the return's GH₵ 100.00 debt part (11:00) finds nothing outstanding and becomes a **GH₵ 100.00 credit lot** (she paid twice for goods she returned: GH₵ 100.00 cash at the sale and GH₵ 100.00 by repayment, and got GH₵ 100.00 back). Balance **−GH₵ 100.00** ("Shop owes Ama GH₵ 100.00"). The cash refund was within what was paid at that time, so no `refundCheck`.

The same flag is added later if a late offline record changes a customer's allocations so that an **already-given** refund is now more than these rules allow (the money really left the drawer, so it's never undone). The owner sees every `refundCheck` in Today to sort out. Two phones returning the same item offline can't both succeed: the second is rejected with `RETURN_EXCEEDS_SALE` and lands in that phone's "Needs attention" list.

#### Receipt numbers

- Made **on the phone**, so receipts work offline: `deviceCode-number`, for example `K7M-0042`. Each phone keeps its own counter that only goes up.
- The server never counts rows to make numbers, never changes a number, and never reuses one.
- Sales, corrections and repayments share the phone's counter.
- The **receipt registry** (`ReceiptNumber`) checks every number once across all three kinds, in the same transaction as the record. A clash is rejected with `RECEIPT_NUMBER_TAKEN` (it should never happen, because device codes are never reused). A gap in a phone's numbers (for example, a rejected sale) is fine; a reused number never is.
- **The server never makes receipt numbers** (ADR-14): a receipt must be possible with no internet.

#### Reversals (repayments, debts brought forward, write-offs, expenses)

Permanent records are never edited. A wrong **repayment**, **debt brought forward**, **write-off** or **expense** is fixed the same way every time:

1. A **reversal** record of the same type points to the original (`correctsRepaymentId`, `correctsOpeningDebtId`, `correctsDebtWriteOffId`, `correctsExpenseId`) with a `correctionReason`, and cancels it **in full**: the same amount, the same customer or category, the same method. Partial reversals don't exist, so there's never a question of "how much is still in effect".
2. The right amount, if any, is then recorded as a **new, ordinary** record.
3. **Each original can be reversed once:** a unique index on each `corrects…Id` column. A second reversal is rejected with `409 ALREADY_REVERSED`.
4. **A reversal can't be reversed:** the target must be an original (its own `corrects…Id` is empty), otherwise `409 CANNOT_REVERSE_A_REVERSAL`. A mistaken reversal is fixed by recording the original again as a new record.
5. Who may reverse: repayments and debts brought forward, owner and manager; write-offs, owner only; expenses, owner and manager.
6. For debts and credit, an original and its reversal both **drop out** of the lot rebuild (Calculated), as if neither happened; history shows both, with "Reversed" and the reason under the original.
7. Day reports count a reversal on **its own** business day (the money was corrected that day), and show the original's day beneath it.
8. **Amounts are always positive** in every record; a reversal is identified by its `corrects…Id`, and reports and calculations **subtract** it. There are no negative expenses, repayments or write-offs.

Example: the owner writes off GH₵ 500.00 instead of GH₵ 50.00. She reverses the write-off (Ama owes GH₵ 500.00 again), then writes off GH₵ 50.00.

#### Sale prices, older versions and cost (Decision 3-8)

Every product and size change the server accepts gets a new `version`, and its prices and cost at that version are kept in `PriceVersion`. A sale line says which version the phone was showing (`productVersion`, `sizeVersion`):

- **Checking the price:** the server looks up that version and works out the set price itself (the size's price for the sale's retail or wholesale choice, or the product's when the size has none). The phone's `setPriceMinor` must equal it, otherwise the line is rejected with `PRICE_VERSION_MISMATCH` (the phone always uses a version it really had, so this only catches a bug or tampering). The server never takes a set price on trust.
- **A version the phone made itself, not yet accepted:** if the seller's phone changed the price and sold before syncing, the line refers to that edit by its `opId` (`priceRef: { editOpId }`) instead of a number. The edit comes earlier in the same outbox, so the server has already accepted it and knows which version it became (from that operation's stored result).
- **Older price:** if the version used is older than the current one **and** its price differs, the sale is saved and flagged `olderPrice` (Decision 3-8): the customer paid what the seller was shown.
- **Cost** (`unitCostMinor`, owner-only) is **set by the server** from the same version (the size's cost, else the product's), never sent by the phone. No cost in that version → profit for that line is "incomplete". `belowCost` = agreed price below that cost.
- The phone never sends a version the server hasn't issued (or an `editOpId` it hasn't accepted): that's rejected with `UNKNOWN_PRICE_VERSION`.

#### Records that arrive after the day is closed (Decision F-16)

A record counts on the business day of its `recordedAt`, even if it arrives after that day was closed. The day close itself is never changed. The record gets the `afterDayClose` flag, and the closed day's report shows "**N records arrived after closing**" with their totals by cash and MoMo, and whether they explain the close's difference (a late cash sale's money was already in the drawer when it was counted), for the owner and manager to review.

#### Clock problems

Flag `clockSkew` when `recordedAt` is in the future by more than 10 minutes, or when the record says it was made online (`recordedOnline`, an untrusted hint) and `|recordedAt − receivedAt|` is over 10 minutes. Flagged records are saved, never refused.

---

## Concurrency and database safety

Several phones, and several requests from one phone, can change the same customer, sale or product at the same moment. These rules stop that from corrupting anything.

#### Locks, always in the same order

There is **one global order** for every push operation (and every endpoint that changes data), the same as step 1–4 of the push protocol. Taking locks in different orders is what causes deadlocks, so no handler is allowed its own order:

0. **Before the operation's transaction** (once per request, in its own short transaction): the **`DeviceRequestNonce`** insert (signature check).
1. **Idempotency reservation:** insert the **`ProcessedOperation`** row for `(businessId, opId)`. Its unique key decides between two copies of the same operation; a copy that finds it taken stops here, holding nothing else.
2. **Business rows, parent before child, each kind in ascending `id`:**
   a. the **customer** (any customer-affecting record);
   b. the **original sale**, then its **sale lines** (corrections);
   c. the **product** and **product size** rows the operation reads prices or stock checks from (sales, removals, counts, product edits);
   d. the **original record** of a reversal (repayment, debt brought forward, write-off, expense).
3. **Unique reservations for the new record:** the **`ReceiptNumber`** insert (sales, corrections, repayments), then the record and its child rows themselves.
4. The customer's lot rebuild and cached balance (rows already locked in 2a).
5. The business's **`SyncSequence`** row, **last**, so this busiest row is held for the shortest time; every `serverSeq` for the operation is taken here, then commit.

A shared helper, `runOperation(op, { customerId, saleId, productSizeIds, reversalOf })`, performs steps 1–5 in this order, and handlers only supply what to lock and what to write. It is built on `runTransaction(fn)` from BE2, the only place in the code that opens a transaction (deadlock retry included), and lives in `src/sync/runOperation.js`, the **only** file allowed to lock rows (`FOR UPDATE`). Sequence numbers come from one helper, **`takeSequence(transaction, businessId, count)`**, always the **last** step of a transaction, used by `runOperation` and by the endpoints that change synced rows outside sync (team, devices, settings, locale); only `runOperation.js` (where `takeSequence` lives) may touch `SyncSequence`, apart from the read-only `check:sequences` (SELECTs only, tested to contain no writes). A test fails the build if a handler opens its own transaction, locks rows or touches `SyncSequence` directly.

#### Deadlocks and timeouts

MySQL may still end a transaction to break a deadlock (`ER_LOCK_DEADLOCK`) or give up waiting (`ER_LOCK_WAIT_TIMEOUT`). The operation is retried **up to 3 times** with a short random wait; after that it's a **temporary** failure (the phone retries later), never a rejection. Lock wait timeout is set to 10 seconds.

#### Database constraints (MySQL 8 `CHECK`, foreign keys, unique keys)

The database refuses impossible rows even if the code has a bug:

- quantities on sale lines and correction lines `> 0`; a stock movement's quantity `≠ 0`;
- money amounts `≥ 0` wherever a negative has no meaning (payments, refunds, repayments, write-offs, debts brought forward; corrections that reverse use their own fields);
- on a sale: `paidMinor ≤ subtotalMinor` and `creditMinor = subtotalMinor − paidMinor`;
- on a correction: `debtReduced + refund + keptAsCredit + noRefund` equals the settled value (step 3 above);
- on a debt lot: `0 ≤ outstandingMinor ≤ originalMinor`; on a credit lot: `0 ≤ remainingMinor ≤ originalMinor`; an allocation's amount `> 0`;
- one reversal per original: unique indexes on `correctsRepaymentId`, `correctsOpeningDebtId`, `correctsDebtWriteOffId`, `correctsExpenseId`;
- `PriceVersion` rows unique per product, size and version; a count's `countedUnits ≥ 0`;
- the unique keys already listed (`opId`, receipt numbers, nonces, one day close in effect per location per day through `closeNumber` and `replacesDayCloseId`), and the composite foreign keys.

#### What the tests must prove under real concurrency

Each case runs requests **at the same moment** (`Promise.all` against a real MySQL test database, not mocks), checks the result, then runs the consistency checks. Each is repeated **20 times** in one run, and the whole set passes three runs in a row:

- two repayments for the same customer from two phones; a repayment and a credit sale for the same customer;
- a return and a repayment touching the same sale's debt;
- two returns of the same sale line from two phones (one saved, one `RETURN_EXCEEDS_SALE`);
- two sales of the last item of a size (both saved, stock below zero, both flagged);
- two stock removals of the same size from two phones (both saved, as Decision 2-3 says for removals that meet other phones' records; stock goes below zero and is flagged, and `check:stock` agrees);
- two edits of the same product (both in `ChangeLog`, the later one wins, versions go up by one each, each with its `PriceVersion` row), and a sale using the older version arriving at the same moment (saved with the older price and flagged);
- a stock count and a sale of the same size at the same moment (stock on hand follows the count rule whichever commits first);
- two reversals of the same repayment or write-off (one saved, one `ALREADY_REVERSED`);
- 50 operations from five phones at once (sequence numbers unique with no gaps among committed rows, no deadlock left unretried).

---

## Sync protocol

#### Change sequence

One **`SyncSequence`** counter per business. Every insert or edit of a synced row takes the next number (`SELECT … FOR UPDATE` on the business's row, then increment) into that row's `serverSeq`, inside the same transaction. A phone remembers the highest `serverSeq` it has stored (its **cursor**).

#### `POST /api/sync/push`

Body: `{ deviceId, operations: [ { opId, type, recordedOnline, payload } ] }` (`recordedOnline`: whether the phone had a connection when the record was made; an **untrusted hint** used only for the clock-skew flag), at most **200** operations, **oldest first**.

Before any operation: the session, the active membership, the business's status (`closing` → 403 `BUSINESS_CLOSING`) and the device (active, this user's, this business's) are checked once for the request.

For each operation, in order, in **its own transaction**:

1. Validate the payload with Zod and work out its `payloadHash`. A payload that fails Zod is answered `rejected` (`INVALID_PAYLOAD`) **without** reserving the `opId`: validation is deterministic, so a retry gets the same answer, and nothing is stored for data that can't be trusted. Business-rule failures (step 2), by contrast, **are** stored, so the answer never changes even if the data later changes. **Insert** the `ProcessedOperation` row for `(businessId, opId)` first: the unique index decides between two copies of the same operation arriving at the same moment. If the row already exists (committed by an earlier or parallel request), roll back and read it:
   - same device, type and `payloadHash` → return its stored result as `"duplicate"` (or the same rejection), and do nothing else;
   - anything different → `rejected` with code `OP_ID_CONFLICT` (a bug in the phone; it goes to "Needs attention"), and nothing is applied. This is a **per-operation result**, not an HTTP 409: the push still answers 200 and the other operations carry on. The conflict answer itself is not stored (the existing row keeps its own result). The same applies when two operations in one batch share an `opId`: the second is `duplicate` if identical, otherwise `OP_ID_CONFLICT`.
2. Validate: the role allows the operation; referenced products, sizes, customers, sales and sale lines belong to the business; the business rules above.
3. Apply:
   - **Permanent records** (`sale.create`, `correction.create`, `repayment.create`, `debtWriteOff.create`, `openingDebt.create`, `stock.create`, `stockCount.create`, `expense.create`, `dayClose.create`; a reversal is the same type with its `corrects…Id`): insert with the phone's ID, plus their stock movements and balance updates.
   - **Editable records** (`product.upsert`, `size.upsert`, `customer.upsert`, `expenseCategory.upsert`, `settings.update`): each carries the `baseVersion` the phone edited. Apply in the order received (**last change received wins**), add 1 to `version`, and write the previous version to `ChangeLog`, marked `conflict: true` when `baseVersion` was older than the stored version (someone else changed it first). The accepted version comes back to every phone in the next pull. Only the fields listed for that type are applied (an allow-list); a request body is never passed straight to a model. Memberships, roles and devices are **never** editable through sync, only through their own endpoints.
4. Fill in the `ProcessedOperation` row with the final `saved` or `rejected` result and commit.

If anything fails for a **temporary** reason (database unreachable, deadlock after retries, timeout), the whole transaction rolls back, including the `ProcessedOperation` row, and that operation is answered as a temporary failure (the rest of the batch stops; the phone retries later). Only a **business rule** failure is stored as a permanent rejection.

One rejected operation (including `OP_ID_CONFLICT`) doesn't stop the others; whole-request problems (session, signature, device, business status, a malformed body) are the only HTTP errors. Response (200):

```json
{ "results": [ { "opId": "…", "status": "saved" | "duplicate" | "rejected", "error": { "code": "…", "message": "…" } } ], "serverTime": "…" }
```

A rejection is **permanent** (the same operation will always be rejected); the phone moves it to "Needs attention". A network failure or 5xx is **temporary**; the phone retries.

#### `GET /api/sync/pull?since=<cursor>&limit=500`

- At the start, the server reads the business's current `lastSeq` as this pull's **watermark**. It then **scans** the next `limit` sequence numbers with `since < serverSeq ≤ watermark`, in order, and returns those the user may see. Changes committed during the pull have a higher number than the watermark and come in the next pull, so nothing is skipped.
- Answer: `{ rows, nextCursor, hasMore, watermark }`. `nextCursor` is the **last sequence number scanned**, whether its row was visible or not (or the watermark, once everything up to it is scanned); `limit` counts scanned numbers, not returned rows. Example: an associate may see 101, 103 and 105 but not 102 and 104; a page that scanned 101–105 returns three rows and `nextCursor: 105`. A page of only hidden rows still moves the cursor on, so a phone never gets stuck.
- **Filtered by role** (Decision F-9): cost and profit fields removed for non-owners; sales associates receive only their own sales, corrections and repayments, but all products, sizes, stock movements, customers and customer balances.
- A removed or deactivated member gets **403 `ACCESS_REMOVED`**; a revoked device gets **403 `DEVICE_REVOKED`**. Both tell the phone to wipe the business's data.
- A new phone starts with `since=0` and pages through everything.
- Updates the device's `lastSeenAt` (at most once every 5 minutes).
- **Child rows travel with their parent:** sale lines and payments with their sale, correction lines with their correction, using the parent's `serverSeq`. They're inserted in the parent's transaction and never change, so they never need their own number.
- **Team and locations:** `Location` rows go to everyone; `Membership` and `Device` rows go only to the **owner** (team and phones screens). Everyone else learns their own role and business from `GET /auth/me`, and a role change takes effect on the server at once (the phone's copy is display only).

#### Order of operations

Phones **push first, then pull**, so their own records come back with server sequence numbers. The phone advances its cursor only after a page is stored locally (see the app plan).

---

## Who sees what (server-enforced)

Every pull and endpoint filters by role on the server. Hiding something on screen is never the protection.

| Record | Owner | Manager | Associate |
|---|---|---|---|
| Products, sizes, prices | ✅ with cost | ✅ no cost | ✅ no cost |
| `PriceVersion`, debt and credit lots, allocations, `ChangeLog` | server only (owner's history screens use endpoints, with cost for the owner only) | server only (history without cost) | ✗ |
| Stock movements and stock counts | ✅ | ✅ | ✅ **only the fields the stock rule needs** (ids, product, size, location, quantity or counted units, `recordedAt`, `receivedAt`; no type, reason, note, person or flags) |
| Sales, sale lines, payments | ✅ all, with cost | ✅ all, no cost | **own** only, no cost |
| Corrections | ✅ all | ✅ all | **own** only |
| Repayments | ✅ all | ✅ all | **own** only |
| Repayment reversals | ✅ | ✅ (records them) | ✗ (sees the customer's corrected balance) |
| Debts brought forward and their reversals | ✅ | ✅ (records them) | ✗ (sees the balance only) |
| Write-offs and their reversals | ✅ (records them) | ✅ (sees them in history) | ✗ |
| Customers, balances, credit limits, `oldestUnpaidAt` | ✅ | ✅ | ✅ (balance and limit, to sell and collect; no Who owes list, Decision 4-6) |
| Expenses and categories | ✅ | ✅ | ✗ |
| Day closes | ✅ | ✅ (records them) | ✗ |
| Business settings | ✅ (changes them) | ✅ (reads) | ✅ (reads, no cost-related fields) |
| Locations | ✅ | ✅ | ✅ |
| Memberships, devices | ✅ | ✗ (own via `/auth/me`) | ✗ (own via `/auth/me`) |
| Reports (`/reports/day`, reminders) | ✅ with profit | ✅ no profit | ✗ (Today on the phone from own records) |
| Export, close business, practice reset | ✅ | ✗ | ✗ |

**Associates never receive other associates' customer transactions.** BE4's isolation test and BE5.5's pull tests check **every record type in this table for every role**.

---

## The API contract for the frontend (`docs/api.md`)

The phone app is built in the **separate frontend project**, by a Claude Code session that works **only from `docs/api.md`** (copied there by me after each backend task): it can't see the server's code. So `api.md` is written **for the frontend developer** and must be complete on its own. Every BE task updates it **in the same task**, before the task is called done.

**What it contains, in this order:**

1. **Changes:** a list at the top, newest first: which BE task added or changed what ("BE9: added `openingDebt.create`; `customers` rows gain `oldestUnpaidAt`"), so the app side knows what's new.
2. **Conventions:** base path `/api`; cookies (the session cookie is HTTP-only; the app never reads it); required headers (`X-Requested-With`, `X-Business`, and the four signing headers with the **exact text that is signed**, encodings and an example); headers the server sends back (`X-Server-Time`, `X-Request-Id`); money in pesewas, quantities in units with `unitScale`, dates and times (UTC ISO strings; business dates `YYYY-MM-DD` in Africa/Accra); IDs (UUIDs); limits (body size, batch size, page size).
3. **Errors:** the error format, then a table of **every error code** with its HTTP status, what it means, and **what the app should do** (for example `DEVICE_REVOKED` → wipe that business's local data; `CLOCK_OUT_OF_RANGE` → update the clock offset and retry once; 5xx → keep and retry later; `OP_ID_CONFLICT` → "Needs attention: tell the developer").
4. **Endpoints**, grouped (accounts, devices, team, sync, reports, export, business, practice). For each: method and path; who may call it; **signed or not**; request fields (type, required or optional, limits, allowed values) with an example JSON; response with an example JSON; every error it can return; rate limit; and "Available since BE…".
5. **Sync operations:** every push operation type (`sale.create`, `correction.create`, `repayment.create`, `openingDebt.create`, `stock.create`, `stockCount.create`, the `….upsert` types, reversals…) with its payload fields and an example; who may send it; the results it can get (`saved`, `duplicate`, `rejected` with its codes, including `OP_ID_CONFLICT`).
6. **Pull rows:** every record type a pull can return, with its fields and an example row, and **which fields or rows each role receives** (from the server plan's "Who sees what"): for example, `saleItems.unitCostMinor` only for the owner; associates receive only their own sales.
7. **Enums and flags:** every allowed value (payment methods, stock movement types, removal reasons, correction reasons, flags such as `belowZeroOnArrival`, `olderPrice`, `refundCheck`, `countCheck`) with the words the app should show.

**Rules:**

- Examples use made-up data and **never** real values, secrets, tokens or keys.
- Nothing in `api.md` that the server doesn't do, and nothing the server does that `api.md` doesn't say. **`npm run check:api-docs`** (written in BE1) compares the Express routes and the registered sync operation types with the headings in `api.md`, and fails if any is missing on either side; it runs with `npm test`.
- If the app plan and `api.md` disagree about a request or response, `api.md` wins, and I'm told so the plan can be corrected.
- The Postman collection follows `api.md` (same endpoints, same examples).

---

## Endpoints

All under `/api`, all scoped to the signed-in business. The exact shapes go in `docs/api.md`.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /health` | Anyone | Server and database status |
| `POST /auth/signup` | Anyone | Create business, owner (name, phone number, **email**, password, language, `acceptTerms`) and first shop; sends the confirm-email link |
| `POST /auth/signin` | Anyone | Sign in with `{ login, password }`, where `login` is a phone number or an email |
| `POST /auth/signout` | Signed in | Clear the cookie |
| `GET /auth/me` | Signed in | User, email and whether it's confirmed, businesses (real and practice) with role, language, terms status, pending invitations |
| `POST /auth/invitations/:membershipId/accept` · `…/decline` | Signed in (the invited person) | Answer an invitation to join a business |
| `POST /auth/change-password` | Signed in | Change password (required on first sign-in for staff); ends other sign-ins |
| `GET /legal/current` · `POST /auth/accept-terms` | Anyone · Signed in | The current privacy notice and terms (version, English and Twi); record acceptance |
| `POST /auth/confirm-email/send` · `POST /auth/confirm-email` | Signed in · Anyone | Send the confirm link again; confirm with `{ token }` |
| `POST /auth/forgot-password` · `POST /auth/reset-password` | Anyone | `{ login }` → same answer always; `{ token, newPassword }` → sets it, ends every sign-in |
| `PATCH /auth/me` | Signed in | `{ language }`: the person's own app language (the business's default language for customers is a business setting, changed with `settings.update`) |
| `PATCH /auth/me/phone` · `PATCH /auth/me/email` | Signed in | Change phone number or email, with `currentPassword` |
| `GET /team` | Owner | List members |
| `POST /team` | Owner | Add a staff member (name, phone number, role, email optional; returns a temporary password once) |
| `PATCH /team/:membershipId` | Owner | Change role |
| `POST /team/:membershipId/reset-password` | Owner | New temporary password, shown once; `mustChangePassword`; bumps their `sessionVersion` |
| `DELETE /team/:membershipId` | Owner | Remove a staff member from this business, or cancel an invitation (end the membership; their access here ends on the next request; from BE5 their devices for this business are revoked too) |
| `GET /export/:kind.csv` | Owner | Download records: `products`, `customers`, `sales?from=&to=`, `repayments?from=&to=`, `expenses?from=&to=` |
| `POST /business/close` · `DELETE /business/close` | Owner | Close the business (`currentPassword`, `confirmName`); cancel within 30 days |
| `POST /practice/open` · `POST /practice/reset` | Signed in · Owner | Create the practice shop if it doesn't exist yet (with the team's memberships and the sample data) and return its id · delete its records and load the samples again |
| `POST /devices/challenge` · `POST /devices` | Signed in | Get a one-time challenge · register this phone with its public key, the signed challenge and the current password; receive its `deviceCode` |
| `GET /devices` | Owner | List the business's phones (name, person, last seen, active) |
| `DELETE /devices/:deviceId` | Owner | Revoke a phone (lost or stolen) |
| `POST /sync/push`, `GET /sync/pull` | Signed in | Sync |
| `GET /reports/day?date=` | Owner, manager | Daily summary (profit fields owner only) |
| `GET /reports/reminders` | Owner, manager | Customers due a reminder today |

The phone calculates most screens from its local copy; report endpoints exist so the owner sees **all staff's** figures, including records not yet on her phone.

---

## Testing

| Kind | Tool | What it covers |
|---|---|---|
| Unit | Jest | Money and quantity maths, sale invariants, phone normalisation, receipt-number format, role filtering of a row |
| API | Jest + Supertest, and Postman | Every endpoint: success, validation errors, wrong role, wrong business |
| Isolation | `npm run test:isolation` | Two businesses; every endpoint and sync operation tried with the other's IDs → 404 or rejected |
| Everything | `npm run test:all` | `npm test` (everyday unit and API tests), then `test:isolation`, then `test:sync`. **Must pass for every task's Done when** |
| Sync torture | `npm run test:sync` (BE5.5) | Repeats, lost responses, ordering, concurrency (below) |
| Consistency checks (read-only) | `npm run check:balances`, `check:stock`, `check:receipts`, `check:sequences`, `check:operations` | Rebuild from the permanent records and report any difference, **without changing anything**: every customer's balance and `oldestUnpaidAt` (debts brought forward included); stock per size against the movements; receipt registry rows with no record, or records with no registry row; sequence numbers missing or used twice; `ProcessedOperation` rows that point at nothing. Run after tests, after a restore, and weekly in production. A repair (for example rebuilding the cached balances) is a **separate** support script, logged, and only after a backup |
| Accounts | Jest + Supertest | Sign-in by phone and by email; forgot password gives the same answer for real and unknown accounts; a used or expired token is refused; a reset ends other sign-ins; emails are written to the log in tests, never sent |
| Concurrency | `npm run test:concurrency` | The simultaneous-transaction cases in "Concurrency and database safety", 20 repeats each |
| Money rules | Jest (unit) | Debt and credit lots (the worked example and its variations), the three return cases with their exact numbers, refunds never above what was paid, oldest credit used first, reversals (once only, never of a reversal, both drop out of the rebuild), the same records pushed in **shuffled orders** giving identical lots and allocations, price versions and cost from the version, stock counts absorbing late sales |
| Device signing | Jest + Supertest | Enrolment without the password, without a valid challenge, with a reused challenge, or with a challenge signature that doesn't match the public key is refused; a stolen cookie alone can't enrol a key; an existing device ID can't be enrolled again with another key; a valid signature passes; a changed body, path, business or timestamp fails; a reused nonce fails, also when two copies race; a wrong phone clock passes after the app's offset correction; a revoked device fails; a signature without a valid session fails |
| Recovery | `npm run test:recovery` and BE14 drills | The server process killed in the middle of a sale (nothing half-saved; the retry saves it once); MySQL restarted during a batch; a migration that fails halfway on a copy of the data (rolled back or fixed forward, written down); restore from backup, then all five checks pass |

Test scripts create their own test businesses and delete them afterwards; they never touch real businesses.

#### Failure recovery cases (part of BE5.5 and later tasks)

- The same push sent twice, and the same push sent while the first is still running → saved once.
- The server saves but the response is lost → the retry gets `duplicate`, nothing doubles.
- A batch where operation 3 of 10 is invalid → 9 saved, 1 rejected.
- The database stops halfway through a batch → finished operations stay saved; the one that failed has **no** `ProcessedOperation` row and no partial effect, and is retried as new (never stored as a rejection).
- The same `opId` sent with a changed payload, type or device → that operation `rejected` with `OP_ID_CONFLICT` in a 200 answer, nothing applied, and the other operations in the batch still saved.
- Two copies of the same operation pushed at the same moment (`Promise.all`) → exactly one effect; the other answer is `duplicate`.
- Two phones with receipt numbers that clash (a forced test) → one saved, one `RECEIPT_NUMBER_TAKEN`; a sale, a correction and a repayment can never share a number.
- A pull scanning rows the user can't see (for example an associate and another associate's sales) → the cursor still moves on; a page of only hidden rows never makes the phone ask again forever.
- Rows committed **while** a pull is paging → appear in the next pull, never skipped.
- Removing someone from one business → they're refused there and stay signed in to their other businesses (for example the practice shop).
- A late offline credit sale with an earlier date than a repayment already saved → the customer's balance and `oldestUnpaidAt` come out the same as if they had arrived in date order.
- Two phones push edits to the same product → the last received wins; both versions are in `ChangeLog`.
- Two phones return the same item offline → one saved, one rejected.
- A removed member and a revoked device push and pull → 403 with the right code.
- Pulls with role filtering follow **Who sees what** for every record type and role (a test per row), never return a cost field to a manager or associate, and never another associate's sale to an associate.
- A deadlock forced during a sale is retried and the sale exists **once** (one receipt registry row, one set of stock movements).
- Paging through 2,000 rows with `limit=500` returns each row exactly once.

---

## Security checklist (checked in BE14, and after any task touching auth or sync)

- [ ] Every query on business data is scoped by `businessId` from the database (isolation test passes).
- [ ] No update or delete calls exist for permanent-record models (search the code).
- [ ] No cost or profit field in any non-owner response or pull.
- [ ] Passwords hashed with argon2id; common passwords refused; sign-in errors identical for unknown phone and wrong password.
- [ ] Sessions: idle 30 days, absolute 90 days, `sessionVersion` checked on every request.
- [ ] Rate limits active on sign-in, sign-up and sync.
- [ ] CSRF header required; CORS only for `CLIENT_URL`; security headers present; body limit set.
- [ ] Error responses contain no stack traces or SQL; 500s show a request ID.
- [ ] Logs contain no passwords, tokens, cookies, bodies or customer phone numbers.
- [ ] `.env` not committed; `.env.example` complete; the database CA certificate kept outside the project folder.
- [ ] Revoked devices and removed members are refused and their phones wiped.
- [ ] Email tokens are stored only as hashes, work once, expire, and forgot password never reveals whether an account exists.
- [ ] The `X-Business` header can only choose among the user's own memberships (isolation test tries another business's id).
- [ ] Data is only ever deleted by `deleteBusinessData` (closed after 30 days, or a practice shop); search the code for other deletes.
- [ ] Sentry receives no bodies, cookies, emails or phone numbers.
- [ ] Composite foreign keys exist for references between business tables (read the migrations, and the isolation test tries a cross-business reference straight in the database).
- [ ] POST, PATCH, PUT and DELETE with a foreign `Origin` are refused.
- [ ] Sync and editable updates accept only listed fields; memberships, roles and devices can't be changed through sync.
- [ ] All five consistency checks report nothing wrong on the test data and after the restore test.
- [ ] Every business route checks the device signature, timestamp and nonce after the session; a device ID alone never grants anything.
- [ ] The app sends a strict Content-Security-Policy (scripts only from its own origin) and the device-key limits are written in `docs/guide.md`.
- [ ] `test:concurrency` passes three runs in a row; every data-changing operation goes through `runOperation`; the `CHECK` constraints exist in the migrations.

---

## Backups and restore

- Check what Aiven's free plan backs up and for how long, and write it in the README. Don't count on it alone.
- A **manual export** script (`npm run backup`) writes a dated SQL dump **outside the project folder** (it contains business data, so never inside the repository), **encrypted with `age`** (the key kept offline, as on Agyefam), with file permissions for your user only, to be run weekly and before every migration in production. One copy also goes off the laptop (a private, encrypted cloud folder), and dumps older than 8 weeks are deleted.
- Before real shops rely on it, move to a paid database with point-in-time restore (Free-tier hosting).
- **Restore is tested:** in BE14, restore a backup into a fresh local database, run all five consistency checks, and sign in as a test user. A backup that has never been restored doesn't count.

---

## Decisions (short ADRs)

| # | Decision | Why |
|---|---|---|
| ADR-1 | Phone-made UUIDs and `opId`s, with a `ProcessedOperation` table | Phones save offline; retries must never double a record |
| ADR-2 | Permanent records are insert only; mistakes are corrections | A trustworthy history; matches the shop's rule that a sale can't be undone |
| ADR-3 | Editable records: last change received wins, with `ChangeLog` | Simple and predictable; conflicts are rare and the history shows them |
| ADR-4 | One per-business `serverSeq` for pulls | One cursor per phone; no missed or repeated rows |
| ADR-5 | Receipt numbers made on the phone (`deviceCode-number`) | Receipts must work offline; server-made numbers would need the network |
| ADR-6 | Never refuse a sale for short stock; flag it | The goods have already left the stall; refusing would lose a real sale |
| ADR-7 | Cached customer balance updated in the same transaction, rebuilt from debt lots and allocations in one fixed order (ADR-20) | Associates see correct balances without receiving everyone's sales; late offline records give the same answer as on-time ones |
| ADR-8 | Same-site `/api` through the Vercel rewrite | HTTP-only cookies work on every phone browser |
| ADR-9 | Deploy the server in BE1 and the app in FE1, not at the end | On Adorn, problems with environment variables, cookies, CORS and seeders only appeared on the live site; finding them on day one is cheap |
| ADR-10 | argon2id for passwords, Jest + Supertest for tests | The same choices as Agyefam: argon2id is the current recommendation for password hashing; Jest is the test tool already learned |
| ADR-11 | Sign in by phone number or email; reset by email link; the owner resets staff; support tool as a last resort | A forgotten password must never lock a business out, and recovery must cost nothing (backlog F-3, F-18) |
| ADR-12 | A practice shop is a second business with `isPractice`; the phone keeps one local database per business | Reuses isolation, roles and sync unchanged; training records can never mix with real ones (F-24) |
| ADR-13 | Support tools are command-line scripts, not routes | Nothing on the internet can reset an owner's password; every use is logged in `SupportAction` (F-25) |
| ADR-14 | **Kept:** receipt numbers made on the phone, now checked by one receipt registry. **Rejected:** server-made receipt numbers (proposed in the "Unified Engineering Plan", 1 Nov 2026) | A trader must be able to give a receipt with no internet (backlog F-13). The registry gives the same protection against a number being used twice, across sales, corrections and repayments |
| ADR-15 | **Adopted (revised 1 Nov 2026):** every business request is signed with a non-extractable ECDSA P-256 key made on the phone, with server-corrected timestamps and a nonce | A device ID is an identifier, not proof: without a key, a cookie copied off a phone could be used from another machine. The earlier worry (wrong phone clocks) is solved by signing with the server's time. Its limits are written down honestly: it doesn't stop malicious script inside the app, so a strict CSP stays essential |
| ADR-16 | Composite foreign keys `(businessId, id)` between business tables | The database itself refuses a cross-business reference, as a second line behind the code |
| ADR-17 | Same `opId` with a different payload is a conflict (a per-operation `rejected` result with `OP_ID_CONFLICT`, never an HTTP 409 that fails the batch), not a duplicate; temporary failures are never stored as rejections | A phone bug is caught instead of hidden, and a database hiccup never turns a good sale into "Needs attention" |
| ADR-18 | Pulls use a watermark and the cursor is the last **scanned** sequence number | No row is skipped while others are saving, and filtering by role never makes a phone loop |
| ADR-19 | Removing a member, revoking a phone or closing a business doesn't sign the person out everywhere | People can belong to more than one business (the practice shop); each request checks that business's membership, device and status anyway |
| ADR-20 | **Adopted (revised 1 Nov 2026):** debt lots and allocations as server-made projections, rebuilt per customer in one fixed order | A balance can add up while the history of which debt was paid is wrong. Returns must reduce their own sale's debt, and repayments the oldest; credit is its own lot, used oldest first. The order key uses only values stored on the records, so the result doesn't depend on arrival order. They're projections, never facts: `check:balances` rebuilds them from the permanent records |
| ADR-21 | Returns settle debt first, then money back up to what was paid, then credit or no refund; the parts must add up exactly | Nobody gets cash for goods still owed, and the same money is never refunded twice (backlog Decision 3-10) |
| ADR-22 | One global lock order for every operation (`runOperation`), deadlock retries, and `CHECK` constraints | Simultaneous requests can't corrupt balances or stock, and the database refuses impossible rows even if the code is wrong |
| ADR-23 | Prices and cost kept per version (`PriceVersion`); sale lines name the version the phone used | The server can check an offline sale's price and find its cost without trusting the phone, even after the price changed |
| ADR-24 | A stock count records what was on the shelf and becomes the starting point; the difference is worked out, not stored | A count made on a phone that hadn't yet received another phone's sale still gives the right stock, and the loss figure corrects itself when late records arrive |
| ADR-25 | Reversals are full, once only, never of a reversal; the right amount is a new record | No partial or chained corrections, so "what's in effect" is never ambiguous |
| ADR-26 | Enrolling a device key needs the current password, a one-time challenge signed with the new key, and an unused device ID | A stolen cookie alone can't add an attacker's key |

| ADR-27 | **International by design, Ghana first** (BE4.5, Decision F-27): reference tables for countries, currencies, languages and payment methods; money in whole minor units (`…Minor`) with decimals from the currency table and a money formatter written in the project; phones in E.164 read with a per-country table; business days in the business's time zone; open language tags with English fallback; country, currency and time zone locked after the first money record | Other countries can be added as data once their legal texts, payment methods and translations exist, without migrating money data; launch stays Ghana-only |

New decisions are added here when a task makes one.

---

## Tasks

Each task: explain the plan first, wait for approval, build, check **Done when**, update `docs/api.md` (as in "The API contract for the frontend": a task isn't done until the app side could use what it built from `api.md` alone) and `docs/guide.md`, then stop.

### BE0 — Before starting

**Done by me, not Claude Code:** Node 26 (through `nvm`), MySQL 8 and MySQL Workbench, Git, Postman. I create the GitHub repository (`main` and `dev`) with the structure above, and the accounts for Render, Aiven, Vercel and Brevo. If they're already used for another project, either sign up with a separate email in a private window (not with "Sign in with GitHub or Google", which opens the existing account) or create a new workspace or project in the existing account.

### BE1 — Project setup (F1)

**Part A (local):** Express 5 app, environment variables checked with Zod at start-up, Sequelize config (local and production with SSL), migrations folder, the error format, request IDs and the JSON logger, security headers, body limit, CSRF checks (`X-Requested-With`, and `Origin` on POST/PUT/PATCH/DELETE), CORS, `trust proxy`, rate-limit setup, Jest + Supertest set up with one example test, `GET /api/health`, the first version of `docs/api.md` (conventions, errors, `/health`) and `npm run check:api-docs`, `.env.example`, `.nvmrc`, README skeleton.

**Part B (first deploy; I do it myself):** Claude Code writes no deployment guide. It only makes sure the code is ready: `.env.example` lists every variable, the database config reads the CA certificate from a path or from an environment variable holding its text (so it never goes into GitHub), the `db:migrate:production` and `db:migrate:status:production` scripts (which print the database host and stop if `.env.production` isn't loaded; only I run them), and the one-time `LOG_PROXY_CHAIN` log line for measuring `trust proxy` (Free-tier hosting). I deploy (Aiven, Render, migrations) and paste back the health output and log lines.

**Proxy hops, measured twice.** The app on Vercel only exists from FE1, so in BE1 the phone reaches Render **directly**: measure that chain now and set `TRUST_PROXY` from it. **After FE1's first deploy**, come back to this project for a short re-check: I turn `LOG_PROXY_CHAIN=true` on once more, open `/api/health` through the Vercel address from my phone on mobile data, Claude Code tells me the new `TRUST_PROXY` value from the pasted log line, I set it and turn the logging off, and the README's hop count and date are updated. Because the `onrender.com` address stays reachable directly, the re-check also confirms what `req.ip` is for a direct request with a forged `X-Forwarded-For` (the BE14 test), and if the two paths can't both be handled safely, Claude Code stops and proposes the fix before I change anything. `CLIENT_URL` is set to the Vercel address I plan to use, and updated at the same time if it changes.

**Done when:** health returns 200 `{"status":"ok","database":"ok","version":"…"}` locally (and 503 `down` with MySQL stopped) **and on Render**; (the Render items are checked from the results I paste) unknown routes return the error format; a POST without `X-Requested-With`, or with a foreign `Origin`, gets 403; every response has `X-Request-Id` and the security headers; starting with a missing environment variable stops with a clear message; `npm test` runs; production logs show the phone's real IP, not a proxy's, for the direct path (the Vercel path is checked in the re-check after FE1).

### BE2 — Accounts (F2)

Migrations and models for Business, BusinessSettings, User, Membership, Location, EmailToken, each business table with its `(businessId, id)` unique key and composite foreign keys from the start. Sign-up (business + its settings + owner + first shop in one transaction; name, phone number, **email**, password, language, terms accepted), sign-in by **phone number or email**, sign-out, `me`, change password, sessions with `sessionVersion` and both lifetimes, phone and email normalisation, terms (`GET /legal/current`, `POST /auth/accept-terms`, 403 `TERMS_REQUIRED`), rate limits.

**Email delivery after commit:** there's no outbox. Every account email can be sent again by an **idempotent resend** ("Send the link again" for confirm and change email; asking again for a reset link; the closing notice is repeated on the owner's closing screen, which works without email). A send failure is logged (no address) and sent to Sentry. Nothing important depends on an email arriving.

**Email (this task, F10):** the email adapter (Brevo HTTPS API; in tests emails are kept in memory, in development only the whole email with its link is printed in the terminal, in production only the template name and user ID are logged; `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `APP_URL` for links (the app's address; normally the same value as `CLIENT_URL`, which is used for CORS and the `Origin` check; both are kept, with that note in `.env.example`), checked by the Zod environment check in production), the English and Twi email templates (confirm email, reset password, email changed), one-time tokens, confirm email, forgot and reset password, change phone number, change email. Emails are sent **after** the database transaction commits. Where the change has already been saved (sign-up, change email), a send failure doesn't fail the request: it succeeds with `"emailSent": false`, and the app shows **Send the link again**. Only **Send the link again**, where sending is the whole job, answers 502 `EMAIL_NOT_SENT` ("Couldn't send the email. Try again later"). Forgot password always gives the same answer, whatever happens. Nothing is lost. **Transactions:** this task adds `runTransaction(fn)`, the only place that opens a transaction (with the deadlock retry); sign-up uses it, and BE5's `runOperation` is built on it.

The privacy notice and terms are Markdown files in `legal/` (English and Twi, with a version number); write a plain first draft for me to check, marked **[DRAFT: to be checked]**.

**Done when:** sign-up and sign-in work with a phone number and with an email; passwords are stored as argon2id hashes; a password under 8 characters or on the common list is refused with a clear message; a wrong password, an unknown phone number and an unknown email all give the same message; a changed password signs out other sessions; a token older than 90 days is refused even if recently renewed; sign-up without accepting the terms is refused; the confirm link confirms the email once; forgot password answers the same for real and unknown accounts and sends nothing to an unconfirmed email; a reset link works once, expires after 30 minutes and ends every other sign-in; changing a phone number or email needs the current password and refuses one that belongs to someone else; in tests, emails go to the log and nothing is sent.

### BE3 — Team (F3)

`requireAuth` (re-reads membership on every request; picks the business from the **required** `X-Business` header among the user's own active memberships: missing → 400 `BUSINESS_REQUIRED`, a business they're not in (or only invited to) → 404, an ended membership → 403 `ACCESS_REMOVED`, a closing business → 403 `BUSINESS_CLOSING`, a temporary password not yet replaced → 403 `PASSWORD_CHANGE_REQUIRED`, terms → 403 `TERMS_REQUIRED`) and `requireRole(...)` middleware. Add (email optional), change and remove staff; temporary passwords (shown once, stored only as a hash, never logged or in ChangeLog, `mustChangePassword`); **a phone number that already has an account is invited, not created**: a pending membership the person accepts or declines at their next sign-in (`GET /auth/me` lists invitations; accept and decline endpoints); the owner sees only the name and number they typed and "Waiting for them to accept", never that account's own name or email, and the add answer has the same shape either way (only `temporaryPassword` is null); **the owner resets a staff member's password** (new temporary password, all their sign-ins end), refused with 403 `RESET_NOT_ALLOWED` if the person has an active membership in another real business (it would let this owner sign in as them there); staff accept the terms at first sign-in; the single-owner rule; removing a member ends their membership (their access to **this** business ends on the next request, without touching `sessionVersion`, ADR-19); rate limits on adding and resetting (Security); the `ChangeLog` table is created here and records every team change.

**Done when:** a manager or associate calling team endpoints gets 403; a removed member's next request to that business gets 403 `ACCESS_REMOVED`, while their session still works for any other business they belong to; after the owner resets a staff member's password, their old sign-ins stop working and they must choose a new password; an `X-Business` value for a business the user isn't a member of gets 404, and a missing one 400; an invitation reveals nothing about the existing account and can be accepted or declined only by the invited person.

### BE4 — Business isolation tests (F4)

A shared `scopedQuery` helper and `test:isolation` with **two businesses** that tries every endpoint against the other business's IDs (extended by every later task). A short write-up in `docs/guide.md` of the composite foreign key pattern every later migration follows.

**Done when:** every cross-business attempt returns 404, and the script is part of `npm run test:all` (through `test:isolation`; decided 9 Nov 2026, when `npm test` became the fast everyday run); inserting a row that points at another business's record straight in MySQL fails because of the composite foreign key.

### BE4.5 — International-ready, Ghana first (F-27)

Reference tables in `src/locale/` (countries, currencies, languages, payment methods; **launch: GH only**: GHS with 2 decimals and `GH₵`, `Africa/Accra`, English and Twi, cash and `mobile_money` shown "MoMo"; the structures stay open, the tables hold only these). `Business.country`, `currency`, `moneyRecordedAt`; open language tags instead of `en|tw`; phones in **E.164** with a per-country table (no library); `…Minor` naming for money (`defaultCreditLimitPesewas` → `defaultCreditLimitMinor`); `BusinessSettings.paymentMethods`; the money formatter (symbol, non-breaking space, minor units, grouping; integers only); `GET /api/reference`; `me.businesses[]` gains `country`, `currency` (code, symbol, minor units, writing rules), `timezone`, `defaultLanguage`, `paymentMethods`, `localeLocked`; sign-up takes `country` (default GH), sign-in, forgot password and change phone take an optional `country` for reading local numbers; `PATCH /api/business/locale` (owner) with **409 `CURRENCY_LOCKED`** once money is recorded; the payment-method check **`PAYMENT_METHOD_NOT_ENABLED`** (built and tested here, returned by sales and repayments from BE8/BE9). Existing businesses become GH / GHS / Africa/Accra with cash and mobile money in a guarded migration. Not now: other countries, languages, legal variants, units (metre).

**Done when:** a sign-up without a country makes a Ghana business with GHS, Africa/Accra, cash and mobile money; `me` carries those locale facts; a country or language not in the tables is refused; phones are stored in E.164 and the database refuses any other form; money is written "GH₵ 120.00" from whole pesewas only; the locale can't change after the first money record; the isolation test covers the new business endpoint.

### BE5 — Sync server (F5a)

Built in two parts, each tested before the next: **Part A** devices and signing (`Device`, `DeviceChallenge`, `DeviceRequestNonce`, registration, the signature middleware on every business route, `X-Server-Time`, the phone list and revoking, removing a member revokes their phones; `403 DEVICE_NOT_REGISTERED` for an unknown device; a command-line signing script for test keys, `npm run dev:sign`, refusing production); **Part B** sync (`SyncSequence` and `takeSequence`, `ProcessedOperation`, `ReceiptNumber`, `runOperation` with a savepoint so a stored rejection undoes its partial writes, push, pull, `settings.update`, `check:sequences`, `check:operations`; a temporary failure answers the push with a 5xx and stops the batch, so the phone retries and finds what was saved as `duplicate`).

**Removing a member (BE3) also revokes their devices for that business** (in the same transaction). `SyncSequence`, `serverSeq` on synced tables, `ProcessedOperation` (with `payloadHash` and `resultJson`), the `ReceiptNumber` registry table (used from BE8), the `runOperation` helper with the global lock order and deadlock retry (Concurrency and database safety), **device signing** (`DeviceRequestNonce`, the signature middleware on every business route, `X-Server-Time` on every response; Devices in Security), Device (enrolment with `POST /devices/challenge`, the public key, proof of the private key and the current password; `DEVICE_ID_TAKEN`; list, revoke, device codes; a phone registers once **per business** it works in, so its practice shop has its own device code and receipt counter), `POST /sync/push` (framework, insert-first idempotency, `OP_ID_CONFLICT`, temporary failures never stored, per-operation transactions and results), `GET /sync/pull` (watermark, cursor = last scanned number, role filtering, `ACCESS_REMOVED`, `DEVICE_REVOKED`, `BUSINESS_CLOSING`), `ChangeLog` with `baseVersion` conflicts. The first real operation is `settings.update` on `BusinessSettings` (owner only).

**Done when:** pushing the same operations twice saves once; the same `opId` with a changed payload gets a per-operation `rejected` / `OP_ID_CONFLICT` while the rest of the batch is saved; a forced database error leaves no `ProcessedOperation` row and no partial change; a pull with a cursor returns only newer rows; an associate's pull has no cost fields and no other associate's sales, and their cursor moves past hidden rows; a revoked device gets 403 `DEVICE_REVOKED`; the device-signing tests (Testing) pass, including a request copied with a valid cookie but no key, which is refused.

### BE5.5 — Sync torture test (server)

`npm run test:sync`: scripts that act as several phones against a local server and run the **failure recovery cases** above (those possible before sales exist; the rest are added in BE8, BE9 and BE10), including a run of **1,000+ records** paged through with a steady memory use, and `check:sequences` and `check:operations` afterwards. Run concurrent pushes with `Promise.all`.

**Done when:** every case passes three runs in a row, and the guide explains each case in plain words. **No app sync work (FE3) starts until this passes.**

### BE6 — Products, sizes and prices (Epic 1)

`product.upsert` and `size.upsert` (each accepted change writes its `PriceVersion` row, and its stored result includes the new version so later sales can refer to it by `editOpId`) with all Epic 1 rules: duplicate product names and size labels **warned, never rejected** (`PRODUCT_NAME_DUPLICATE`, `SIZE_LABEL_DUPLICATE`, decided 8 Nov 2026), size ranges stored as data, prices per size, warnings returned (not errors) for wholesale above retail or price below cost, cost fields owner-only (managers' products arrive without cost), hiding instead of deleting, ChangeLog entries.

**Done when:** every Epic 1 acceptance criterion that applies to the server passes, including cost prices never appearing in a manager's or associate's pull; the BE5 pull role-filter test is extended with product and size rows, **including the prices inside them**: a manager's and an associate's rows have **no cost field** (`costMinor` and anything derived), the owner's have it (`PriceVersion` is server-only and never pulled); two phones adding the same product name are **both saved and both usable for sales** (each has its own ID and its version-1 `PriceVersion` row), the later one warned with the other's ID.

### BE7 — Stock movements (Epic 2)

`stock.create` for opening, restock (quantities only; cost stays on the product, Decision 2-1), removal (a reason from the list; "other" needs a note), and **`stockCount.create`** (`countedUnits` with the phone's baseline; a reason when it differs from the baseline; stock on hand and the count difference by the count rule in Calculated, with the `countCheck` flag). Half-yard units, stock on hand per size, the business low-stock level and per-product levels (Decision 2-2), removals and counts in the day report data, an index on `(businessId, productId, sizeId)`. Owner and manager only (F-17).

**Done when:** every Epic 2 acceptance criterion that applies to the server passes; stock equals the sum of movements; 2.5 yards is stored as 5 units; a removal without a reason, or "other" without a note, is rejected; a removal that arrives after another phone's sale and takes stock below zero is saved and flagged; the count example in Calculated gives stock 8 and a difference of +1; a sale recorded before a count but received after it doesn't change stock on hand; `check:stock` rebuilds every size with the count rule; an associate's stock operation is rejected (Decision F-17). Also (moved here from BE6, which has no stock yet): **starting stock** (Epic 1 AC5) is an `opening` `stock.create` the phone pushes right after the product's `product.upsert` and `size.upsert` operations, with the owner's or manager's name and date; **a size that still has stock can't be removed**: `size.upsert` with `isActive: false` is rejected `SIZE_HAS_STOCK` with "This size still has X in stock." (Epic 1 AC11); and **changing a product between yards and another unit** (`unitScale` 2 ↔ 1) is rejected `UNIT_LOCKED` once the product has any stock movement, because its stored quantities would change meaning.

### BE8 — Sales (Epic 3)

`sale.create` with items, payments and stock movements in one transaction (a payment-method code that doesn't exist is rejected `PAYMENT_METHOD_UNKNOWN`; a real method the business has switched off is **saved and flagged `methodDisabled`** (decided 9 Nov 2026); the business's first money record sets `Business.moneyRecordedAt` in the same transaction, which also applies to repayments, debts brought forward, write-offs and expenses in BE9 and BE11): the **sale invariants**, **sale prices by version** (Sale prices, older versions and cost: set price checked against `PriceVersion`, `editOpId` references, cost set by the server, `PRICE_VERSION_MISMATCH`, `UNKNOWN_PRICE_VERSION`), receipt numbers from the phone written to the `ReceiptNumber` registry in the same transaction, sale lines keeping copies of the name, size, unit and `unitScale`, price notes, cash/MoMo (split allowed)/credit/part-paid, balance update, and flags: negative stock, clock skew, after day close, **over credit limit** (never a rejection, Decision 3-3), **below cost** (Decision 3-1; from the version's cost, worked out on the server, owner-only), **older price** (the version used is older than the current one and its price differs, Decision 3-8). The customer model (name, phone, language, credit limit, balance) is created here for credit sales; Epic 4 completes it. No update or delete of sales anywhere. Add the sale cases to `test:sync`.

**Done when:** every Epic 3A acceptance criterion that applies to the server passes; a sale breaking any invariant is rejected with a clear code; a sale taking stock below zero, over a credit limit, below cost, or at an older price is saved and flagged; the below-cost flag never reaches a non-owner; there's no route that changes or removes a sale; `check:balances` passes after the test data; the BE5 pull role-filter test is extended with sales, sale lines and payments: **an associate receives only their own sales** (and their lines and payments), never another associate's, and **no manager or associate receives `unitCostMinor`**, the below-cost flag or any profit figure, while their cursor still moves past the rows they can't see. A sale of each of two products with the same name (added by two phones offline, BE6) is accepted. Decided 9 Nov 2026 for BE8: `customer.upsert` **creates only** (any role; editing and limits in BE9); `check:balances` is the simple version (balance = Σ credit of the customer's sales, `oldestUnpaidAt` = the oldest), replaced by the lot rebuild in BE9; a sale's lines and payments travel **inside** its `sale` pull row; a sale of a hidden product or removed size is saved; `afterDayClose` stays `false` until BE11; the sale races are in `test:sync` (BE9 creates `test:concurrency`); `RECEIPT_NUMBER_INVALID` when the receipt number doesn't start with the phone's `deviceCode`.

### BE9 — Customers, credit and repayments (Epic 4)

`customer.upsert` (everyone may create; owner and manager may edit; credit limit owner-only; the default limit copied on creation; can't hide a customer who owes), `repayment.create` (repayment corrections by owner and manager only), `debtWriteOff.create` (owner only), **reversals** of repayments, debts brought forward and write-offs (Reversals), the default credit limit setting, the `DebtLot`, `CreditLot` and `DebtAllocation` tables and the per-customer rebuild (Calculated: targeted reductions to their own lot, repayments and write-offs oldest first, credit never negative debt) for balance and `oldestUnpaidAt`, `check:balances` (rebuilds from scratch and compares), the worked example as a test, the late-offline-record case in `test:sync`, and the repayment cases in `test:concurrency`. Credit sales from BE8 get their lots here (the rebuild creates them for any test sales already saved). **Done when, also:** the worked example gives lot A GH₵ 100.00, lot B GH₵ 200.00 after the return; credit is used by the next credit sale; the same records pushed in shuffled orders give identical lots and allocations; a GH₵ 500.00 write-off reversed and replaced by GH₵ 50.00 leaves the right balance and both records in the history; reversing twice is refused. A repayment above the balance is **saved and flagged `overpaid`**, never rejected (Decision 4-5): the phone already stopped what it could see. Add the two-phone overpayment case to `test:sync`.

**Done when:** every Epic 4 acceptance criterion that applies to the server passes; `check:balances` matches the formula above; two repayments that together exceed the balance are both saved and flagged; an associate's customer edit, repayment correction or write-off is rejected; an associate's repayment is saved and shows under their name; an associate's `stock.create` is rejected.

**Debts brought forward (Story 4.12, Decision 4-8):** `openingDebt.create` (owner and manager; `owedSince` may be in the past but not in the future; corrections reverse an earlier one with a reason). Included in the balance, `oldestUnpaidAt` (from `owedSince`), `check:balances`, and the reminders. Done when, also: an opening debt from 40 days ago makes the customer appear in reminders with "40 days"; an associate's `openingDebt.create` is rejected; a correction brings the balance back.

Roles (Decision F-17): owners, managers **and associates** may record repayments; `stock.create` other than sale movements is owner and manager only; `GET /reports/reminders` stays owner and manager.

### BE10 — Corrections: returns and exchanges (Epic 3)

`correction.create` for returns and exchanges linked to the original sale: items in (each pointing to its exact original sale line, `originalSaleItemId`) and out, stock movements, the **settlement rules** in "Returns and exchanges" (value from the original agreed prices; debt first on the sale's own lot; money back only up to what was paid for that sale minus earlier refunds; then credit or no refund; parts adding up exactly; exchanges in both directions, with `exchange_credit` lots), reason required, damaged items (a `return_in` then a `removal`, Decision 3-9), **returnability checked in the transaction** with the lock order, associates only on their own sales (Decision 3-4), the `afterReturnPeriod` flag past the business's return period (Decision 3-2), the `refundCheck` flag. Add the double-return case to `test:sync` and the return cases to `test:concurrency`.

**Done when:** an exchange of size 40 for 41 moves both stock lines; returning more than was bought (including by two phones at the same moment) is rejected; an associate correcting another person's sale is rejected; a damaged return shows as a removal; the original sale is unchanged; and these settle exactly as written in the unit tests:
- a GH₵ 200.00 sale paid GH₵ 100.00 cash and GH₵ 100.00 on credit, with nothing repaid: returning everything reduces the debt by GH₵ 100.00 and allows at most GH₵ 100.00 back;
- the same sale after the customer repaid GH₵ 60.00 of that credit (FIFO landed on this lot): the debt part is GH₵ 40.00, and at most GH₵ 160.00 can go back in cash or MoMo;
- a second return on the same line counts the first one's quantity and refunds;
- a correction recorded offline that gave cash back while the sale still had debt (another phone's records changed the figures) is **saved and flagged `refundCheck`**, never rejected, and the debt stays owed;
- every case keeps `check:balances` and `check:stock` clean.

### BE11 — Expenses and categories (Epic 6b)

`expenseCategory.upsert`, `expense.create`, and expense **reversals** (`correctsExpenseId` with a reason, in full, once, never of a reversal; Reversals).

**Done when:** expenses appear in the day's figures by cash and MoMo; a correction shows beside its original and the original is unchanged.

### BE12 — Daily summary and closing the day (Epic 6)

`GET /reports/day` (sales, cash, MoMo, credit given, debts collected, debts brought forward on their own line (never counted as sales), refunds to check (`refundCheck`, owner and manager), expenses, by person, price changes with notes, flags, records that arrived after closing; profit owner-only, marked "incomplete" when cost prices are missing) and `dayClose.create` (**one close in effect per location per day**: a later close for the same day replaces the latest one, needs a reason and `replacesDayCloseId`, owner or manager; reports use the latest and show the earlier ones; **one line per payment method the business uses** (`DayCloseLine`: expected and counted, e.g. cash and mobile money in Ghana), differences recorded per method; business days in the business's time zone).

**Done when:** the figures match hand calculations from test data; a manager's response has no profit fields; a sale arriving after the close appears under "arrived after closing".

### BE13 — Reminders (Epic 5)

`GET /reports/reminders`: customers who still owe 7 or more days after their oldest unpaid credit, and every 7 days after, with their language. (Messages are written and sent from the phone.)

**Done when:** a customer with a 7-day-old debt appears; one who has paid in full doesn't.

### BE15 — Download records and closing a business (F12, F13)

`GET /export/:kind.csv` (owner only): products with stock per size, customers with balances, sales with their items, repayments and expenses for a date range. Written by a small CSV helper in the project (no library): UTF-8 with a BOM so Excel shows "₵" correctly, amounts written in the business's currency with the server's money formatter (e.g. "GH₵ 120.00"; decimals from the currency table), and **text** cells (names, notes, descriptions: anything a person typed) starting with `= + - @`, a tab or a carriage return prefixed with `'` so Excel never runs them as formulas. **Number** cells the server produced (amounts, quantities, including negatives such as a reversal) are written as plain numbers and never prefixed. Cost columns appear only in the owner's file (she's the only one who can download).

`POST /business/close` (owner; `currentPassword` and `confirmName` must match): sets `status: closing` and `closeRequestedAt`, so every member loses access to **this** business on their next request (without touching anyone's `sessionVersion`, so other businesses they belong to keep working, ADR-19), and sends the owner an email ("Your business will be deleted on [date]. Sign in and tap Cancel to keep it."). While closing, sync and every business route answer 403 `BUSINESS_CLOSING`, except `GET /auth/me`, the export and `DELETE /business/close` (cancel) for the owner. After 30 days, `npm run support:purge-closed` (a support script, BE17) deletes everything through `deleteBusinessData` and logs a `SupportAction`.

**Done when:** each CSV opens in Excel with correct amounts and "₵"; a cell typed as `=SUM(A1)` appears as text; a manager gets 403 on export; closing needs the right password and name; staff are signed out at once; the owner can cancel within 30 days; the purge script refuses a business that isn't past its 30 days.

### BE16 — Practice shop (F14)

`POST /practice/open` creates the practice shop on first use: a business with `isPractice: true` and `practiceForBusinessId`, the same team with the same roles, one shop, and sample products (a few shoes with sizes, clothing, one fabric by the yard), customers and one debt. Team changes in the real business (BE3) are copied to its practice shop. `POST /practice/reset` (owner) deletes its records through `deleteBusinessData(id, { mode: 'practice_reset' })` and loads the samples again. **Different rules from closing a real business:** a practice reset happens at once (no 30 days), works only on a business with `isPractice: true` (refused otherwise), keeps the practice business, its memberships and devices, and is recorded in the real business's `ChangeLog` (who and when). Purging a closed business uses `mode: 'purge_closed'`, needs `status: closing` for 30+ days and today's backup, removes everything including the business row, and is recorded in `SupportAction`. Practice shops are left out of support counts and never get emails.

**Done when:** every team member can open the practice shop and sync it on its own; nothing recorded there appears in the real business's reports, exports or balances; reset brings back the samples; the isolation test passes with practice shops present.

### BE17 — Support tools and error monitoring (F11)

Command-line scripts in `scripts/support/`, which Claude Code writes and tests against the local test database only; **I** run them against production from my laptop with `.env.production` (never routes, never deployed as endpoints), each asking for a `--reason` and my name, and each writing a `SupportAction`:

- `support:find --phone 024… | --email …`: shows the business, its members and roles, phone count and last sync (no customer data);
- `support:reset-owner-password --business <id> --reason "…"`: only after I've confirmed who she is in person or by phone; prints a temporary password once and sets `mustChangePassword`; ends her sign-ins;
- `support:counts`: businesses (practice shops left out), active phones in the last 7 days, records synced today;
- `support:purge-closed`: deletes businesses closed more than 30 days ago (BE15), only after confirming that a backup from today exists;
- `support:rebuild-balances --business <id>`: rebuilds the debt lots, allocations and cached balances from the permanent records after `check:balances` reports a difference, only after a backup; never changes a permanent record.

Sentry on the server (`SENTRY_DSN`; off when unset), with the privacy rules in Logging. `GET /health` also returns the app version (`APP_VERSION`), which the app's Help message includes.

**Done when:** each script refuses to run without `--reason`; every change appears in `SupportAction`; a forced error in production shows in Sentry without bodies, cookies, emails or phone numbers.

### BE14 — Production review

The server has been live since BE1 and the app since FE1. **I do the production steps; Claude Code runs only the local parts** (tests, `test:concurrency` three times, the recovery drills on a local copy). Production steps: check every environment variable is in Render's dashboard (`NODE_ENV=production`, `NODE_VERSION=26`, database with SSL and the CA certificate, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `APP_URL`, `SENTRY_DSN`, `APP_VERSION`) and nothing was pasted from a local `.env`; send a real forgot-password email to yourself from production; run all migrations on production; run the full Postman collection against production; tick the **security checklist**; do the **backup restore test** and the **recovery drills** (Testing: Recovery); run `test:concurrency` three times in a row; and note what moving off the free plans would need (Free-tier hosting).

**Done when:** production health is OK; the isolation test passes against production with test businesses; every checklist item is ticked; a backup has been restored and all five consistency checks pass on it; the recovery drills are written down with what happened; the README explains setup, deployment, restore and what to do when a check reports a difference.

**If time runs short:** BE1–BE9, BE12, BE15's download and BE17 make a usable first version; BE10, BE11, BE13, closing a business and BE16 (practice shop) can follow.
