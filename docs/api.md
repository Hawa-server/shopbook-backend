# Shop Book API (for the frontend)

The contract between the Shop Book server and the phone app. **The app uses only what this file lists.** It is written by the backend project as each server task is built, and copied unchanged into the frontend project after every backend task. If this file and a plan disagree about a request or response, this file wins (and the plan is corrected).

---

## Changes

Newest first.

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
| `Origin` | Sent by the browser itself | Must be the app's own address. A request whose `Origin` is another website is refused with `403 ORIGIN_NOT_ALLOWED`. The app doesn't set this header. |

`fetch` options for every request: `credentials: "include"` (the session cookie arrives in BE2; the app never reads it).

### Response headers

| Header | On | Meaning |
|---|---|---|
| `X-Request-Id` | Every response | A UUID for this request. Keep the one from the **last failed** request: the Help message ("Report a problem") includes it, and it's the same reference a 500 error shows. |
| `Cache-Control: no-store` | Every `/api` response | Don't cache API answers (the service worker must never cache `/api`). |

### Data formats

- **Money:** whole **pesewas** as integers (`12000` = GH₵ 120.00). Never decimals. Show as "GH₵ 120.00".
- **Quantities:** whole **units** as integers, with the product's `unitScale` (1, or 2 for products sold by the yard: `5` units = "2.5 yards").
- **Times:** UTC ISO 8601 strings (`"2026-11-01T09:30:00.000Z"`). **Business dates** (a day in the shop) are `YYYY-MM-DD` in `Africa/Accra`.
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
| `INTERNAL_ERROR` | 500 | Something unexpected went wrong on the server. `message` is "Something went wrong. Reference: \<request id\>". | **Temporary:** keep any unsent records and retry later. Keep the reference (also in `X-Request-Id`) for the Help message. |

Other failures without the error format:

- **Network failure, timeout, or a 502/503/504 from the hosting** (for example while the free server wakes up, which can take up to a minute): **temporary**. Keep everything and retry later with back-off; show "Connecting…", not an error.

---

## Endpoints

Grouped by area as they arrive (accounts, devices, team, sync, reports, export, business, practice). Each endpoint heading is `### METHOD /path`.

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

## Sync operations

None yet (from BE5).

## Pull rows

None yet (from BE5).

## Enums and flags

None yet.
