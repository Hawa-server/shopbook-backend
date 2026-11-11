# Shop Book API (for the frontend)

The contract between the Shop Book server and the phone app. **The app uses only what this file lists.** It is written by the backend project as each server task is built, and copied unchanged into the frontend project after every backend task. If this file and a plan disagree about a request or response, this file wins (and the plan is corrected).

---

## Changes

Newest first.

- **BE8 (Sales):** sync operations **`sale.create`** (every role) and **`customer.upsert`** (create only for now; every role), pull row types **`sale`** (with its lines and payments inside; **associates receive only their own sales**; `unitCostMinor` and the `belowCost` flag owner only) and **`customer`** (everyone), **the sale rule** (line totals rounded to the nearest minor unit, halves up; set price from the version used) with shared test fixtures, sale flags (`belowZeroOnArrival`, `clockSkew`, `overCreditLimit`, `afterDayClose`, `belowCost`, `olderPrice`, `roundedLine`, `methodDisabled`), `saleId` in the owner's and managers' `stockMovement` rows. The first sale sets `localeLocked`. New push rejection codes: `SALE_TOTALS_MISMATCH`, `PRICE_VERSION_MISMATCH`, `UNKNOWN_PRICE_VERSION`, `RECEIPT_NUMBER_TAKEN`, `RECEIPT_NUMBER_INVALID`, `PAYMENT_METHOD_UNKNOWN`. New enums: `priceType`, sale flags.
- **BE7 (Stock):** sync operations **`stock.create`** (opening, restock, removal) and **`stockCount.create`** (owner and manager; associates `FORBIDDEN`), pull row types **`stockMovement`** and **`stockCount`** (everyone; associates get only the fields the stock rule needs), **the stock rule** (stock on hand, a count's difference, "check this count") with shared test fixtures, movement `flags` (`belowZeroOnArrival`, `clockSkew`), product fields `lowStockLevelUnits` and `lowStockWarnings`. New push rejection codes: `SIZE_HAS_STOCK` (removing a size that still has stock), `UNIT_LOCKED` (switching between yards and other units once there's stock). New enums: stock movement `type`, removal `reason`, count `reason`.
- **BE6 (Products, sizes and prices):** sync operations **`product.upsert`** and **`size.upsert`** (owner and manager; cost prices owner only), pull row types **`product`** and **`size`** (everyone; **`costMinor` only in the owner's rows**, absent for everyone else), push results with **`warnings`** (`WHOLESALE_ABOVE_RETAIL`, `BELOW_COST` for the owner only, `PRODUCT_NAME_DUPLICATE`, `SIZE_LABEL_DUPLICATE`: never errors), new endpoint **`GET /api/products/:productId/history`** (owner and manager), and **`sizeRanges`** in `GET /api/reference`. New push rejection codes: `NOT_FOUND`, `ID_TAKEN`, `SIZES_NOT_ALLOWED`. New enums: product `type`, `unit`.
- **BE5.5 (Sync torture test):** no change to any endpoint, operation or row type. The server's sync is now tested under repeats, lost answers, failures halfway through a batch, deadlocks, wrong phone clocks and five phones at once. What the app must do is unchanged: keep each operation's `opId` until it gets `saved`, `duplicate` or `rejected`; on a lost answer or a 5xx, send the same operations again as a **new signed request** (new nonce); on `CLOCK_OUT_OF_RANGE`, correct the clock from `X-Server-Time` and retry.
- **BE5 Part B (Sync):** `POST /api/sync/push` and `GET /api/sync/pull`, the first sync operation **`settings.update`**, the pull row types `settings`, `location`, `membership` and `device` (memberships and devices to the owner only). Per-operation results `saved`, `duplicate`, `rejected` (codes `INVALID_PAYLOAD`, `UNKNOWN_OPERATION`, `OP_ID_CONFLICT`, `FORBIDDEN`, `VALIDATION_FAILED`). Sync is limited to 120 requests per 15 minutes per person. Every synced row has a `serverSeq`; team, phone and settings changes made through other endpoints also appear in the pull.
- **BE5 Part A (Phones and signed requests):** **every business endpoint is now signed** with the phone's own key (four headers: `X-Device-Id`, `X-Signed-At`, `X-Nonce`, `X-Signature`; exact text in Conventions), except the two registration endpoints. Every response carries **`X-Server-Time`**. New endpoints: `POST /api/devices/challenge`, `POST /api/devices` (register this phone: password + signed challenge), `GET /api/devices`, `DELETE /api/devices/:deviceId` (owner). Removing a member now also revokes their phones for that business. New error codes: `DEVICE_NOT_REGISTERED`, `DEVICE_REVOKED`, `DEVICE_SIGNATURE_INVALID`, `CLOCK_OUT_OF_RANGE`, `NONCE_REUSED`, `CHALLENGE_INVALID`, `DEVICE_KEY_INVALID`, `DEVICE_ID_TAKEN`, `DEVICE_ALREADY_REVOKED`; `RATE_LIMITED` also when a phone is locked after failed signatures.
- **BE4.5 (International-ready, Ghana first):** money is described in **minor units** of the business's currency (field names end in `Minor`; GHS has 2 decimals, so `12000` = GH₵ 120.00): format it with the business's `currency` rules, not `Intl.NumberFormat`. Phone numbers are **E.164** (`+233…`). Business dates use the **business's time zone**. `language` is an open list of supported tags (launch `en`, `tw`) from the new **`GET /api/reference`** (countries, currencies, languages, payment methods with their names: mobile money is "MoMo" in Ghana). `me.businesses[]` gains `country`, `currency`, `timezone`, `defaultLanguage`, `paymentMethods`, `localeLocked`. Sign-up takes an optional `country` (default `GH`, the only one at launch); sign-in, forgot password and change phone take an optional `country` for reading local numbers. New endpoint `PATCH /api/business/locale` (owner) and error `409 CURRENCY_LOCKED`. The phone `VALIDATION_FAILED` message is now "Enter a valid mobile number, for example 024 123 4567."
- **BE4 (Isolation):** no change to any endpoint. Tests now prove that every business endpoint answers another business's IDs exactly like unknown ones (`404 NOT_FOUND`, same body), and the database refuses cross-business references.
- **BE3 (Team):** the **`X-Business` header** (required on every business endpoint), the team endpoints (`GET`/`POST /api/team`, `PATCH`/`DELETE /api/team/:membershipId`, `POST /api/team/:membershipId/reset-password`), **invitations** for people who already have an account (`me.invitations`, `POST /api/auth/invitations/:membershipId/accept` and `…/decline`). `PASSWORD_CHANGE_REQUIRED` now also applies to `confirm-email/send`, `me/phone`, `me/email`. New error codes: `BUSINESS_REQUIRED`, `ACCESS_REMOVED`, `BUSINESS_CLOSING`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `ALREADY_MEMBER`, `ALREADY_INVITED`, `MEMBER_REMOVED`, `OWNER_CANNOT_CHANGE`, `RESET_NOT_ALLOWED`. New enum: member `status`.
- **BE2 (Accounts):** sign-up (business name, owner, first shop), sign-in by phone number or email, sign-out, the session cookie (idle 30 days, absolute 90 days), `GET`/`PATCH /api/auth/me`, change password, terms (`GET /api/legal/current`, accept-terms, `403 TERMS_REQUIRED`), confirm email and "Send the link again", forgot and reset password, change phone number and email. New error codes: `VALIDATION_FAILED`, `ORIGIN_REQUIRED`, `NOT_SIGNED_IN`, `WRONG_LOGIN`, `WRONG_PASSWORD`, `TERMS_REQUIRED`, `TERMS_VERSION_MISMATCH`, `PHONE_TAKEN`, `EMAIL_TAKEN`, `INVALID_TOKEN`, `NOTHING_TO_CONFIRM`, `EMAIL_NOT_SENT`, `TRY_AGAIN`. New enums: `language`, `role`, business `status`. Email links open the app at `/confirm-email?token=…` and `/reset-password?token=…`.
- **BE1 (Project setup):** first version. Conventions (base path, `X-Requested-With`, `Origin`, `X-Request-Id`, money, quantities, times, IDs, body limit), the error format and the first error codes (`NOT_FOUND`, `CSRF_HEADER_MISSING`, `ORIGIN_NOT_ALLOWED`, `INVALID_JSON`, `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `INTERNAL_ERROR`), and `GET /api/health`. Not there yet: sign-in and the session cookie (BE2), `X-Business` (BE3), device signing headers and `X-Server-Time` (BE5).

---

## Conventions

### Base path

Every endpoint is under **`/api`** on the app's own address. In production the app on Vercel rewrites `/api/*` to the server; locally the Vite proxy forwards `/api` to the server. Always call relative paths (`/api/health`), never the server's own address.

### Request headers

| Header | When | Value |
|---|---|---|
| `X-Requested-With` | **Every** `POST`, `PUT`, `PATCH` and `DELETE` | Exactly `XMLHttpRequest`. Without it the server answers `403 CSRF_HEADER_MISSING`. Send it on every request from the shared API helper; it's harmless on `GET`. |
| `Content-Type` | Requests with a body | `application/json` |
| `X-Business` | **Every business endpoint** (marked "Business" below) | The ID of the business this request is for, from `me.businesses[].id` (the open business on the phone). Missing → `400 BUSINESS_REQUIRED`; a business the person isn't in → `404 NOT_FOUND`. The server only uses it to choose among the person's own memberships and re-reads their role every time. |
| `Origin` | Sent by the browser itself | Must be the app's own address. A request whose `Origin` is another website is refused with `403 ORIGIN_NOT_ALLOWED`. The app doesn't set this header. |

`fetch` options for every request: `credentials: "include"`, so the session cookie is sent.

### The session (sign-in)

- Signing up or signing in sets a cookie named `sb_session`: **HTTP-only** (the app's JavaScript can't read it and never needs to), `SameSite=Lax`, `Path=/api`, `Secure` in production. The app never stores a token itself.
- **Idle limit 30 days:** every successful signed-in request renews it for another 30 days (so daily syncing keeps people signed in).
- **Absolute limit 90 days** after signing in: then the person must sign in again, however active they are.
- Changing a password, phone number or email **ends every other sign-in** of that person at once; the phone that made the change gets a fresh cookie and stays signed in. A password **reset** (from an email link) ends **every** sign-in, including the phone that did it.
- When a session ends, signed-in endpoints answer `401 NOT_SIGNED_IN`. **Keep every local record and the outbox**, keep working offline, and ask the person to sign in again when there's data.
- Signing in on a phone doesn't sign out other phones (staff and owners may use more than one).

### Account endpoints and `Origin`

Sign-up, sign-in, forgot password and reset password must come from the app itself: the browser's `Origin` header must be present **and** be the app's address, otherwise `403 ORIGIN_REQUIRED` / `403 ORIGIN_NOT_ALLOWED`. The browser adds `Origin` to `POST` requests by itself; the app does nothing.

### Response headers

| Header | On | Meaning |
|---|---|---|
| `X-Request-Id` | Every response | A UUID for this request. Keep the one from the **last failed** request: the Help message ("Report a problem") includes it, and it's the same reference a 500 error shows. |
| `Cache-Control: no-store` | Every `/api` response | Don't cache API answers (the service worker must never cache `/api`). |
| `X-Server-Time` | Every response | The server's clock, integer milliseconds since 1970 (UTC). Keep `offset = X-Server-Time − Date.now()` (update it from every response) and sign with `Date.now() + offset`, so a phone set to the wrong time still signs correctly. |

### Phones and signed requests

Each phone registers **once per business** it works in (the real business and its practice shop are two registrations, with two device codes and two receipt counters), with its **own key pair**:

1. Make the key with Web Crypto: `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])`. The private key is **not extractable**; keep the `CryptoKey` in that business's local database. Make a new device ID with `crypto.randomUUID()`.
2. `POST /api/devices/challenge` → `{ challenge }`.
3. Sign the challenge **text** (its UTF-8 bytes) with the private key, and `POST /api/devices` with the device ID, a name, the public key (`exportKey("jwk", publicKey)`: `kty`, `crv`, `x`, `y`), the challenge, its signature and the person's current password. Keep the returned `deviceCode` (it starts every receipt number, e.g. `K7M-0042`).

From then on **every business endpoint is signed** (each endpoint below says "Signed: yes"). Add these four headers to the request:

| Header | Value |
|---|---|
| `X-Device-Id` | This phone's device ID for this business (lowercase UUID). |
| `X-Signed-At` | Server-corrected time: `Date.now() + offset`, integer milliseconds. |
| `X-Nonce` | 16 random bytes (`crypto.getRandomValues`) in base64url (22 characters). A new one for **every** request, retries included. |
| `X-Signature` | The signature, base64url. |

**The exact text that is signed:** these seven items, each on its own line, joined with `\n` (no trailing newline), as UTF-8:

1. the method in capitals (`GET`, `POST`, `PATCH`, `DELETE`);
2. the path **and query string exactly as sent** (no decoding, no re-ordering), e.g. `/api/sync/pull?since=120&limit=500`;
3. the SHA-256 of the **exact body bytes sent**, lowercase hex (for no body, the hash of zero bytes: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). Turn the body into a string **once**, hash that string and send that same string;
4. the device ID (lowercase);
5. the business ID (lowercase, the same as `X-Business`);
6. the `X-Signed-At` value;
7. the `X-Nonce` value.

Sign it with `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, bytes)` (that gives the 64-byte IEEE P1363 form the server expects) and send it base64url (no padding).

Example (made-up values) for `GET /api/devices`:

```text
GET
/api/devices
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
3f1c2a9e-6b7d-4c1e-9a2b-0d4e5f6a7b8c
8a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d
1794045600000
q9X2bY7mL0pQ4sTvW1zR3A
```

The server checks, after the sign-in and the business (`X-Business`): the device is this person's in this business and active, the time is within 5 minutes of its clock, the signature, and that the nonce is new. **What to do with each answer:** see `DEVICE_NOT_REGISTERED`, `DEVICE_REVOKED`, `DEVICE_SIGNATURE_INVALID`, `CLOCK_OUT_OF_RANGE` and `NONCE_REUSED` in Errors.

**Honest limits** (say so in Help, don't over-promise): the key can't be copied off the phone, so a stolen sign-in cookie is useless elsewhere. It does **not** stop malicious script inside the app from using the key; the app's strict Content-Security-Policy is what prevents that.

### Data formats

- **Money:** whole **minor units** of the business's currency, as integers. Field names end in `Minor` (`amountMinor`, `retailMinor`…). The business's `currency` (in `me.businesses[]`) says how to write it: for GHS `{ "symbol": "GH₵", "minorUnits": 2, "symbolPosition": "before", "symbolSpace": "\u00a0", "decimalSeparator": ".", "groupSeparator": "," }`, so `12000` → "GH₵ 120.00" and `120050` → "GH₵ 1,200.50" (non-breaking space after the symbol; a negative amount gets "-" in front: "-GH₵ 5.00"). **Format it with the app's own helper from these rules, not `Intl.NumberFormat`**, so every phone shows exactly the same. Never decimals or floating point; a typed "120.5" becomes `12050` by reading the digits.
- **Phone numbers:** always **E.164** in answers (`+233241234567`). Show them in the country's local form (`024 123 4567` in Ghana: the trunk prefix `0` + the national number, from `GET /api/reference`). WhatsApp links use E.164 without the `+` (`https://wa.me/233241234567`). When sending a phone number the person typed in local form, the business's country is used, or on the sign-in/sign-up screens the optional `country` field (default `GH`).
- **Languages:** tags from `GET /api/reference` (`en`, `tw` at launch). Any text not translated yet is shown in English.
- **Quantities:** whole **units** as integers, with the product's `unitScale` (1, or 2 for products sold by the yard: `5` units = "2.5 yards").
- **Times:** UTC ISO 8601 strings (`"2026-11-01T09:30:00.000Z"`). **Business dates** (a day in the shop) are `YYYY-MM-DD` in the **business's time zone** (`me.businesses[].timezone`, IANA, e.g. `Africa/Accra`).
- **IDs:** UUIDs (lower case), made on the phone with `crypto.randomUUID()` for records the phone creates.
- **JSON:** request and response bodies are JSON objects.

### Limits

- Request body: at most **1 MB** (larger: `413 PAYLOAD_TOO_LARGE`).
- Rate limits: given per endpoint below; over the limit the answer is `429 RATE_LIMITED` with a `Retry-After` header (seconds).

---

## Errors

Every error has this shape (`fields` only when there are per-field messages for a form):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Not found",
    "fields": { "name": "Enter a name." }
  }
}
```

Decide what to do from **`code`** (stable), never from `message` (wording may change; the app shows its own translated text for each code).

| Code | HTTP | Meaning | What the app should do |
|---|---|---|---|
| `NOT_FOUND` | 404, or (push result) | No such endpoint, or a record that doesn't exist **or belongs to another business** (the server never says which). As a push result: the operation edits a product or size the server doesn't have (for example an edit sent without its create). | Treat as a bug for endpoints; for a record, show "Not found". Don't retry. In a push: "Needs attention". |
| `CSRF_HEADER_MISSING` | 403 | A `POST`/`PUT`/`PATCH`/`DELETE` without `X-Requested-With: XMLHttpRequest`. | App bug: the shared API helper must always send it. Don't retry. Report via Help. |
| `ORIGIN_NOT_ALLOWED` | 403 | The browser said the request came from another website. | Shouldn't happen from the app; don't retry. Report via Help. |
| `INVALID_JSON` | 400 | The body isn't valid JSON. | App bug; don't retry. |
| `INVALID_REQUEST` | 400 | The body couldn't be read (unsupported encoding or character set). | App bug; don't retry. |
| `PAYLOAD_TOO_LARGE` | 413 | The body is over 1 MB. | Send smaller batches (sync pushes stay well under it at 200 operations). |
| `RATE_LIMITED` | 429 | Too many requests of this kind, or this phone is **locked for 15 minutes** after 20 failed signatures in 15 minutes (the owner sees it in the phone list). `Retry-After` says how many seconds to wait. | Wait and retry later; show a message only if it's a person's action (for example sign-in). |
| `VALIDATION_FAILED` | 400 | One or more fields are missing or wrong. `fields` maps each field name to a message (e.g. `{ "phone": "Enter a valid mobile number, for example 024 123 4567." }`). | Show each message under its field (translate by field and context); let the person correct it. Don't retry unchanged. |
| `ORIGIN_REQUIRED` | 403 | An account endpoint (sign-up, sign-in, forgot/reset password) was called without the browser's `Origin` header. | Shouldn't happen from the app (browsers send it). Report via Help. |
| `NOT_SIGNED_IN` | 401 | No sign-in, or it has ended (30 days unused, 90 days old, password/phone/email changed elsewhere, or signed out). | **Keep all local data and the outbox.** Show the sign-in screen when online; selling continues offline meanwhile. |
| `WRONG_LOGIN` | 401 | Sign-in failed. Always the same message, whatever was wrong: "Wrong phone number, email or password." | Show the message; let the person try again or use **Forgot password?**. |
| `WRONG_PASSWORD` | 400 | The **current** password given for a change (password, phone, email) is wrong. `fields.currentPassword` is set. | Show it under the current-password field. |
| `TERMS_REQUIRED` | 403 | The person hasn't accepted the current privacy notice and terms. | Show the terms screen (`GET /api/legal/current`), then `POST /api/auth/accept-terms`, then repeat the request. |
| `TERMS_VERSION_MISMATCH` | 409 | The terms version sent isn't the current one (they changed since the app loaded them). | Load `GET /api/legal/current` again, show them, and ask again. |
| `PHONE_TAKEN` | 409 | That phone number already belongs to an account. `fields.phone` (sign-up) or `fields.newPhone` (change phone). | Show under the field: "This phone number already has an account." Suggest signing in instead (sign-up). |
| `EMAIL_TAKEN` | 409 | That email already belongs to an account. `fields.email` (sign-up) or `fields.newEmail` (change email); no `fields` when confirming a change link. | Show the message; ask for another email. |
| `INVALID_TOKEN` | 400 | The link (confirm or reset) is unknown, already used, expired, or replaced by a newer one. | Show "This link has expired or has already been used." with a way to ask for a new one. |
| `NOTHING_TO_CONFIRM` | 409 | "Send the link again" when the email is already confirmed (or there's no email). | Refresh `GET /api/auth/me` and hide the notice. |
| `EMAIL_NOT_SENT` | 502 | "Send the link again" couldn't send the email (in the error format, unlike a hosting 502). | Show "Couldn't send the email. Try again later." Nothing was lost. |
| `TRY_AGAIN` | 503 | The database was busy (a lock conflict) even after retrying. In the error format, unlike a hosting 503. | **Temporary:** wait a moment and try again. Nothing was saved. |
| `BUSINESS_REQUIRED` | 400 | A business endpoint was called without `X-Business`. | App bug: the shared API helper must always send the open business's ID. |
| `ACCESS_REMOVED` | 403 | The person was removed from this business (or declined its invitation). | **Wipe that business's local database** (outbox included) and explain "You no longer have access to [business]". Other businesses on the phone are untouched; the person stays signed in. |
| `BUSINESS_CLOSING` | 403 | The owner has asked to close this business (BE15). | Stop syncing it. Owner: show the "Closing on [date]" screen (BE15); staff: "This business has been closed by the owner." |
| `FORBIDDEN` | 403 | This person's role in this business can't do that. | Show "Your role can't do this." Hide the action for that role. Don't retry. |
| `PASSWORD_CHANGE_REQUIRED` | 403 | The person still has a temporary password (first sign-in, or the owner reset it). | Show "Choose your own password" (`POST /api/auth/change-password`), then repeat. |
| `ALREADY_MEMBER` | 409 | The phone number belongs to someone already in this team. | Show "This person is already in your team." |
| `ALREADY_INVITED` | 409 | That person already has a pending invitation to this business. | Show "This person has already been invited." |
| `MEMBER_REMOVED` | 409 | The membership has ended (removed, declined or cancelled). | Refresh the team list. |
| `OWNER_CANNOT_CHANGE` | 409 | The owner's own membership can't be changed, removed or reset from the team screen. | Don't offer these actions on the owner's row. |
| `RESET_NOT_ALLOWED` | 403 | The owner tried to reset the password of someone who also belongs to another business. | Show "This person also uses Shop Book with another business. They can reset their password by email, or ask for help." |
| `CURRENCY_LOCKED` | 409 | The business already has money records, so its country, currency and time zone can't change. | Show "These can't change once money has been recorded." Hide the edit once `localeLocked` is `true`. |
| `DEVICE_NOT_REGISTERED` | 403 | This phone isn't registered for this person in this business (no or unknown `X-Device-Id`, storage cleared, reinstalled). | Register this phone again (`POST /api/devices/challenge`, then `POST /api/devices`, asking for the password), then repeat the request. Keep the outbox. |
| `DEVICE_REVOKED` | 403 | The owner removed this phone (lost or stolen), or the person was removed from the business. | **Wipe that business's local database** (outbox included) and explain "This phone was removed from [business]". The person can sign in and register again on a new phone (a new device). |
| `DEVICE_SIGNATURE_INVALID` | 401 | The signature doesn't match (wrong key, or the request changed after signing). | App bug or a lost key: re-check how the text is built. If the key is gone (storage cleared), register again. Don't retry the same request unchanged. |
| `CLOCK_OUT_OF_RANGE` | 401 | `X-Signed-At` is more than 5 minutes from the server's clock. | Update the offset from this answer's `X-Server-Time` and retry **once** with a new nonce. |
| `NONCE_REUSED` | 401 | This nonce was already used (a replayed or duplicated request). | Retry with a new nonce (the operation itself is safe to retry: `opId` stops duplicates). |
| `CHALLENGE_INVALID` | 400 | Registering: the challenge is unknown, already used or older than 5 minutes. | Ask for a new challenge and register again. |
| `DEVICE_KEY_INVALID` | 400 | Registering: the public key isn't a valid P-256 key, or the challenge wasn't signed by it. | App bug: re-check the key export and the signature. |
| `DEVICE_ID_TAKEN` | 409 | Registering: this device ID is already registered (a phone never swaps its key). | Make a **new** device ID (and key) and register again. |
| `DEVICE_ALREADY_REVOKED` | 409 | The owner tried to revoke a phone that's already revoked. | Refresh the phone list. |
| `INVALID_PAYLOAD` | (push result) | An operation or its payload is malformed. `fields` says where. Nothing was stored for it. | "Needs attention": app bug. A corrected operation may reuse the same `opId`. |
| `UNKNOWN_OPERATION` | (push result) | The operation `type` doesn't exist (yet). | "Needs attention": app bug or an app newer than the server. |
| `ID_TAKEN` | (push result) | A **new** product or size was sent with an ID that's already used (in practice never, with `crypto.randomUUID()`). Nothing applied. | "Needs attention": app bug. Make a new ID for the record. |
| `SIZE_HAS_STOCK` | (push result) | A size that still has stock (above or below zero) can't be removed. `message` and `fields.isActive`: "This size still has 3 in stock." | Show the message; offer to remove the stock or count it first. |
| `UNIT_LOCKED` | (push result) | A product with stock records can't switch between yards and another unit (stored quantities would change meaning). | Show the message; the person can add a new product instead. |
| `SIZES_NOT_ALLOWED` | (push result) | A size for a fabric product, or a product with sizes changed to fabric. | "Needs attention" with "Fabric has no sizes." |
| `SALE_TOTALS_MISMATCH` | (push result) | A sale's line total, subtotal, paid or credit isn't what the sale rule gives (`fields` names it and the expected value). Nothing saved. | "Needs attention": app bug (the app must use the sale rule exactly). |
| `PRICE_VERSION_MISMATCH` | (push result) | A line's `setPriceMinor` isn't the set price of the version it names (`fields.items.N.setPriceMinor`). | "Needs attention": app bug. |
| `UNKNOWN_PRICE_VERSION` | (push result) | A line names a product or size version the server never issued, or an `editOpId` it never accepted for that product or size. | "Needs attention". If the edit it names was rejected, fix that first. |
| `RECEIPT_NUMBER_TAKEN` | (push result) | This receipt number is already used in the business (by a sale, correction or repayment). | "Needs attention": app bug in the receipt counter. Show "This receipt number was already used." |
| `RECEIPT_NUMBER_INVALID` | (push result) | The receipt number doesn't start with this phone's `deviceCode` for this business. | "Needs attention": app bug (each business on the phone has its own code and counter). |
| `PAYMENT_METHOD_UNKNOWN` | (push result) | A payment method code that doesn't exist at all. (A known method the business has switched off is **saved and flagged** `methodDisabled`, never rejected.) | "Needs attention": app bug. |
| `OP_ID_CONFLICT` | (push result) | This `opId` was already used for a different operation (other device, type or payload). Nothing applied. | "Needs attention" marked "App problem: tell the developer"; include it in the Help message. |
| `INTERNAL_ERROR` | 500 | Something unexpected went wrong on the server. `message` is "Something went wrong. Reference: \<request id\>". | **Temporary:** keep any unsent records and retry later. Keep the reference (also in `X-Request-Id`) for the Help message. |

Other failures without the error format:

- **Network failure, timeout, or a 502/503/504 without the error format** (from the hosting) (for example while the free server wakes up, which can take up to a minute): **temporary**. Keep everything and retry later with back-off; show "Connecting…", not an error.

---

## Endpoints

Grouped by area as they arrive (accounts, devices, team, sync, reports, export, business, practice). Each endpoint heading is `### METHOD /path`. "Signed" means signed with the device key (see Conventions, "Phones and signed requests"): **every business endpoint** (those needing `X-Business`) is signed, except `POST /api/devices/challenge` and `POST /api/devices`.

**Every business endpoint** can also answer, before anything else and in this order: `401 NOT_SIGNED_IN`, `400 BUSINESS_REQUIRED`, `404 NOT_FOUND` (not a member of that business), `403 ACCESS_REMOVED`, `403 BUSINESS_CLOSING`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`; then, for signed endpoints, `403 DEVICE_NOT_REGISTERED`, `403 DEVICE_REVOKED`, `429 RATE_LIMITED` (phone locked after failed signatures), `401 CLOCK_OUT_OF_RANGE`, `401 DEVICE_SIGNATURE_INVALID`, `401 NONCE_REUSED`; then `403 FORBIDDEN` (role not allowed).

### GET /api/health

Is the server running, and can it reach its database? Call it in the background when the app opens, to start waking the free server. FE13's Help message includes `version`.

- **Who:** anyone (no sign-in).
- **Signed:** no.
- **Request:** no body, no special headers.
- **Response 200** (server and database working):

  ```json
  { "status": "ok", "database": "ok", "version": "0.1.0" }
  ```

- **Response 503** (the server is running but can't reach its database):

  ```json
  { "status": "down", "database": "down", "version": "0.1.0" }
  ```

| Field | Type | Values |
|---|---|---|
| `status` | string | `ok` or `down` |
| `database` | string | `ok` or `down` |
| `version` | string | The server's version (from BE17: the release version set in hosting). |

- **Errors:** none in the error format. A network error or timeout means the server is asleep or unreachable: treat as temporary.
- **Rate limit:** none.
- **Available since:** BE1.

---

### GET /api/reference

The supported countries, currencies, languages and payment methods, with the names to show and the rules to write money and phone numbers. Load it at sign-up (country and language pickers) and keep a copy for formatting.

- **Who:** anyone (no sign-in). **Signed:** no. **Business:** no.
- **Response 200:**

  ```json
  {
    "countries": [{
      "code": "GH", "name": "Ghana", "dialCode": "233", "trunkPrefix": "0", "nationalNumberLengths": [9],
      "currency": "GHS", "timezones": ["Africa/Accra"], "defaultLanguage": "en",
      "paymentMethods": [{ "code": "cash", "name": "Cash" }, { "code": "mobile_money", "name": "MoMo" }]
    }],
    "currencies": [{
      "code": "GHS", "name": "Ghana cedi", "symbol": "GH₵", "minorUnits": 2,
      "symbolPosition": "before", "symbolSpace": " ", "decimalSeparator": ".", "groupSeparator": ","
    }],
    "languages": [
      { "tag": "en", "name": "English", "nativeName": "English", "status": "complete" },
      { "tag": "tw", "name": "Twi", "nativeName": "Twi", "status": "draft" }
    ],
    "paymentMethods": [{ "code": "cash", "name": "Cash" }, { "code": "mobile_money", "name": "Mobile money" }],
    "sizeRanges": [
      { "code": "shoes_eu", "name": "Shoe sizes (30–46)", "forTypes": ["shoes"], "sizes": ["30", "31", "…", "46"] },
      { "code": "clothing_letters", "name": "Clothing sizes (XS–XXXL)", "forTypes": ["clothing"], "sizes": ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] },
      { "code": "children_years", "name": "Children's ages (1Y–12Y)", "forTypes": ["clothing", "shoes"], "sizes": ["1Y", "2Y", "…", "12Y"] }
    ],
    "defaults": { "country": "GH", "language": "en" }
  }
  ```

- A country's `paymentMethods[].name` is what to show **in that country** (mobile money is "MoMo" in Ghana); the top-level list has the general names. A language with `status: "draft"` isn't fully translated: show English for missing texts. At launch there's one country (Ghana), so the country picker can be preselected and hidden.
- **`sizeRanges`** (since BE6): ready-made size ranges for adding a product, in their natural order. The person picks a range and its first and last size (for example shoes 30 to 40); the app makes **one `size.upsert` per size**, with `sortOrder` = its position in the range (0, 1, 2…). Custom sizes ("1Y, 2Y, 3Y") are typed and pushed the same way. `forTypes` says which product types to offer each range for. The server stores only individual sizes; ranges may be added later.
- **Errors:** none. **Rate limit:** none. **Available since:** BE4.5.

### PATCH /api/business/locale

The owner changes the business's country, currency or time zone. Only possible until the business has its first money record (`localeLocked`); after that, `409 CURRENCY_LOCKED`. At launch the only valid values are `GH`, `GHS` and `Africa/Accra`, so the app needn't offer this screen yet.

- **Who:** owner. **Business:** yes (`X-Business`). **Signed:** yes.
- **Request:** `{ "country": "GH", "currency": "GHS", "timezone": "Africa/Accra" }`: at least one. Changing `country` alone also resets the currency, time zone and payment methods to that country's.
- **Response 200:** `{ "country": "GH", "currency": { "code": "GHS", "…": "…" }, "timezone": "Africa/Accra", "localeLocked": false }`. Refresh `GET /api/auth/me` afterwards.
- **Errors:** `409 CURRENCY_LOCKED`, `400 VALIDATION_FAILED` (`fields.country`: not supported; `fields.currency`: not supported; `fields.timezone`: not one of the country's time zones; or nothing to change), plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE4.5.

---

## Phones (devices)

### POST /api/devices/challenge

Step 2 of registering this phone: a one-time challenge to sign with the phone's new private key.

- **Who:** signed in, a member of the business (own password chosen, terms accepted). **Business:** yes (`X-Business`). **Signed:** no (the phone has no registered key yet).
- **Request:** no body.
- **Response 200:** `{ "challenge": "kM3x…(43 characters)", "expiresAt": "2026-11-08T10:05:00.000Z" }`. Valid **5 minutes**, usable **once**.
- **Errors:** `429 RATE_LIMITED`, plus the business-endpoint errors before the signature.
- **Rate limit:** 20 per hour per person. **Available since:** BE5.

### POST /api/devices

Step 3: registers this phone for this business. The owner is emailed ("A new phone, [name], was added to [business] by [person]"). On a new phone, sign-in and registration happen together, so reuse the password just typed (don't ask twice and don't keep it); registering later (after storage was cleared) asks for it again.

- **Who:** signed in, a member of the business. **Business:** yes. **Signed:** no.
- **Request:**

  ```json
  {
    "deviceId": "3f1c2a9e-6b7d-4c1e-9a2b-0d4e5f6a7b8c",
    "name": "Ama's Tecno",
    "publicKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },
    "challenge": "kM3x…",
    "challengeSignature": "…(base64url)…",
    "currentPassword": "…"
  }
  ```

| Field | Rules |
|---|---|
| `deviceId` | A new UUID made on this phone (`crypto.randomUUID()`), one per business. |
| `name` | 1–60 characters, shown in the owner's phone list (e.g. the phone's model). |
| `publicKey` | The public key as JWK (`kty: "EC"`, `crv: "P-256"`, `x`, `y`). Never the private key. |
| `challenge` | From `POST /api/devices/challenge`. |
| `challengeSignature` | The challenge **text** (UTF-8) signed with the private key, base64url (64-byte P1363 form, what Web Crypto gives). |
| `currentPassword` | The person's password (proves a stolen cookie alone can't add a key). |

- **Response 201:** `{ "device": { "deviceId": "3f1c…", "deviceCode": "K7M", "name": "Ama's Tecno" } }`. Save `deviceCode` for receipt numbers (`K7M-0001`, `K7M-0002`…; one counter per business on this phone).
- **Errors:** `400 WRONG_PASSWORD`, `400 CHALLENGE_INVALID`, `400 DEVICE_KEY_INVALID`, `409 DEVICE_ID_TAKEN`, `400 VALIDATION_FAILED`, `429 RATE_LIMITED`, plus the business-endpoint errors before the signature.
- **Rate limit:** 5 per hour per person and per IP address; a wrong password also counts towards the sign-in limit. **Available since:** BE5.

### GET /api/devices

The owner's list of the business's phones (More → Phones), active and revoked.

- **Who:** owner. **Business:** yes. **Signed:** yes.
- **Response 200:**

  ```json
  {
    "devices": [{
      "deviceId": "3f1c2a9e-6b7d-4c1e-9a2b-0d4e5f6a7b8c", "deviceCode": "K7M", "name": "Ama's Tecno",
      "person": { "userId": "8c7b…", "name": "Ama Mensah" },
      "isActive": true, "lastSeenAt": "2026-11-08T09:58:00.000Z", "lastSyncAt": null,
      "lockedUntil": null, "registeredAt": "2026-11-01T08:00:00.000Z", "revokedAt": null
    }]
  }
  ```

  `lastSeenAt` is updated at most every 5 minutes. `lockedUntil` (time or null): the phone is blocked until then after too many failed signatures; show "Blocked after failed checks". `lastSyncAt` is filled from BE5 Part B.
- **Errors:** the business-endpoint errors. **Rate limit:** none. **Available since:** BE5.

### DELETE /api/devices/:deviceId

Revokes a phone (lost or stolen). Its next request gets `403 DEVICE_REVOKED` and it wipes this business's data; a phone that stays offline can only be wiped when it next connects. The person can sign in on another phone and register it (a new device, new code). A revoked phone is never reactivated.

- **Who:** owner. **Business:** yes. **Signed:** yes.
- **Response 200:** `{ "device": device }` with `isActive: false`.
- **Errors:** `404 NOT_FOUND` (not a phone of this business), `409 DEVICE_ALREADY_REVOKED`, plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE5.

---

## Accounts

### The `me` object

Sign-up, sign-in, `GET /api/auth/me` and most account changes answer with this object (some add one more field, noted below):

```json
{
  "user": {
    "id": "3f1c2a9e-6b7d-4c1e-9a2b-0d4e5f6a7b8c",
    "name": "Ama Mensah",
    "phone": "+233241234567",
    "email": "ama@example.com",
    "emailConfirmed": false,
    "pendingEmail": null,
    "language": "en",
    "mustChangePassword": false
  },
  "terms": { "currentVersion": "1", "acceptedVersion": "1", "accepted": true },
  "businesses": [
    {
      "id": "8a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "name": "Ama Fabrics", "role": "owner", "isPractice": false, "status": "active",
      "country": "GH",
      "currency": { "code": "GHS", "symbol": "GH₵", "minorUnits": 2, "symbolPosition": "before", "symbolSpace": "\u00a0", "decimalSeparator": ".", "groupSeparator": "," },
      "timezone": "Africa/Accra",
      "defaultLanguage": "en",
      "paymentMethods": ["cash", "mobile_money"],
      "localeLocked": false
    }
  ],
  "invitations": [
    { "membershipId": "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f", "businessName": "Kofi Shoes", "role": "manager", "invitedAt": "2026-11-05T10:00:00.000Z" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `user.id` | UUID | The person's ID. |
| `user.name` | string | 1–60 characters. |
| `user.phone` | string | E.164, e.g. `+233241234567`. Show it in local form, `024 123 4567`. |
| `user.email` | string or null | Lower case. The owner always has one; staff may not. |
| `user.emailConfirmed` | boolean | `false` → Settings shows "Email not confirmed. **Send the link again**" (`POST /api/auth/confirm-email/send`). Never blocks the app. |
| `user.pendingEmail` | string or null | A new email waiting for its link to be tapped; the old `email` stays in use until then. Show "Waiting for you to confirm [pendingEmail]". |
| `user.language` | language tag | The person's app language (a tag from `GET /api/reference`). |
| `user.mustChangePassword` | boolean | `true` → show "Choose your own password" (`POST /api/auth/change-password`) before anything else. (Staff with a temporary password, from BE3.) |
| `terms.currentVersion` | string | The version in force. |
| `terms.acceptedVersion` | string or null | The version this person accepted. |
| `terms.accepted` | boolean | `false` → show the terms and `POST /api/auth/accept-terms` (other endpoints answer `403 TERMS_REQUIRED` meanwhile). |
| `businesses` | array | The person's **active** memberships: real businesses first, then practice shops. Empty if they've been removed everywhere. |
| `businesses[].id` | UUID | The business ID (from BE3, sent as `X-Business`). |
| `businesses[].name` | string | The business name (from its settings). |
| `businesses[].role` | `owner`, `manager` or `associate` | For **display**; the server checks the role itself on every request. |
| `businesses[].isPractice` | boolean | `true` for a practice shop (BE16). |
| `businesses[].status` | `active` or `closing` | `closing`: the owner asked to close it (BE15). |
| `businesses[].country` | string | ISO 3166 code (`GH`). Decides how local phone numbers are read and which payment-method names to show. |
| `businesses[].currency` | object | `code` (ISO 4217), `symbol`, `minorUnits` (decimals: 0, 2 or 3), `symbolPosition` (`before`/`after`), `symbolSpace` (the non-breaking space), `decimalSeparator`, `groupSeparator`: everything needed to write this business's amounts (see Conventions, Money). |
| `businesses[].timezone` | string | IANA time zone (`Africa/Accra`): business dates, day closes and "today" use it. |
| `businesses[].defaultLanguage` | language tag | The business's default language for customers' messages. |
| `businesses[].paymentMethods` | array of codes | The payment methods this business uses (`["cash", "mobile_money"]` in Ghana); offer only these. Names from `GET /api/reference` (mobile money is "MoMo" in Ghana). |
| `businesses[].localeLocked` | boolean | `true` once the business has a money record: country, currency and time zone can no longer change. |
| `invitations` | array | Businesses that invited this person (their phone number already had an account). Oldest first; empty when none. After sign-in, show each: "[businessName] invited you to join as [role]" with **Accept** / **Decline**. |
| `invitations[].membershipId` | UUID | Use it in the accept/decline endpoints. |
| `invitations[].businessName` | string | The inviting business's name. |
| `invitations[].role` | `manager` or `associate` | The role offered. |
| `invitations[].invitedAt` | time | When the invitation was sent. |

### GET /api/legal/current

The current privacy notice and terms, in English and Twi, as Markdown. Show them at sign-up (links next to the tick box) and whenever `terms.accepted` is `false`.

- **Who:** anyone. **Signed:** no. **Request:** nothing.
- **Response 200:**

  ```json
  {
    "version": "1",
    "documents": {
      "en": { "privacy": "# Shop Book privacy notice\n…", "terms": "# Shop Book terms of use\n…" },
      "tw": { "privacy": "…", "terms": "…" }
    }
  }
  ```

  Send `version` back when accepting (`termsVersion` at sign-up, `version` in accept-terms). The texts are first drafts and the Twi texts are not translated yet; their content may change without the version changing until they're final.
- **Errors:** none. **Rate limit:** none. **Available since:** BE2.

### POST /api/auth/signup

Creates a business with its owner and first shop, signs the owner in (sets the session cookie) and emails a confirm-email link. Everything is created together or not at all.

- **Who:** anyone. **Signed:** no. **Needs `Origin`:** yes (see Conventions).
- **Request:**

  ```json
  {
    "name": "Ama Mensah",
    "phone": "024 123 4567",
    "email": "ama@example.com",
    "password": "kente-cloth-2026",
    "businessName": "Ama Fabrics",
    "language": "en",
    "acceptTerms": true,
    "termsVersion": "1"
  }
  ```

| Field | Type | Rules |
|---|---|---|
| `name` | string, required | The owner's name, 1–60 characters after trimming. |
| `phone` | string, required | A **mobile** number of a supported country, in local form (`0241234567`, `024 123 4567`, read with `country`) or international form (`+233 24 123 4567`, `233241234567`); stored in E.164, `+233241234567`. |
| `email` | string, required | Trimmed and stored in lower case; at most 254 characters. |
| `password` | string, required | 8–128 characters, not a very common password. |
| `businessName` | string, required | 1–60 characters after trimming. Typed only here; later changed in Business settings (`settings.update`, BE5). The first shop gets the same name. |
| `language` | language tag, required | The owner's language and the business's default language for customers (`en` or `tw` at launch). |
| `country` | string, optional | The business's country (ISO 3166). Default `GH`, the only supported country at launch. Sets the currency (GHS), time zone (Africa/Accra), payment methods (cash, mobile money) and how local phone numbers are read. Unsupported → `fields.country`. |
| `acceptTerms` | `true`, required | The tick "I accept the privacy notice and terms". |
| `termsVersion` | string, required | `version` from `GET /api/legal/current`. |

- **Response 201:** the `me` object plus `emailSent`, and the session cookie.

  ```json
  { "user": { "…": "…" }, "terms": { "…": "…" }, "businesses": [ { "…": "…" } ], "emailSent": true }
  ```

  `emailSent: false` means the account **was** created but the confirm email couldn't be sent: show "We couldn't send the confirmation email. **Send the link again**" (Settings). Don't repeat the sign-up.
- **Errors:** `400 VALIDATION_FAILED` (with `fields`: `name`, `phone`, `email`, `password`, `businessName`, `language`, `country`, `acceptTerms`), `409 PHONE_TAKEN`, `409 EMAIL_TAKEN`, `409 TERMS_VERSION_MISMATCH`, `403 ORIGIN_REQUIRED`, `429 RATE_LIMITED`.
- **Password messages** (in `fields.password`): "Use at least 8 characters.", "Use at most 128 characters.", "This password is too common. Choose another one."
- **Rate limit:** 5 per hour per IP address.
- **Available since:** BE2.

### POST /api/auth/signin

Signs in with a phone number **or** an email, plus the password. Sets the session cookie.

- **Who:** anyone. **Signed:** no. **Needs `Origin`:** yes.
- **Request:** `{ "login": "024 123 4567", "password": "kente-cloth-2026", "country": "GH" }`. `login` is treated as an email if it contains `@`, otherwise as a phone number (local or international form). `country` (optional, default `GH`) says how to read a local number: the country chosen on the sign-in screen.
- **Response 200:** the `me` object, and the session cookie. Then check, in this order: `user.mustChangePassword`, `terms.accepted`, `businesses` (empty → "You're not part of any business any more").
- **Errors:** `401 WRONG_LOGIN` for **any** wrong login or password (never says which), `400 VALIDATION_FAILED` (empty fields), `403 ORIGIN_REQUIRED`, `429 RATE_LIMITED`.
- **Rate limit:** 10 attempts per 15 minutes per login (the same number typed differently counts together) and 10 per 15 minutes per IP address. Every attempt counts.
- **Available since:** BE2.

### POST /api/auth/signout

Removes the session cookie on **this** phone. Other phones stay signed in.

- **Who:** anyone (works even if already signed out). **Signed:** no.
- **Request:** no body (send `X-Requested-With` as always).
- **Response 204:** no body. Warn before signing out if there are unsent records (app plan).
- **Errors:** none of its own. **Rate limit:** none. **Available since:** BE2.

### GET /api/auth/me

Who's signed in, their businesses and roles, and whether they've accepted the current terms. Works even when the terms aren't accepted, so the app knows to ask.

- **Who:** signed in. **Signed:** no.
- **Response 200:** the `me` object (renews the session cookie).
- **Errors:** `401 NOT_SIGNED_IN`. **Rate limit:** none. **Available since:** BE2.

### PATCH /api/auth/me

Changes the person's own app language. (The language used for customers' messages is the customer's own; the business's default is a business setting.)

- **Who:** signed in (terms not needed). **Signed:** no.
- **Request:** `{ "language": "tw" }`: `en` or `tw`. Other fields are ignored.
- **Response 200:** the `me` object.
- **Errors:** `400 VALIDATION_FAILED` (`fields.language`), `401 NOT_SIGNED_IN`. **Rate limit:** none. **Available since:** BE2.

### POST /api/auth/change-password

Changes the password, and is how staff replace a temporary password at their first sign-in. Ends the person's **other** sign-ins; this phone stays signed in (new cookie).

- **Who:** signed in (terms not needed). **Signed:** no.
- **Request:** `{ "currentPassword": "temporary-or-old", "newPassword": "my-own-password-1" }`.
- **Rules for `newPassword`:** as at sign-up, and different from the current one.
- **Response 200:** the `me` object (`mustChangePassword` is now `false`).
- **Errors:** `400 WRONG_PASSWORD` (`fields.currentPassword`), `400 VALIDATION_FAILED` (`fields.newPassword`), `401 NOT_SIGNED_IN`, `429 RATE_LIMITED`.
- **Rate limit:** 10 current-password checks per 15 minutes per person (shared with changing phone and email).
- **Available since:** BE2.

### POST /api/auth/accept-terms

Records that the person accepted the current privacy notice and terms (and when).

- **Who:** signed in. **Signed:** no.
- **Request:** `{ "version": "1" }`: `version` from `GET /api/legal/current`.
- **Response 200:** the `me` object (`terms.accepted: true`).
- **Errors:** `409 TERMS_VERSION_MISMATCH`, `400 VALIDATION_FAILED`, `401 NOT_SIGNED_IN`. **Rate limit:** none. **Available since:** BE2.

### POST /api/auth/confirm-email/send

"Send the link again": emails a new confirm link (to the pending new email if there is one, otherwise to the unconfirmed email). Older links of the same kind stop working.

- **Who:** signed in, own password chosen, terms accepted. **Signed:** no.
- **Request:** no body.
- **Response 200:** `{ "emailSent": true }`. Show "We've sent a new link. Check your inbox and spam."
- **Errors:** `502 EMAIL_NOT_SENT`, `409 NOTHING_TO_CONFIRM`, `401 NOT_SIGNED_IN`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`, `429 RATE_LIMITED`.
- **Rate limit:** 3 per hour per person (shared with forgot password for the same account) and 10 per hour per IP address.
- **Available since:** BE2.

### POST /api/auth/confirm-email

Confirms an email from the link in the email. The link opens the app at **`/confirm-email?token=…`**: take the token from the address, **remove it from the address straight away** (`history.replaceState`), never store or log it, and send it here. Works without being signed in (the link may be opened on another device).

- **Who:** anyone with the link. **Signed:** no.
- **Request:** `{ "token": "…" }`.
- **Response 200:** `{ "emailConfirmed": true }`. Show "Email confirmed". If the person is signed in on this phone, refresh `GET /api/auth/me`.
- What it confirms: a sign-up email (sets `emailConfirmed`), or a **change** of email (the pending email becomes `email`).
- **Links work once and expire after 24 hours**; asking for a new link makes older ones stop working.
- **Errors:** `400 INVALID_TOKEN`, `409 EMAIL_TAKEN` (someone else took the new address meanwhile; nothing changed), `400 VALIDATION_FAILED`.
- **Rate limit:** none. **Available since:** BE2.

### POST /api/auth/forgot-password

Asks for a password-reset link. **Always** answers the same, whether or not the account exists or has a confirmed email, so nobody can find out who has an account.

- **Who:** anyone. **Signed:** no. **Needs `Origin`:** yes.
- **Request:** `{ "login": "ama@example.com", "country": "GH" }`: a phone number or an email; `country` optional (default `GH`), as in sign-in.
- **Response 200:** `{ "message": "If that account has a confirmed email, we've sent a link. Check your inbox and spam." }`. Show it (translated), plus: "No email? Ask your shop owner to reset your password."
- What happens: only if the account exists **and** its email is confirmed, a reset link goes to that email. Nothing is sent to an unconfirmed email.
- **Errors:** `400 VALIDATION_FAILED` (empty `login`), `403 ORIGIN_REQUIRED`, `429 RATE_LIMITED`.
- **Rate limit:** 3 per hour per login (as typed, normalised) and 10 per hour per IP address.
- **Available since:** BE2.

### POST /api/auth/reset-password

Sets a new password from a reset link. The link opens the app at **`/reset-password?token=…`**: take the token, remove it from the address straight away, never store or log it. Ask for the new password twice (the app checks they match), then send it here.

- **Who:** anyone with the link. **Signed:** no. **Needs `Origin`:** yes.
- **Request:** `{ "token": "…", "newPassword": "fresh-start-2026" }`. Rules as at sign-up.
- **Response 200:** `{ "passwordChanged": true }`, and the session cookie is removed. Show "Password changed. Sign in again." **Every** sign-in of this person has ended, on every phone.
- **The link works once and expires after 30 minutes.** A password refused by the rules doesn't use up the link.
- **Errors:** `400 INVALID_TOKEN`, `400 VALIDATION_FAILED` (`fields.newPassword`), `403 ORIGIN_REQUIRED`.
- **Rate limit:** none. **Available since:** BE2.

### PATCH /api/auth/me/phone

Changes the person's phone number (which they sign in with). Ends their **other** sign-ins; this phone stays signed in.

- **Who:** signed in, terms accepted. **Signed:** no.
- **Request:** `{ "currentPassword": "…", "newPhone": "020 777 0001", "country": "GH" }`; `country` optional (default `GH`), how to read a local number.
- **Response 200:** the `me` object with the new `user.phone`.
- **Errors:** `400 WRONG_PASSWORD`, `400 VALIDATION_FAILED` (`fields.newPhone`: not a valid mobile number, or the same as now), `409 PHONE_TAKEN` (`fields.newPhone`), `401 NOT_SIGNED_IN`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`, `429 RATE_LIMITED`.
- **Rate limit:** shared current-password limit (see change password). **Available since:** BE2.

### PATCH /api/auth/me/email

Changes (or, for staff, adds) the person's email. The new email is **pending** until its link is tapped; the old one keeps working until then, and a notice goes to the old address. Ends the person's **other** sign-ins; this phone stays signed in.

- **Who:** signed in, terms accepted. **Signed:** no.
- **Request:** `{ "currentPassword": "…", "newEmail": "new.address@example.com" }`.
- **Response 200:** the `me` object (with `user.pendingEmail` set) plus `emailSent`. `emailSent: false`: the change is saved but the link couldn't be sent; offer **Send the link again**.
- **Errors:** `400 WRONG_PASSWORD`, `400 VALIDATION_FAILED` (`fields.newEmail`: invalid, or the same as now), `409 EMAIL_TAKEN` (`fields.newEmail`), `401 NOT_SIGNED_IN`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`, `429 RATE_LIMITED`.
- **Rate limit:** shared current-password limit (see change password). **Available since:** BE2.

### POST /api/auth/invitations/:membershipId/accept

Accepts an invitation from `me.invitations`. The business then appears in `me.businesses` with that role, and the owner sees the person under their own name.

- **Who:** signed in, the invited person only; own password chosen and terms accepted. **Signed:** no. **Business:** no (no `X-Business`).
- **Request:** no body.
- **Response 200:** the `me` object (the invitation gone, the business added).
- **Errors:** `404 NOT_FOUND` (not this person's pending invitation: someone else's, already answered, or cancelled by the owner), `401 NOT_SIGNED_IN`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`.
- **Rate limit:** none. **Available since:** BE3.

### POST /api/auth/invitations/:membershipId/decline

Declines an invitation. The owner sees "Declined" and may invite again later.

- **Who / signed / business / request / errors:** as for accept.
- **Response 200:** the `me` object (the invitation gone).
- **Rate limit:** none. **Available since:** BE3.

---

## Team

All team endpoints are **owner only** business endpoints: signed in, `X-Business` required, and the person must be that business's owner (others get `403 FORBIDDEN`). **Signed:** yes.

### The `member` object

```json
{
  "membershipId": "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
  "name": "Kofi Boateng",
  "phone": "+233241112233",
  "email": "kofi@example.com",
  "role": "associate",
  "status": "active",
  "mustChangePassword": true,
  "invitedAt": null,
  "joinedAt": "2026-11-05T09:00:00.000Z",
  "removedAt": null
}
```

| Field | Type | Meaning |
|---|---|---|
| `membershipId` | UUID | Use it in the other team endpoints. |
| `name` | string | The person's name. For an **invitation** (status `invited` or `declined`, or an invitation cancelled before it was accepted) it's **the name the owner typed**, never the account's own name. |
| `phone` | string | E.164 (`+233…`); show in local form, `024 123 4567`. |
| `email` | string or null | The person's email. Always `null` for invitations (the account's own email is never shown). |
| `role` | `owner`, `manager` or `associate` | |
| `status` | `active`, `invited`, `declined`, `removed` | Words: (nothing), "Waiting for them to accept", "Declined", "Removed". |
| `mustChangePassword` | boolean or null | `true`: they haven't signed in and chosen their own password yet ("Hasn't signed in yet"). `null` for invitations. |
| `invitedAt` | time or null | When an invitation was sent. |
| `joinedAt` | time | When the membership was created. |
| `removedAt` | time or null | When it ended (removed, declined, cancelled). |

### GET /api/team

The business's team: the owner first, then active members, invitations, declined and removed.

- **Request:** no body.
- **Response 200:** `{ "members": [ member, … ] }`.
- **Errors:** the business-endpoint errors above. **Rate limit:** none. **Available since:** BE3.

### POST /api/team

Adds a staff member. **Two cases, one answer shape:**

- **The phone number has no Shop Book account:** a new account is made with a **temporary password**, shown in this answer **only**. Show it once with "Give this to them in person" (it's never shown again; if lost, use reset-password). They must replace it at their first sign-in, then accept the terms. If an email was given, it's saved unconfirmed and a confirm link is sent (`emailSent`).
- **The phone number already has an account:** an **invitation** is created instead. `temporaryPassword` is `null`, `member.status` is `invited`, and the member shows only the name and number typed here. The person accepts or declines at their next sign-in (`me.invitations`). The email typed here is ignored.

- **Request:**

  ```json
  { "name": "Kofi Boateng", "phone": "024 111 2233", "role": "associate", "email": "kofi@example.com" }
  ```

| Field | Type | Rules |
|---|---|---|
| `name` | string, required | 1–60 characters. |
| `phone` | string, required | A mobile number; a local number is read with the business's country. |
| `role` | `manager` or `associate`, required | Never `owner`. |
| `email` | string, optional | Empty or left out: no email (the person can add one later in Settings). |

- **Response 201:**

  ```json
  { "member": { "…": "…", "status": "active" }, "temporaryPassword": "k7m4p-q2xnr", "emailSent": true }
  ```

  ```json
  { "member": { "…": "…", "status": "invited", "email": null }, "temporaryPassword": null, "emailSent": null }
  ```

  `temporaryPassword` is 10 lower-case letters and digits in two groups (`k7m4p-q2xnr`), typed exactly as shown, hyphen included. The answer is never cached (`Cache-Control: no-store`); don't store it on the phone. `emailSent`: `null` when no email was sent, `false` if sending failed (the person can use **Send the link again** after signing in).
- **Errors:** `400 VALIDATION_FAILED` (`fields`: `name`, `phone`, `role`, `email`), `409 ALREADY_MEMBER`, `409 ALREADY_INVITED`, `409 EMAIL_TAKEN` (a new person's email already belongs to an account), `429 RATE_LIMITED`, plus the business-endpoint errors.
- **Someone removed or who declined earlier** is invited again (same `membershipId`, status `invited`).
- **Rate limit:** 20 per hour per owner and 30 per hour per IP address.
- **Available since:** BE3.

### PATCH /api/team/:membershipId

Changes a member's (or a pending invitation's) role between manager and sales associate. Recorded in the business's history.

- **Request:** `{ "role": "manager" }`.
- **Response 200:** `{ "member": member }`.
- **Errors:** `400 VALIDATION_FAILED`, `404 NOT_FOUND` (not a membership of this business), `409 OWNER_CANNOT_CHANGE`, `409 MEMBER_REMOVED`, plus the business-endpoint errors.
- **Takes effect** on the person's next request (the server re-reads the role every time); their phone learns it from `GET /api/auth/me`.
- **Rate limit:** none. **Available since:** BE3.

### POST /api/team/:membershipId/reset-password

For a staff member who forgot their password and has no confirmed email (AC34): gives them a new **temporary password**, shown once in this answer. **All their sign-ins end at once**, and they must choose their own password at their next sign-in.

- **Request:** no body.
- **Response 200:** `{ "member": member, "temporaryPassword": "k7m4p-q2xnr" }` (never cached). Show it once with "Give this to them in person".
- **Errors:** `403 RESET_NOT_ALLOWED` (the person also belongs to another business: they must use **Forgot password** by email, or ask for help), `404 NOT_FOUND`, `409 OWNER_CANNOT_CHANGE`, `409 MEMBER_REMOVED` (not an active member: removed, or an invitation), `429 RATE_LIMITED`, plus the business-endpoint errors.
- **Rate limit:** 10 per hour per owner and 20 per hour per IP address.
- **Available since:** BE3.

### DELETE /api/team/:membershipId

Removes a member from **this** business, or cancels a pending invitation. **Their access to this business ends at once:** their very next request for it answers `403 ACCESS_REMOVED`, and their phone then wipes this business's local data. They stay signed in for any other business they belong to. Nothing they recorded is changed or lost. **Removing someone also revokes their phones for this business** (in the same step; their device codes are never reused).

- **Request:** no body.
- **Response 200:** `{ "member": member }` (status `removed`).
- **Errors:** `404 NOT_FOUND`, `409 OWNER_CANNOT_CHANGE`, `409 MEMBER_REMOVED` (already ended), plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE3.

---

## Products

Products and sizes are added and changed **through sync** (`product.upsert`, `size.upsert`) and arrive in the pull. This section has only what sync can't give.

### GET /api/products/:productId/history

Who changed a product and its sizes, and what changed (AC30): the product screen's "History".

- **Who:** owner and manager (associates: `403 FORBIDDEN`). **Business:** yes. **Signed:** yes.
- **Request:** no body.
- **Response 200:**

  ```json
  {
    "changes": [
      {
        "entity": "product", "entityId": "d521…",
        "changedBy": { "userId": "407f…", "name": "Ama Mensah" }, "changedAt": "2026-11-08T09:00:00.000Z",
        "before": null,
        "after": { "name": "Black sandal", "type": "shoes", "unit": "pair", "unitLabel": null, "retailMinor": 12000, "wholesaleMinor": 10000, "costMinor": 8000, "isHidden": false, "version": 1 },
        "conflict": false
      },
      {
        "entity": "size", "entityId": "6c2e…",
        "changedBy": { "userId": "8c7b…", "name": "Kofi Boateng" }, "changedAt": "2026-11-08T10:15:00.000Z",
        "before": { "retailMinor": null, "productId": "d521…", "version": 1 },
        "after": { "retailMinor": 14000, "productId": "d521…", "version": 2 },
        "conflict": false
      }
    ]
  }
  ```

| Field | Meaning |
|---|---|
| `changes` | Oldest first, in the order the server saved them: the product's changes and its sizes'. |
| `entity` | `product` or `size`. |
| `entityId` | The product's or size's ID. |
| `changedBy` | Who made the change (`name` as it is now), or `null` for a system change. |
| `before` / `after` | The fields that changed, with the version before and after. `before` is `null` when the record was created. Money in minor units. |
| `conflict` | `true` when the change was made from an older version than the one saved (someone else had changed it first). Show "Changed at the same time as another phone": the later one received won. |

- **Cost:** for a **manager**, `costMinor` is removed from every `before`/`after`, and a change that was only about cost isn't listed at all.
- **Errors:** `404 NOT_FOUND` (no such product in this business), plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE6.

---

## Sync

Push first, then pull, every time the app syncs (on opening, every few minutes, after a save, when the network comes back). Both are business endpoints for **every role**, signed.

### POST /api/sync/push

Sends the outbox: at most **200** operations, **oldest first**. Each is processed **in order**, in its own transaction, and gets its own result; one rejected operation doesn't stop the others.

- **Who:** any member. **Business:** yes. **Signed:** yes.
- **Request:**

  ```json
  {
    "deviceId": "3f1c2a9e-6b7d-4c1e-9a2b-0d4e5f6a7b8c",
    "operations": [
      {
        "opId": "6d0f8a1e-2b3c-4d5e-8f9a-0b1c2d3e4f5a",
        "type": "settings.update",
        "recordedOnline": true,
        "payload": { "baseVersion": 1, "changes": { "receiptNote": "Goods sold are returnable within 7 days" } }
      }
    ]
  }
  ```

| Field | Rules |
|---|---|
| `deviceId` | This phone's device ID for this business: the same as `X-Device-Id` (otherwise `400 VALIDATION_FAILED`, `fields.deviceId`). |
| `operations` | 0–200 operations, oldest first (more: `400 VALIDATION_FAILED`). |
| `operations[].opId` | A UUID made on the phone **when the record was saved**, kept with the outbox entry and **never changed**, even across retries. It's what makes retries safe. |
| `operations[].type` | One of the types in "Sync operations" below. |
| `operations[].recordedOnline` | Whether the phone had a connection when the record was made (a hint, used for the clock-skew flag from BE8). Default `false`. |
| `operations[].payload` | The operation's fields (see each type). |

- **Response 200:**

  ```json
  {
    "results": [
      { "opId": "6d0f…", "status": "saved", "result": { "version": 2 } },
      { "opId": "7e1a…", "status": "duplicate", "result": { "version": 2 } },
      { "opId": "8f2b…", "status": "rejected", "error": { "code": "FORBIDDEN", "message": "Your role can't do this." } }
    ],
    "serverTime": "2026-11-09T10:00:00.000Z"
  }
  ```

**What to do with each result** (one per operation, in the same order):

| `status` | Meaning | What the app does |
|---|---|---|
| `saved` | Applied now. `result` holds what the type returns (e.g. the new `version`, and for products and sizes `warnings`). | Store the result on the local record; remove the operation from the outbox (in one local transaction). Show any `warnings` (they never undo the save). |
| `duplicate` | Already applied earlier (a retry whose first answer was lost). `result` is the same as the first time. | Exactly as for `saved`. Nothing was applied twice. |
| `rejected` | Refused, **permanently**: sending it again will always give the same answer. `error.code` says why (and `error.fields` for a payload problem). | Move it to **"Needs attention"** with the message; never drop it silently. `OP_ID_CONFLICT`: mark "App problem: tell the developer" (it means this phone sent two different things with one ID, a bug). |

Rejection codes in results: `INVALID_PAYLOAD` (the operation or its payload is malformed; `fields` says where, as a path inside the payload, e.g. `fields.name`; nothing was stored, so a **corrected** operation may reuse the `opId`), `UNKNOWN_OPERATION` (no such type), `OP_ID_CONFLICT`, `FORBIDDEN` (this person's role can't do it), `VALIDATION_FAILED` (a business rule, with `fields`), `NOT_FOUND`, `ID_TAKEN`, `SIZES_NOT_ALLOWED`, `SIZE_HAS_STOCK`, `UNIT_LOCKED`, `SALE_TOTALS_MISMATCH`, `PRICE_VERSION_MISMATCH`, `UNKNOWN_PRICE_VERSION`, `RECEIPT_NUMBER_TAKEN`, `RECEIPT_NUMBER_INVALID`, `PAYMENT_METHOD_UNKNOWN`. Each type lists its own.

- **Errors (the whole request):** `400 VALIDATION_FAILED` (`deviceId`, too many operations), `429 RATE_LIMITED`, plus the business-endpoint errors. **Any 5xx, a timeout or a network error is temporary**: keep every operation in the outbox and push again later (operations already saved come back as `duplicate`). A 5xx is never a rejection.
- **Rate limit:** 120 sync requests (push and pull together) per 15 minutes per person. **Available since:** BE5.

### GET /api/sync/pull

Everything that changed after the phone's cursor, page by page.

- **Who:** any member. **Business:** yes. **Signed:** yes.
- **Request:** `GET /api/sync/pull?since=<cursor>&limit=<1..500>` (`since` default 0, `limit` default and maximum 500). Sign the path **with** its query string exactly as sent.
- **Response 200:**

  ```json
  {
    "rows": [
      { "type": "settings", "serverSeq": 41, "data": { "businessName": "Ama Fabrics", "version": 3, "…": "…" } },
      { "type": "location", "serverSeq": 42, "data": { "id": "…", "name": "Ama Fabrics", "type": "shop" } }
    ],
    "nextCursor": 45,
    "hasMore": false,
    "watermark": 45
  }
  ```

| Field | Meaning |
|---|---|
| `rows` | The changed rows **this person may see**, in `serverSeq` order. A row with an ID the phone already has **replaces** its local copy. Row types: see "Pull rows". |
| `nextCursor` | The last sequence number the server **scanned** (not the last row returned). Save it as the new cursor **in the same local transaction** as the rows. A page can have **no rows** and still move the cursor (rows this person may not see); that's normal. |
| `hasMore` | `true`: ask again with `since=nextCursor` straight away. |
| `watermark` | The business's last sequence number when this pull started. Changes made during the pull come in the next one; nothing is skipped. |

- A new phone starts with `since=0` and pages through everything.
- **Errors:** `400 VALIDATION_FAILED` (bad `since`/`limit`), `429 RATE_LIMITED`, plus the business-endpoint errors (`ACCESS_REMOVED` and `DEVICE_REVOKED` mean: wipe this business's local data).
- **Rate limit:** shared with push (above). **Available since:** BE5.

---

## Sync operations

Every operation type a phone may push, with its payload, who may send it, and its results. More types arrive with each feature (products in BE6, stock in BE7, sales in BE8…).

#### `settings.update`

The owner changes the business's settings (More → Business settings). Editable records follow **"last change received wins, with history"**: send the `version` the phone had when the person started editing (`baseVersion`). The change is applied even if someone changed the settings in between (the server records that as a conflict in its history), and the new `version` comes back.

- **Who:** owner only (others: `rejected` `FORBIDDEN`). **Since:** BE5.
- **Payload:**

  ```json
  { "baseVersion": 2, "changes": { "businessName": "Ama Fabrics & Shoes", "paymentMethods": ["cash", "mobile_money"] } }
  ```

| Field | Rules |
|---|---|
| `baseVersion` | The settings `version` the phone had (integer ≥ 1). |
| `changes` | At least one of the fields below; any other field is refused (`INVALID_PAYLOAD`). |
| `changes.businessName` | 1–60 characters. Shown in the header, receipts, statements. |
| `changes.receiptPhone` | 1–20 characters, or `null` (none). The shop's number printed on receipts. |
| `changes.receiptNote` | Up to 120 characters, or `null`. Printed at the bottom of receipts. |
| `changes.defaultLanguage` | A language tag (`en`, `tw`): the default for new customers' messages. |
| `changes.lowStockThreshold` | Integer 0–100000. A size is "Low" at or below it (unless the product has its own level). |
| `changes.returnPeriodDays` | Integer 0–365. Returns after this get a warning (BE10). |
| `changes.defaultCreditLimitMinor` | Integer ≥ 0 in minor units, or `null` (no default limit). Copied to new customers (BE9). |
| `changes.paymentMethods` | Non-empty list of payment-method codes **offered in the business's country** (`GET /api/reference`: `cash`, `mobile_money` in Ghana). |

- **Result (`saved`):** `{ "version": 3 }`, the new version. Update the local settings row; the full row also comes in the next pull.
- **Rejected:** `FORBIDDEN`, `INVALID_PAYLOAD` (`fields`), `VALIDATION_FAILED` (`fields.paymentMethods`: a method not offered in this country).

#### `product.upsert`

Adds a product, or edits one (name, type, unit, prices, hide/show). One operation per product; its sizes are separate `size.upsert` operations **after** it in the outbox.

- **Who:** owner and manager (associates: `rejected` `FORBIDDEN`). **Only the owner may send `costMinor`**: from a manager the operation is rejected `FORBIDDEN` (`fields.costMinor`); never put a cost field in a manager's form. **Since:** BE6.
- **Add** (`baseVersion: null`, a new `productId` made with `crypto.randomUUID()` when the person saves):

  ```json
  {
    "productId": "d52137d3-810d-4235-a7b7-c66b25412e04",
    "baseVersion": null,
    "fields": { "name": "Black sandal", "type": "shoes", "unit": "pair", "retailMinor": 12000, "wholesaleMinor": 10000, "costMinor": 8000 }
  }
  ```

- **Edit** (`baseVersion`: the product's `version` on the phone when the person started editing; only the fields that changed):

  ```json
  { "productId": "d52137d3-810d-4235-a7b7-c66b25412e04", "baseVersion": 1, "fields": { "retailMinor": 13000, "isHidden": false } }
  ```

| Field | Rules |
|---|---|
| `productId` | UUID made on the phone. |
| `baseVersion` | `null` to add; the version edited, to edit. Editing an unknown product: `NOT_FOUND`; adding with an ID the business already has: `VALIDATION_FAILED` (`fields.baseVersion`). |
| `fields` | At least one field; any other field is refused (`INVALID_PAYLOAD`). |
| `fields.name` | 1–80 characters (spaces at the ends and doubled spaces are removed). **Required to add.** Messages: "Enter a product name.", "Use a shorter name (up to 80 characters)." |
| `fields.type` | `clothing`, `shoes`, `fabric` or `other`. **Required to add.** |
| `fields.unit` | `piece`, `pair`, `set`, `dozen`, `yard` or `custom` (the shop's own word, in `unitLabel`). Fabric: `piece` or `yard` only (`VALIDATION_FAILED`, `fields.unit`: "Fabric is sold by the piece or by the yard."). **Required to add.** |
| `fields.unitLabel` | 1–20 characters, required when `unit` is `custom` ("Enter the unit's name."); ignored (stored as `null`) for other units. |
| `fields.retailMinor` | Integer, minor units, from 1 up to 1,000,000 in the business's currency (GH₵ 1,000,000.00 = `100000000`). **Required to add.** Above the limit: `VALIDATION_FAILED` (`fields.retailMinor`). |
| `fields.wholesaleMinor` | Same range, or `null` (none: wholesale sales use the retail price). |
| `fields.costMinor` | Same range, or `null`. **Owner only.** **Required when the owner adds** a product (`VALIDATION_FAILED`, `fields.costMinor`: "Enter the cost price."); a manager's product is saved without it and shows in the owner's **"Cost price needed"** list (products whose pulled `costMinor` is `null`). A manager's edit keeps the existing cost. |
| `fields.lowStockLevelUnits` | Integer ≥ 0 **in units** (half yards for yard products), or `null` to use the business's `lowStockThreshold` (Decision 2-2). Since BE7. |
| `fields.lowStockWarnings` | `false` turns low-stock warnings off for this product (default `true`). Since BE7. |
| `fields.isHidden` | `true` hides the product from the selling list (past sales and reports keep it); `false` shows it again. Products are never deleted. |

The server sets `unitScale` itself (2 for `yard`, so 2.5 yards is 5 units; 1 for everything else).

- **Result (`saved`):** `{ "productId": "d521…", "version": 2, "warnings": [] }`. Keep `version` on the local product (it's the next `baseVersion`, and what a sale names as `productVersion` from BE8). The full row also comes in the next pull.
- **Warnings** (in `result.warnings`; the product **is saved**, show them so the person can change it):

| `code` | When | Words |
|---|---|---|
| `WHOLESALE_ABOVE_RETAIL` | The wholesale price is higher than the retail price. | "The wholesale price is higher than the retail price." |
| `BELOW_COST` | A selling price is below the cost price. **Owner only** (never sent to a manager). | "This price is below your cost price." |
| `PRODUCT_NAME_DUPLICATE` | Another product of the business (hidden ones too) has the same name, ignoring capitals and spaces. `productId`: that product. | "You already have a product with this name." with **Open it** and **Change the name**. |

  Duplicate names are **never rejected**: two phones may add the same product offline and each sell it before syncing. Only the one the server receives second gets the warning (the first had no twin yet); the first phone sees the other product in its next pull, so the app should also check names locally.
- **Rejected:** `FORBIDDEN`, `INVALID_PAYLOAD` (`fields`), `VALIDATION_FAILED` (`fields`), `NOT_FOUND`, `ID_TAKEN`, `SIZES_NOT_ALLOWED` (changing a product with sizes to fabric: "Fabric has no sizes."), `UNIT_LOCKED` (since BE7: switching between `yard` and another unit once the product has any stock movement or count).

#### `size.upsert`

Adds a size to a product, or edits one (label, position, its own prices, remove/restore). Fabric has no sizes; a product with no sizes simply has none.

- **Who:** owner and manager; **`costMinor` owner only** (as for products). **Since:** BE6.
- **Add:**

  ```json
  { "sizeId": "6c2e…", "productId": "d521…", "baseVersion": null, "fields": { "label": "42", "sortOrder": 12, "retailMinor": 14000 } }
  ```

- **Edit:** `{ "sizeId": "6c2e…", "productId": "d521…", "baseVersion": 1, "fields": { "isActive": false } }`

| Field | Rules |
|---|---|
| `sizeId` | UUID made on the phone. |
| `productId` | The size's product (it must be in the business, otherwise `NOT_FOUND`; a size can't move to another product: `VALIDATION_FAILED`, `fields.productId`). |
| `baseVersion` | `null` to add; the size's `version` edited, to edit. |
| `fields.label` | 1–20 characters, e.g. `42`, `XL`, `3Y`. **Required to add.** |
| `fields.sortOrder` | Integer, its position (sizes always show by `sortOrder`, never alphabetically). **Required to add.** |
| `fields.retailMinor`, `fields.wholesaleMinor` | This size's own price, or `null` to use the product's (AC19: for example sizes 42–46 cost more). Same range as product prices. |
| `fields.costMinor` | This size's own cost, or `null` to use the product's. **Owner only.** |
| `fields.isActive` | `false` removes the size from sale (it's kept for history); `true` brings it back. A size whose stock isn't 0 (above or below) can't be removed: `SIZE_HAS_STOCK`, "This size still has 3 in stock." (since BE7). |

A product has at most **60 sizes** (`VALIDATION_FAILED`, `fields.label`).

- **Result (`saved`):** `{ "sizeId": "6c2e…", "version": 1, "warnings": [] }`. Keep `version` (the next `baseVersion`, and a sale's `sizeVersion` from BE8).
- **Warnings:** `WHOLESALE_ABOVE_RETAIL` and `BELOW_COST` (owner only), using the prices this size really sells at (its own, else the product's); **`SIZE_LABEL_DUPLICATE`** with `sizeId`, when another active size of the product has the same label ("This product already has this size.").
- **Rejected:** `FORBIDDEN`, `INVALID_PAYLOAD`, `VALIDATION_FAILED`, `NOT_FOUND`, `ID_TAKEN`, `SIZES_NOT_ALLOWED`, `SIZE_HAS_STOCK`.

**A product with sizes, added offline:** push the `product.upsert` first, then one `size.upsert` per size, in one or more pushes (200 operations per push at most). If the product is rejected, its sizes come back `NOT_FOUND`: show them under the product in "Needs attention".

#### `stock.create`

Goods in or out of one size (or one product without sizes) at one shop: **opening** stock (the starting stock when a product is added: push it right after the product's `product.upsert` and `size.upsert`), a **restock** (a delivery: one operation per size with a quantity; empty boxes send nothing), or a **removal** (with a reason). A **permanent record**: never changed; a mistake is balanced by another movement.

- **Who:** owner and manager (associates: `FORBIDDEN`, Decision F-17). Sales, returns and exchanges make their own movements (BE8, BE10). **Since:** BE7.
- **Payload:**

  ```json
  {
    "movementId": "4b0d…", "type": "removal", "locationId": "c5ba…", "productId": "d521…", "sizeId": "6c2e…",
    "quantityUnits": 2, "reason": "damaged", "note": "Torn strap", "recordedAt": "2026-11-10T10:15:00.000Z"
  }
  ```

| Field | Rules |
|---|---|
| `movementId` | UUID made on the phone when the person saves. |
| `type` | `opening`, `restock` or `removal`. |
| `locationId` | The shop (from the `location` pull row; one shop at launch). Unknown: `NOT_FOUND`. |
| `productId`, `sizeId` | The product, and its size; `sizeId` is **required when the product has active sizes** (`fields.sizeId`: "Choose a size.") and `null` when it has none. A size of another product: `VALIDATION_FAILED`. No `opening` or `restock` into a removed size ("This size has been removed."); a removal is allowed. |
| `quantityUnits` | **Positive** integer **in units** (the server stores removals as negative): from 1 to 100,000 in the product's unit, so for yard products 1 to 200,000 half yards (**2.5 yards = 5**). Fractions other than half yards: refuse on the phone with "Use whole or half yards (for example, 2.5)." |
| `reason` | **Removals only, required:** `damaged`, `lost`, `supplier_return`, `used`, `other` (see Enums). Other types must not send it. |
| `note` | 1–200 characters, optional; **required when the reason is `other`** ("Write what happened."). A restock's note can hold the supplier's name. |
| `recordedAt` | When the person saved it, from the phone's clock, UTC ISO 8601 (`toISOString()`). |

- **Never refused for short stock** (Decision 2-3, F-8): the phone stops a removal of more than it shows (AC7, "Only 3 in stock"), but if another phone's records made it short meanwhile, the server still saves it.
- **Result (`saved`):** `{ "movementId": "4b0d…", "stockOnHandUnits": 3, "flags": { "belowZeroOnArrival": false, "clockSkew": false } }`.
- **`flags`** (set once when saved, never changed; also in the pull row):
  - `belowZeroOnArrival`: the size's stock was below zero right after this record arrived. **Current stock always comes from the stock rule**, never from this flag (later records may fix it).
  - `clockSkew`: `recordedAt` is more than 10 minutes in the future, or the record says it was made online (`recordedOnline`) and arrived more than 10 minutes from `recordedAt`.
- **Rejected:** `FORBIDDEN`, `INVALID_PAYLOAD`, `VALIDATION_FAILED` (`fields`: `sizeId`, `quantityUnits`, `reason`, `note`), `NOT_FOUND`, `ID_TAKEN`.

#### `stockCount.create`

A physical count of one size at one shop (AC10–AC12, Decision 2-5): the number **on the shelf**, plus what the phone showed when counting. The difference is **worked out, never sent**. A permanent record.

- **Who:** owner and manager (associates: `FORBIDDEN`). **Since:** BE7.
- **Payload:**

  ```json
  {
    "countId": "9a1e…", "locationId": "c5ba…", "productId": "d521…", "sizeId": "6c2e…",
    "countedUnits": 8, "baselineUnits": 10, "baselineCursor": 120,
    "reason": "lost_or_stolen", "note": null, "recordedAt": "2026-11-10T10:00:00.000Z"
  }
  ```

| Field | Rules |
|---|---|
| `countId` | UUID made on the phone. |
| `locationId`, `productId`, `sizeId` | As in `stock.create` (a removed size can be counted). |
| `countedUnits` | What is on the shelf, **in units** (half yards for yard products), 0 or more, at most 100,000 in the product's unit. |
| `baselineUnits` | What the phone showed for this size when the count was made (may be below zero). |
| `baselineCursor` | The phone's pull cursor at that moment. |
| `reason` | **Only when `countedUnits` ≠ `baselineUnits`, and then required:** `damaged`, `lost_or_stolen`, `miscounted_before`, `other` (see Enums). When they match, send no reason (the count is "Checked, correct"); a reason then is refused. |
| `note` | 1–200 characters, optional; **required when the reason is `other`**. |
| `recordedAt` | When the count was made (phone clock, UTC ISO 8601). |

- **Result (`saved`):** `{ "countId": "9a1e…", "expectedUnits": 10, "differenceUnits": -2, "stockOnHandUnits": 8 }`: the difference **as the server knows it now**. Records that arrive later can change it (that's the point); always show the difference worked out with the stock rule from the pulled rows.
- **Rejected:** `FORBIDDEN`, `INVALID_PAYLOAD`, `VALIDATION_FAILED` (`fields`: `sizeId`, `countedUnits`, `reason`, `note`), `NOT_FOUND`, `ID_TAKEN`.

#### `customer.upsert`

Adds a customer (AC15: added quickly during a sale, with a name and an optional phone number, without leaving the sale). **Since BE8 only adding** (`baseVersion: null`); editing a customer and setting credit limits arrive with BE9.

- **Who:** every role. **Since:** BE8.
- **Payload:**

  ```json
  { "customerId": "7c1d…", "baseVersion": null, "fields": { "name": "Ama Owusu", "phone": "024 555 1234", "language": "tw" } }
  ```

| Field | Rules |
|---|---|
| `customerId` | UUID made on the phone. A sale can name it straight after, in the same push. |
| `baseVersion` | Must be `null` (any number: `INVALID_PAYLOAD` until BE9). |
| `fields.name` | 1–60 characters (trimmed, double spaces removed). |
| `fields.phone` | Optional; a mobile number read with the business's country, stored E.164 (`VALIDATION_FAILED`, `fields.phone`: "Enter a valid mobile number, for example 024 123 4567."). |
| `fields.language` | Optional language tag for the customer's receipts and messages; default the business's `defaultLanguage`. |

The business's `defaultCreditLimitMinor` (settings) is copied in as the customer's credit limit; the balance starts at 0. Neither is ever sent by the phone.

- **Result (`saved`):** `{ "customerId": "7c1d…", "version": 1 }`.
- **Rejected:** `INVALID_PAYLOAD`, `VALIDATION_FAILED`, `ID_TAKEN`.

#### `sale.create`

One confirmed sale (AC18–AC19): its lines, payments and the customer if any. Saved **in one piece** with its stock movements (one per line) and the receipt number. A **permanent record**: nobody can ever change or delete it; mistakes are fixed by corrections (BE10).

- **Who:** every role (an associate's sales come back to them only). **Since:** BE8.
- **Payload:**

  ```json
  {
    "saleId": "2f6a…", "receiptNumber": "K7M-0042", "locationId": "c5ba…", "customerId": "7c1d…", "priceType": "retail",
    "items": [
      { "itemId": "91b0…", "productId": "d521…", "sizeId": "6c2e…", "quantityUnits": 2, "productVersion": 3, "sizeVersion": 1,
        "setPriceMinor": 12000, "agreedPriceMinor": 11000, "lineTotalMinor": 22000, "priceNote": "Bargained" },
      { "itemId": "a3c4…", "productId": "e7f8…", "sizeId": null, "quantityUnits": 5, "productEditOpId": "0e5f…",
        "setPriceMinor": 1505, "agreedPriceMinor": 1505, "lineTotalMinor": 3763 }
    ],
    "payments": [ { "paymentId": "b6d2…", "method": "cash", "amountMinor": 20000 }, { "paymentId": "c8e9…", "method": "mobile_money", "amountMinor": 5000 } ],
    "subtotalMinor": 25763, "paidMinor": 25000, "creditMinor": 763,
    "recordedAt": "2026-11-12T09:15:00.000Z"
  }
  ```

| Field | Rules |
|---|---|
| `saleId` | UUID made on the phone when the sale is confirmed. |
| `receiptNumber` | `<this phone's deviceCode>-<counter>`, e.g. `K7M-0042`: made on the phone, one counter per business on the phone, never reused. Another phone's code: `RECEIPT_NUMBER_INVALID`; a number already used: `RECEIPT_NUMBER_TAKEN`. |
| `locationId` | The shop. |
| `customerId` | A customer of the business, or `null`. **Required when any part is on credit** (`fields.customerId`: "Choose a customer for the part on credit."). |
| `priceType` | `retail` or `wholesale`, for the whole sale (Decision 3-5). |
| `items` | 1–100 lines. |
| `items[].itemId` | UUID made on the phone. It is also the **ID of the sale's stock movement** for this line, so the phone's own copy of that movement matches the one it pulls. Returns (BE10) point at it. |
| `items[].productId`, `sizeId` | The product and its size (`null` without sizes). A hidden product or removed size is **still saved** (the goods have gone): the phone stops new sales of them (AC5). |
| `items[].quantityUnits` | Integer **units**, 1 to 100,000 in the product's unit (yard products: half yards, so 2.5 yards = 5). |
| `items[].productVersion` **or** `productEditOpId` | Exactly one: the product's `version` the phone was showing, or, when the phone edited the product itself and hasn't had the answer yet, that edit's `opId` (the edit must come earlier in the outbox). |
| `items[].sizeVersion` **or** `sizeEditOpId` | The same for the size; neither when `sizeId` is `null`. |
| `items[].setPriceMinor` | The set price of that version, by the **sale rule** (below). Anything else: `PRICE_VERSION_MISMATCH`. |
| `items[].agreedPriceMinor` | The price the customer agreed, per unit of the product's unit (per yard for yards), 0 or more (any price, Decision 3-1). |
| `items[].lineTotalMinor` | By the **sale rule**: `quantityUnits × agreedPriceMinor ÷ unitScale`, **rounded to the nearest minor unit, halves up**. |
| `items[].priceNote` | 1–200 characters; **required when the agreed price differs from the set price** (AC9: a quick note such as "Bargained", or typed). |
| `payments` | 0–10, **one per method** (cash and MoMo split = two). `method`: a payment-method code; the business's `paymentMethods` are the ones to offer. `amountMinor` ≥ 1. A code that doesn't exist: `PAYMENT_METHOD_UNKNOWN`; a real method the business has since switched off: saved and flagged `methodDisabled`. |
| `subtotalMinor` | The sum of the line totals. |
| `paidMinor` | The sum of the payments; never more than the subtotal. |
| `creditMinor` | `subtotalMinor − paidMinor` (0 or more). |
| `recordedAt` | When the sale was confirmed (phone clock, UTC ISO 8601). |

- **The server recalculates everything** from the versions and the sale rule; the phone's figures must match exactly, otherwise `SALE_TOTALS_MISMATCH` (`fields` names the field and the expected value). The **cost** is set by the server from the same version; never send one.
- **Never refused for what happened in the shop:** stock below zero, over the customer's credit limit (even an associate's sale: the **phone** stops associates, AC16), below cost, an older price, a rounded half yard, a switched-off payment method. The sale is **saved and flagged** (see Enums, "sale flag").
- **What the sale changes:** stock (one `sale` movement per line, ID = `itemId`), the customer's `balanceMinor` (+ the credit part) and `oldestUnpaidAt`, and on the business's first money record `localeLocked` becomes `true`.
- **Result (`saved`):** `{ "saleId": "2f6a…", "receiptNumber": "K7M-0042", "subtotalMinor": 25763, "paidMinor": 25000, "creditMinor": 763, "flags": { … } }`; `flags` only those this person may see.
- **Rejected:** `INVALID_PAYLOAD`, `VALIDATION_FAILED` (`fields`: `items.N.priceNote`, `items.N.quantityUnits`, `customerId`, `payments.N.method`), `NOT_FOUND` (product, size, customer or shop not in this business), `SALE_TOTALS_MISMATCH`, `PRICE_VERSION_MISMATCH`, `UNKNOWN_PRICE_VERSION`, `RECEIPT_NUMBER_TAKEN`, `RECEIPT_NUMBER_INVALID`, `PAYMENT_METHOD_UNKNOWN`, `ID_TAKEN`. Each is permanent: "Needs attention".

---

## The sale rule (server and phone)

The phone works out every number on the confirmation screen with **this exact rule**, and the server checks it the same way. All integers.

1. **Set price** of a line, from the prices of the **versions it names** (the `product` and `size` rows the phone had):
   - retail: the size's own `retailMinor`, else the product's;
   - wholesale: the size's own `wholesaleMinor`, else the product's `wholesaleMinor`, else the retail price from the line above.
2. **Line total** = `quantityUnits × agreedPriceMinor ÷ unitScale`, **rounded to the nearest minor unit, halves up**. In integers: `floor((2 × quantityUnits × agreedPriceMinor + unitScale) / (2 × unitScale))`. Show the rounded total **before** confirming (half a yard at GH₵ 15.05 shows "GH₵ 7.53"). A rounded line is saved with the `roundedLine` flag (decided 9 Nov 2026), never rejected.
3. **Subtotal** = Σ line totals; **paid** = Σ payments; **credit** = subtotal − paid (never below 0).
4. A line's agreed price **≠** its set price needs a `priceNote`.

**Shared test fixtures.** The server tests its rule against exactly these cases (`tests/fixtures/sale-rule.json`); the app must test its copy against them too.

<!-- sale-rule-fixtures:start -->
```json
{
  "about": "Shared fixtures for the sale rule (server src/services/saleRule.js and the phone app). docs/api.md shows this exact JSON; a test keeps them identical.",
  "lineTotal": [
    { "name": "whole units: 3 × GH₵ 10.00", "quantityUnits": 3, "agreedPriceMinor": 1000, "unitScale": 1, "expect": { "lineTotalMinor": 3000, "rounded": false } },
    { "name": "2.5 yards at GH₵ 12.00 a yard (5 half yards)", "quantityUnits": 5, "agreedPriceMinor": 1200, "unitScale": 2, "expect": { "lineTotalMinor": 3000, "rounded": false } },
    { "name": "half a yard at GH₵ 15.05: 752.5 rounds up to 753", "quantityUnits": 1, "agreedPriceMinor": 1505, "unitScale": 2, "expect": { "lineTotalMinor": 753, "rounded": true } },
    { "name": "1.5 yards at GH₵ 15.01: 2251.5 rounds up to 2252", "quantityUnits": 3, "agreedPriceMinor": 1501, "unitScale": 2, "expect": { "lineTotalMinor": 2252, "rounded": true } },
    { "name": "half a yard at GH₵ 15.04: exactly 752, no rounding", "quantityUnits": 1, "agreedPriceMinor": 1504, "unitScale": 2, "expect": { "lineTotalMinor": 752, "rounded": false } },
    { "name": "half a yard at 1 pesewa: 0.5 rounds up to 1", "quantityUnits": 1, "agreedPriceMinor": 1, "unitScale": 2, "expect": { "lineTotalMinor": 1, "rounded": true } },
    { "name": "a free item (agreed price 0)", "quantityUnits": 2, "agreedPriceMinor": 0, "unitScale": 1, "expect": { "lineTotalMinor": 0, "rounded": false } },
    { "name": "the largest line: 100,000 yards at GH₵ 1,000,000.00", "quantityUnits": 200000, "agreedPriceMinor": 100000000, "unitScale": 2, "expect": { "lineTotalMinor": 10000000000000, "rounded": false } }
  ],
  "setPrice": [
    { "name": "retail, no size", "priceType": "retail", "product": { "retailMinor": 12000, "wholesaleMinor": 10000 }, "size": null, "expect": 12000 },
    { "name": "retail, the size's own price", "priceType": "retail", "product": { "retailMinor": 12000, "wholesaleMinor": 10000 }, "size": { "retailMinor": 14000, "wholesaleMinor": null }, "expect": 14000 },
    { "name": "wholesale, the size has none: the product's wholesale", "priceType": "wholesale", "product": { "retailMinor": 12000, "wholesaleMinor": 10000 }, "size": { "retailMinor": 14000, "wholesaleMinor": null }, "expect": 10000 },
    { "name": "wholesale, the size's own wholesale", "priceType": "wholesale", "product": { "retailMinor": 12000, "wholesaleMinor": 10000 }, "size": { "retailMinor": 14000, "wholesaleMinor": 11500 }, "expect": 11500 },
    { "name": "wholesale with no wholesale price anywhere: the retail price (the size's own)", "priceType": "wholesale", "product": { "retailMinor": 12000, "wholesaleMinor": null }, "size": { "retailMinor": 14000, "wholesaleMinor": null }, "expect": 14000 },
    { "name": "wholesale with no wholesale price, no size: the product's retail", "priceType": "wholesale", "product": { "retailMinor": 12000, "wholesaleMinor": null }, "size": null, "expect": 12000 }
  ]
}
```
<!-- sale-rule-fixtures:end -->

---

## The stock rule (server and phone)

Stock is **never stored as a number** anywhere: the server and the phone both work it out from the `stockMovement` and `stockCount` rows, with **this exact rule**, for one size (or a product without sizes) at one shop. The phone keeps a `stockLevels` table updated with it (Epic 2, Story 2.4), rebuilt after each pull.

1. **Order:** every row has a **stock key** `(recordedAt, id)`: earlier `recordedAt` first; at the same instant, the smaller `id`, comparing the lower-case UUIDs as plain strings, character by character. Never use `serverSeq` or arrival order.
2. **Stock on hand:** with no count, the **sum of all movements' `quantityUnits`**. With counts, the **latest count's `countedUnits` plus the movements after it** (by stock key). Movements before the latest count are already in what was on the shelf, so a sale recorded at 09:55 that arrives after a 10:00 count changes nothing, and one at 10:05 is subtracted.
3. **A count's difference:** `expectedUnits` = stock on hand worked out from **only the rows before the count** (rule 2 applied to them); `differenceUnits = countedUnits − expectedUnits` (+ found more, − fewer). Show it as "Counted 8, expected 7: +1". It changes when a record from before the count arrives late: that's correct.
4. **Check this count** (`countCheck`, worked out, never stored): `true` when **any movement** recorded within **10 minutes** of the count (before or after) has a **`receivedAt` later than the count's `receivedAt`**: a late record near the count time, which a wrong phone clock could have put on the wrong side. Show "Check this count: a sale near the count time arrived late".
5. Stock can be **below zero** (Decision F-8): show "Below zero: check the shelf". **Low** (AC19): above 0 and at or below the product's `lowStockLevelUnits` (or, when `null`, the business's `lowStockThreshold` in **whole units of the product's unit**: for yard products, compare in yards); **Out of stock** at 0. Hidden products and products with `lowStockWarnings: false` never show as low.
6. Quantities shown to people: `quantityUnits / unitScale` with the unit ("12 pairs", "2.5 yards").

**Shared test fixtures.** The server tests its rule against exactly these cases (`tests/fixtures/stock-rule.json`); the app must test its copy against them too. For each case: `stockOnHand` for all its rows, and for each listed count `expectedUnits`, `differenceUnits` and `needsCheck`. The answers must not depend on the order of the rows.

<!-- stock-rule-fixtures:start -->
```json
{
  "about": "Shared fixtures for the stock rule (server src/services/stockRule.js and the phone app). docs/api.md shows this exact JSON; a test keeps them identical.",
  "cases": [
    {
      "name": "no count: stock is the sum of the movements",
      "movements": [
        { "id": "a0000000-0000-4000-8000-000000000001", "quantityUnits": 10, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "a0000000-0000-4000-8000-000000000002", "quantityUnits": -3, "recordedAt": "2026-11-10T09:00:00.000Z", "receivedAt": "2026-11-10T09:00:05.000Z" }
      ],
      "counts": [],
      "expect": { "stockOnHand": 7, "counts": [] }
    },
    {
      "name": "the worked example: A shows 10, B sells 3 at 09:58 offline, A counts 8 at 10:00, B's sale arrives later",
      "movements": [
        { "id": "b0000000-0000-4000-8000-000000000001", "quantityUnits": 10, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "b0000000-0000-4000-8000-000000000002", "quantityUnits": -3, "recordedAt": "2026-11-10T09:58:00.000Z", "receivedAt": "2026-11-10T11:30:00.000Z" }
      ],
      "counts": [
        { "id": "b0000000-0000-4000-8000-0000000000c1", "countedUnits": 8, "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:10.000Z" }
      ],
      "expect": {
        "stockOnHand": 8,
        "counts": [{ "id": "b0000000-0000-4000-8000-0000000000c1", "expectedUnits": 7, "differenceUnits": 1, "needsCheck": true }]
      }
    },
    {
      "name": "a movement recorded after the count is added to it; one long before it is absorbed and doesn't trigger a check",
      "movements": [
        { "id": "c0000000-0000-4000-8000-000000000001", "quantityUnits": 20, "recordedAt": "2026-11-10T07:00:00.000Z", "receivedAt": "2026-11-10T12:00:00.000Z" },
        { "id": "c0000000-0000-4000-8000-000000000002", "quantityUnits": -2, "recordedAt": "2026-11-10T10:30:00.000Z", "receivedAt": "2026-11-10T10:30:05.000Z" }
      ],
      "counts": [
        { "id": "c0000000-0000-4000-8000-0000000000c1", "countedUnits": 15, "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:10.000Z" }
      ],
      "expect": {
        "stockOnHand": 13,
        "counts": [{ "id": "c0000000-0000-4000-8000-0000000000c1", "expectedUnits": 20, "differenceUnits": -5, "needsCheck": false }]
      }
    },
    {
      "name": "two counts: only the latest is the starting point; each difference uses only the rows before it",
      "movements": [
        { "id": "d0000000-0000-4000-8000-000000000001", "quantityUnits": 10, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "d0000000-0000-4000-8000-000000000002", "quantityUnits": -1, "recordedAt": "2026-11-10T12:00:00.000Z", "receivedAt": "2026-11-10T12:00:05.000Z" },
        { "id": "d0000000-0000-4000-8000-000000000003", "quantityUnits": 4, "recordedAt": "2026-11-10T16:00:00.000Z", "receivedAt": "2026-11-10T16:00:05.000Z" }
      ],
      "counts": [
        { "id": "d0000000-0000-4000-8000-0000000000c1", "countedUnits": 9, "recordedAt": "2026-11-10T09:00:00.000Z", "receivedAt": "2026-11-10T09:00:10.000Z" },
        { "id": "d0000000-0000-4000-8000-0000000000c2", "countedUnits": 6, "recordedAt": "2026-11-10T14:00:00.000Z", "receivedAt": "2026-11-10T14:00:10.000Z" }
      ],
      "expect": {
        "stockOnHand": 10,
        "counts": [
          { "id": "d0000000-0000-4000-8000-0000000000c1", "expectedUnits": 10, "differenceUnits": -1, "needsCheck": false },
          { "id": "d0000000-0000-4000-8000-0000000000c2", "expectedUnits": 8, "differenceUnits": -2, "needsCheck": false }
        ]
      }
    },
    {
      "name": "same instant: the smaller id comes first (a movement with a larger id than the count counts after it)",
      "movements": [
        { "id": "e0000000-0000-4000-8000-000000000001", "quantityUnits": 5, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "e0000000-0000-4000-8000-0000000000f0", "quantityUnits": -1, "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:01.000Z" },
        { "id": "e0000000-0000-4000-8000-000000000002", "quantityUnits": -2, "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:01.000Z" }
      ],
      "counts": [
        { "id": "e0000000-0000-4000-8000-0000000000c1", "countedUnits": 3, "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:01.000Z" }
      ],
      "expect": {
        "stockOnHand": 2,
        "counts": [{ "id": "e0000000-0000-4000-8000-0000000000c1", "expectedUnits": 3, "differenceUnits": 0, "needsCheck": false }]
      }
    },
    {
      "name": "half yards: 2.5 yards is 5 units; selling 1.5 yards is -3",
      "movements": [
        { "id": "f0000000-0000-4000-8000-000000000001", "quantityUnits": 5, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "f0000000-0000-4000-8000-000000000002", "quantityUnits": -3, "recordedAt": "2026-11-10T09:00:00.000Z", "receivedAt": "2026-11-10T09:00:05.000Z" }
      ],
      "counts": [],
      "expect": { "stockOnHand": 2, "counts": [] }
    },
    {
      "name": "below zero is allowed (two phones sold the last item)",
      "movements": [
        { "id": "a1000000-0000-4000-8000-000000000001", "quantityUnits": 1, "recordedAt": "2026-11-10T08:00:00.000Z", "receivedAt": "2026-11-10T08:00:05.000Z" },
        { "id": "a1000000-0000-4000-8000-000000000002", "quantityUnits": -1, "recordedAt": "2026-11-10T09:00:00.000Z", "receivedAt": "2026-11-10T09:30:00.000Z" },
        { "id": "a1000000-0000-4000-8000-000000000003", "quantityUnits": -1, "recordedAt": "2026-11-10T09:05:00.000Z", "receivedAt": "2026-11-10T09:31:00.000Z" }
      ],
      "counts": [],
      "expect": { "stockOnHand": -1, "counts": [] }
    }
  ]
}
```
<!-- stock-rule-fixtures:end -->

---

## Pull rows

Every row type a pull can return. `data` holds only the fields listed; the server removes what a role may not see.

| `type` | Owner | Manager | Sales associate |
|---|---|---|---|
| `settings` | ✅ | ✅ | ✅ |
| `location` | ✅ | ✅ | ✅ |
| `membership` | ✅ | ✗ | ✗ |
| `device` | ✅ | ✗ | ✗ |
| `product` | ✅ with `costMinor` | ✅ **no `costMinor`** | ✅ **no `costMinor`** |
| `size` | ✅ with `costMinor` | ✅ **no `costMinor`** | ✅ **no `costMinor`** |
| `stockMovement` | ✅ all fields | ✅ all fields | ✅ **only** `id`, `locationId`, `productId`, `sizeId`, `quantityUnits`, `recordedAt`, `receivedAt` |
| `stockCount` | ✅ all fields | ✅ all fields | ✅ **only** `id`, `locationId`, `productId`, `sizeId`, `countedUnits`, `recordedAt`, `receivedAt` |
| `customer` | ✅ | ✅ | ✅ (balance and limit, to sell and collect) |
| `sale` | ✅ all, with `unitCostMinor` and every flag | ✅ all, **no cost**, no `belowCost` | ✅ **their own sales only**, no cost, only `belowZeroOnArrival` and `clockSkew` |

Managers and associates learn their own role and business from `GET /api/auth/me`; the phone's copy of a role is for display only (the server checks it on every request).

**`settings`** (one row per business):

```json
{
  "businessId": "8a0b…", "businessName": "Ama Fabrics", "receiptPhone": null, "receiptNote": null,
  "paymentMethods": ["cash", "mobile_money"], "defaultLanguage": "en", "lowStockThreshold": 3,
  "returnPeriodDays": 7, "defaultCreditLimitMinor": null, "version": 1, "updatedBy": "c4d5…", "updatedAt": "2026-11-09T09:00:00.000Z"
}
```

`version` is the `baseVersion` to send with the next `settings.update`. `updatedBy` is a user ID, or `null` for a system change.

**`location`** (a shop or warehouse; stage 1: one shop): `{ "id": "…", "name": "Ama Fabrics", "type": "shop" }`. `type`: `shop` or `warehouse`.

**`membership`** (owner only; the team list, as in `GET /api/team`):

```json
{
  "id": "1b2c…", "userId": "8c7b…", "name": "Kofi Boateng", "phone": "+233241112233", "role": "associate",
  "status": "active", "invitedAt": null, "joinedAt": "2026-11-05T09:00:00.000Z", "removedAt": null
}
```

`id` is the `membershipId`. For an invitation (`status` `invited`, or `declined`/`removed` before it was accepted) `name` is **the name the owner typed** and `userId` is `null`: never the account's own details.

**`device`** (owner only; the phone list, as in `GET /api/devices`):

```json
{
  "id": "3f1c…", "deviceCode": "K7M", "name": "Ama's Tecno", "userId": "8c7b…", "isActive": true,
  "lastSeenAt": "…", "lastSyncAt": "…", "lockedUntil": null, "registeredAt": "…", "revokedAt": null
}
```

`lastSeenAt` and `lastSyncAt` are updated at most every 5 minutes and **don't** by themselves put the row in a pull (call `GET /api/devices` for fresh values).

**`product`** (everyone; hidden products too, so past sales still show their names):

```json
{
  "id": "d521…", "name": "Black sandal", "type": "shoes", "unit": "pair", "unitLabel": null, "unitScale": 1,
  "retailMinor": 12000, "wholesaleMinor": 10000, "costMinor": 8000,
  "isHidden": false, "version": 2, "updatedBy": "407f…", "updatedAt": "2026-11-08T09:00:00.000Z"
}
```

`costMinor` is **only in the owner's rows** (`null` when no cost was entered yet: the "Cost price needed" list). For managers and associates the field is **not there at all**, so cost prices never reach their phones (AC20). `version` is the next `baseVersion`. Search uses the name on the phone (lower case, single spaces).

**`size`** (everyone):

```json
{
  "id": "6c2e…", "productId": "d521…", "label": "42", "sortOrder": 12,
  "retailMinor": 14000, "wholesaleMinor": null, "costMinor": null,
  "isActive": true, "version": 1, "updatedBy": "407f…", "updatedAt": "2026-11-08T10:15:00.000Z"
}
```

`null` prices mean "use the product's". `costMinor` as for products (owner only). Show only active sizes for selling, ordered by `sortOrder`. The price a size sells at: its own `retailMinor`/`wholesaleMinor`, else the product's (and for wholesale without any wholesale price, the retail price).

Prices are kept per version on the server (`PriceVersion`); that history is **never pulled**.

The `product` row also has (since BE7) `lowStockLevelUnits` (units, or `null` = the business's level) and `lowStockWarnings` (boolean).

**`stockMovement`** (everyone; associates get only the stock-rule fields, see the table):

```json
{
  "id": "4b0d…", "locationId": "c5ba…", "productId": "d521…", "sizeId": "6c2e…", "quantityUnits": -2,
  "recordedAt": "2026-11-10T10:15:00.000Z", "receivedAt": "2026-11-10T10:15:04.000Z",
  "type": "removal", "reason": "damaged", "note": "Torn strap",
  "flags": { "belowZeroOnArrival": false, "clockSkew": false }, "recordedBy": "407f…"
}
```

`quantityUnits` is **signed** here (+ in, − out). `type`, `reason`, `note`, `flags` and `recordedBy` are for the owner and managers (stock history, AC25; removals in the day summary, AC9). A movement is never changed or deleted, so a row with a known `id` never comes twice except when re-pulled from 0.

**`stockCount`** (everyone; associates get only the stock-rule fields):

```json
{
  "id": "9a1e…", "locationId": "c5ba…", "productId": "d521…", "sizeId": "6c2e…", "countedUnits": 8,
  "recordedAt": "2026-11-10T10:00:00.000Z", "receivedAt": "2026-11-10T10:00:10.000Z",
  "baselineUnits": 10, "reason": "lost_or_stolen", "note": null, "recordedBy": "407f…"
}
```

Work out its difference and "check this count" with the stock rule; they are not in the row.

The owner's and managers' `stockMovement` rows also have `saleId` (since BE8): the sale a `sale` movement belongs to, `null` otherwise. A sale's movement has the sale line's `itemId` as its `id`.

**`customer`** (everyone):

```json
{
  "id": "7c1d…", "name": "Ama Owusu", "phone": "+233245551234", "language": "tw", "isHidden": false,
  "creditLimitMinor": 50000, "balanceMinor": 763, "oldestUnpaidAt": "2026-11-12T09:15:00.000Z", "version": 1, "updatedAt": "…"
}
```

`balanceMinor` (what the customer owes; below zero = in credit, from BE9) and `oldestUnpaidAt` are **worked out by the server**; the row comes again whenever they change. Show "Updating…" next to a balance while the phone has unsent sales for that customer (AC19). `creditLimitMinor` `null` = no limit. **Associates** use the balance and limit to warn and stop over-limit credit (AC16) but get no "Who owes" list (Decision 4-6).

**`sale`** (owner and managers: all; an associate: **only their own**; lines and payments inside):

```json
{
  "id": "2f6a…", "receiptNumber": "K7M-0042", "locationId": "c5ba…", "deviceId": "3f1c…", "customerId": "7c1d…", "priceType": "retail",
  "subtotalMinor": 25763, "paidMinor": 25000, "creditMinor": 763,
  "flags": { "belowZeroOnArrival": false, "clockSkew": false, "olderPrice": true, "roundedLine": true },
  "recordedBy": "407f…", "recordedAt": "2026-11-12T09:15:00.000Z", "receivedAt": "2026-11-12T09:15:04.000Z",
  "items": [
    { "id": "91b0…", "productId": "d521…", "sizeId": "6c2e…", "productName": "Black sandal", "sizeLabel": "42",
      "unit": "pair", "unitLabel": null, "unitScale": 1, "quantityUnits": 2, "productVersion": 3, "sizeVersion": 1,
      "setPriceMinor": 12000, "agreedPriceMinor": 11000, "lineTotalMinor": 22000, "priceNote": "Bargained", "unitCostMinor": 8000 }
  ],
  "payments": [ { "id": "b6d2…", "method": "cash", "amountMinor": 20000 }, { "id": "c8e9…", "method": "mobile_money", "amountMinor": 5000 } ]
}
```

- `productName`, `sizeLabel`, `unit`, `unitLabel` and `unitScale` are **copies made when the sale was saved**: show these on the receipt and in sale details, never the product's current name.
- `unitCostMinor` is **only in the owner's rows** (for profit; `null` = no cost price yet, profit "incomplete"). The field isn't there for anyone else.
- `flags`: only the flags this person may see (Enums, "sale flag"); a flag the person may not see is **left out**, not `false`.
- A sale never changes, so its row never comes twice except when re-pulled from 0.

## Enums and flags

| Enum | Values | Words to show |
|---|---|---|
| `language` | `en`, `tw` (from `GET /api/reference`) | English, Twi |
| payment method | `cash`, `mobile_money` (the business's `paymentMethods`) | Cash, MoMo (names from `GET /api/reference` for the business's country) |
| `role` | `owner`, `manager`, `associate` | Owner, Manager, Sales associate |
| business `status` | `active`, `closing` | (nothing), Closing on [date] |
| member `status` | `active`, `invited`, `declined`, `removed` | (nothing), Waiting for them to accept, Declined, Removed |
| product `type` | `clothing`, `shoes`, `fabric`, `other` | Clothing, Shoes, Fabric, Other |
| product `unit` | `piece`, `pair`, `set`, `dozen`, `yard`, `custom` | piece/pieces, pair/pairs, set/sets, dozen, yard/yards ("2.5 yards"), the shop's own word (`unitLabel`) |
| product warning | `WHOLESALE_ABOVE_RETAIL`, `BELOW_COST` (owner only), `PRODUCT_NAME_DUPLICATE`, `SIZE_LABEL_DUPLICATE` | See `product.upsert` and `size.upsert` |
| stock movement `type` | `opening`, `restock`, `sale`, `return_in`, `exchange_in`, `exchange_out`, `removal` (BE7 sends the first, second and last; the others come with sales and corrections) | Starting stock, Added, Sold, Returned, Exchanged in, Exchanged out, Removed |
| removal `reason` | `damaged`, `lost`, `supplier_return`, `used`, `other` | Damaged, Lost or stolen, Returned to supplier, Used or given away, Other |
| count `reason` | `damaged`, `lost_or_stolen`, `miscounted_before`, `other` | Damaged, Lost or stolen, Miscounted before, Other |
| movement flag | `belowZeroOnArrival`, `clockSkew` | "Stock was below zero when this arrived", "The phone's clock looked wrong" |
| count check (worked out) | `countCheck` | "Check this count: a sale near the count time arrived late" |
| `priceType` | `retail`, `wholesale` | Retail, Wholesale |
| sale flag (who sees it) | `belowZeroOnArrival` (everyone who sees the sale), `clockSkew` (same), `overCreditLimit` (owner, manager), `afterDayClose` (owner, manager; always `false` until BE11), `belowCost` (**owner only**), `olderPrice` (owner, manager), `roundedLine` (owner, manager), `methodDisabled` (owner, manager) | "Stock was below zero when this arrived", "The phone's clock looked wrong", "Over credit limit", "Arrived after the day was closed", "Sold below cost", "Older price used", "A half-yard price was rounded", "Paid with a method that was switched off" |
