# Shop Book API (for the frontend)

The contract between the Shop Book server and the phone app. **The app uses only what this file lists.** It is written by the backend project as each server task is built, and copied unchanged into the frontend project after every backend task. If this file and a plan disagree about a request or response, this file wins (and the plan is corrected).

---

## Changes

Newest first.

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
| `NOT_FOUND` | 404 | No such endpoint, or a record that doesn't exist **or belongs to another business** (the server never says which). | Treat as a bug for endpoints; for a record, show "Not found". Don't retry. |
| `CSRF_HEADER_MISSING` | 403 | A `POST`/`PUT`/`PATCH`/`DELETE` without `X-Requested-With: XMLHttpRequest`. | App bug: the shared API helper must always send it. Don't retry. Report via Help. |
| `ORIGIN_NOT_ALLOWED` | 403 | The browser said the request came from another website. | Shouldn't happen from the app; don't retry. Report via Help. |
| `INVALID_JSON` | 400 | The body isn't valid JSON. | App bug; don't retry. |
| `INVALID_REQUEST` | 400 | The body couldn't be read (unsupported encoding or character set). | App bug; don't retry. |
| `PAYLOAD_TOO_LARGE` | 413 | The body is over 1 MB. | Send smaller batches (sync pushes stay well under it at 200 operations). |
| `RATE_LIMITED` | 429 | Too many requests of this kind. `Retry-After` says how many seconds to wait. | Wait and retry later; show a message only if it's a person's action (for example sign-in). |
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
| `INTERNAL_ERROR` | 500 | Something unexpected went wrong on the server. `message` is "Something went wrong. Reference: \<request id\>". | **Temporary:** keep any unsent records and retry later. Keep the reference (also in `X-Request-Id`) for the Help message. |

Other failures without the error format:

- **Network failure, timeout, or a 502/503/504 without the error format** (from the hosting) (for example while the free server wakes up, which can take up to a minute): **temporary**. Keep everything and retry later with back-off; show "Connecting…", not an error.

---

## Endpoints

Grouped by area as they arrive (accounts, devices, team, sync, reports, export, business, practice). Each endpoint heading is `### METHOD /path`. "Signed" means signed with the device key: from BE5 **every business endpoint** (those needing `X-Business`) must be signed; until then none is.

**Every business endpoint** can also answer, before anything else: `401 NOT_SIGNED_IN`, `400 BUSINESS_REQUIRED`, `404 NOT_FOUND` (not a member of that business), `403 ACCESS_REMOVED`, `403 BUSINESS_CLOSING`, `403 PASSWORD_CHANGE_REQUIRED`, `403 TERMS_REQUIRED`, and `403 FORBIDDEN` (role not allowed).

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
    "defaults": { "country": "GH", "language": "en" }
  }
  ```

- A country's `paymentMethods[].name` is what to show **in that country** (mobile money is "MoMo" in Ghana); the top-level list has the general names. A language with `status: "draft"` isn't fully translated: show English for missing texts. At launch there's one country (Ghana), so the country picker can be preselected and hidden.
- **Errors:** none. **Rate limit:** none. **Available since:** BE4.5.

### PATCH /api/business/locale

The owner changes the business's country, currency or time zone. Only possible until the business has its first money record (`localeLocked`); after that, `409 CURRENCY_LOCKED`. At launch the only valid values are `GH`, `GHS` and `Africa/Accra`, so the app needn't offer this screen yet.

- **Who:** owner. **Business:** yes (`X-Business`). **Signed:** not yet (from BE5).
- **Request:** `{ "country": "GH", "currency": "GHS", "timezone": "Africa/Accra" }`: at least one. Changing `country` alone also resets the currency, time zone and payment methods to that country's.
- **Response 200:** `{ "country": "GH", "currency": { "code": "GHS", "…": "…" }, "timezone": "Africa/Accra", "localeLocked": false }`. Refresh `GET /api/auth/me` afterwards.
- **Errors:** `409 CURRENCY_LOCKED`, `400 VALIDATION_FAILED` (`fields.country`: not supported; `fields.currency`: not supported; `fields.timezone`: not one of the country's time zones; or nothing to change), plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE4.5.

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

All team endpoints are **owner only** business endpoints: signed in, `X-Business` required, and the person must be that business's owner (others get `403 FORBIDDEN`). **Signed:** not yet; from BE5 they must be signed like every business endpoint.

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

Removes a member from **this** business, or cancels a pending invitation. **Their access to this business ends at once:** their very next request for it answers `403 ACCESS_REMOVED`, and their phone then wipes this business's local data. They stay signed in for any other business they belong to. Nothing they recorded is changed or lost. **From BE5, removing someone also revokes their phones for this business.**

- **Request:** no body.
- **Response 200:** `{ "member": member }` (status `removed`).
- **Errors:** `404 NOT_FOUND`, `409 OWNER_CANNOT_CHANGE`, `409 MEMBER_REMOVED` (already ended), plus the business-endpoint errors.
- **Rate limit:** none. **Available since:** BE3.

---

## Sync operations

None yet (from BE5).

## Pull rows

None yet (from BE5).

## Enums and flags

| Enum | Values | Words to show |
|---|---|---|
| `language` | `en`, `tw` (from `GET /api/reference`) | English, Twi |
| payment method | `cash`, `mobile_money` (the business's `paymentMethods`) | Cash, MoMo (names from `GET /api/reference` for the business's country) |
| `role` | `owner`, `manager`, `associate` | Owner, Manager, Sales associate |
| business `status` | `active`, `closing` | (nothing), Closing on [date] |
| member `status` | `active`, `invited`, `declined`, `removed` | (nothing), Waiting for them to accept, Declined, Removed |
