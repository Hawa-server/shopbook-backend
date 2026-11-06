# Shop Book: App Plan (frontend project)

How to build the **phone app** for Shop Book: an installable web app (PWA) for Android phones that works fully offline and **syncs** with the server whenever there's data. The server has its own plan: `docs/server-plan.md`, which also holds the repository layout, the order of authority between documents, and the whole-project build order.

**Working with Claude Code:** the frontend is its own project (`STOREBOK_FRONTEND`, its own Git repository); open Claude Code in its root folder for every FE task. All its rules are in that project's `CLAUDE.md`. It can't see the backend; `docs/api.md` is copied in by me after each backend task. Git and deployment are done by me; Claude Code writes no deployment instructions.

**The app uses only what `docs/api.md` lists.** If this plan and `api.md` disagree about the server, `api.md` wins. If any two documents conflict: stop, say which ones, propose a fix, and wait.

---

## When app work can start

| App task | Needs first |
|---|---|
| FE0–FE2 | BE1–BE3 (sign-in and accounts aren't signed, so they don't need BE5) |
| FE3 (sync engine, device keys and signed requests) | BE5 **and BE5.5** (the server torture test passes) |
| FE4 (team and phones) | BE3 and BE5 (team and device routes are signed) |
| FE5 onwards (features) | **FE3.5** (the two-phone torture test passes), plus the matching server task |
| FE8 (customers and debts) | BE9 **and BE13** (the "Remind today" list uses `GET /reports/reminders`) |
| FE13, FE14 | BE15, BE16 (and BE17 for the Help message's version) |

---

## Stack

| Part | Choice |
|---|---|
| UI | React, Vite, React Router |
| Styling | Tailwind CSS (official Vite plugin), design values as CSS variables |
| Local database | **Dexie** (IndexedDB) with `dexie-react-hooks` for live screens |
| Offline app | **vite-plugin-pwa** (service worker, offline start, update prompt, manifest) |
| IDs | `crypto.randomUUID()` |
| PIN hashing | Web Crypto (PBKDF2), built into the browser |
| Device signing | Web Crypto (ECDSA P-256, non-extractable key; SHA-256 for body hashes; `getRandomValues` for nonces), built into the browser |
| Network | The browser's `fetch` through one shared API helper (no axios) |
| Security headers | Content-Security-Policy and the others set in `vercel.json` |
| Languages | A small dictionary (`src/i18n/en.js`, `src/i18n/tw.js`) and a `t()` helper; no library |
| Unit tests | Vitest (a dev-only package from the Vite team; never shipped to phones) for money maths, formatters, sale totals and the sync engine's decisions |

No other libraries without asking.

---

## Offline architecture

The phone is a **full working copy** of what the user is allowed to see. Every screen reads from the **local Dexie database**, never directly from the network. The network is only used by the sync engine (and sign-in, team and device screens).

```text
Screen ──reads──▶ Dexie (live queries)
Screen ──saves──▶ Dexie record + outbox operation (one transaction)
Sync engine ──push outbox──▶ server ──pull changes──▶ Dexie
```

### One local database per business

A person can belong to two businesses: the real one and its practice shop (backlog F-24). So every business gets **its own Dexie database**, named `shopbook-<businessId>`, holding all the tables below, including its own outbox, cursor, device ID and code, and receipt counter. A small shared database, `shopbook-app`, holds only what isn't business data: the signed-in user, which business is open, language, and the PIN hash. Switching business closes one database and opens the other; nothing ever mixes. Wiping a business (`ACCESS_REMOVED`, `DEVICE_REVOKED`) deletes only that business's database.

### Dexie tables

| Table | Holds |
|---|---|
| `products`, `sizes` | Products and sizes (cost fields only on the owner's phone, because only she receives them) |
| `stockMovements` | Stock movements |
| `stockCounts` | Physical counts (counted number, the number the phone showed, the phone's cursor then) |
| `stockLevels` | Quantity on hand per product and size, updated in the same transaction as every movement or count and rebuilt after each pull with the count rule (so lists open fast) |
| `priceVersions` | The version number of each product and size the phone holds, so every sale line can name it (`productVersion`, `sizeVersion`, or `editOpId` for an edit not yet sent) |
| `customers` | Customers, with the server's `balancePesewas` |
| `sales`, `saleItems`, `salePayments` | Sales |
| `corrections`, `correctionItems` | Returns and exchanges |
| `repayments` | Debt repayments |
| `openingDebts` | Debts brought forward from the notebook (owner and manager phones) |
| `expenses`, `expenseCategories` | Expenses |
| `dayCloses` | Day closes |
| `memberships`, `devices` | Team and phones (owner) |
| `settings` | Business settings (threshold, default language) |
| `outbox` | Operations waiting to be sent: `opId, type, payload, createdAt, attempts, lastError, nextTryAt` |
| `needsAttention` | Operations the server rejected: the operation, the error code and message, `rejectedAt` |
| `meta` | For this business: sync cursor, last successful sync, device ID and code, receipt counter, my role. (The signed-in user, open business, language, PIN hash and salt and wrong-PIN count live in the shared `shopbook-app` database.) |

Records that came from the server carry `serverSeq`; records made on this phone and not yet sent have none, which is how the app knows they're "Not sent yet".

### Versioned migrations

- The schema is declared with `db.version(n).stores({...})`, and **every change adds a new version** with an `.upgrade()` function if existing rows need changing. Old versions are never edited.
- The outbox and `needsAttention` are **never cleared by an upgrade**.
- Each new version is tested by installing the previous build, adding records offline (some unsent), then updating: every record and every unsent operation must still be there.

### Saving something (atomic local save)

1. Build the record with a new UUID (`crypto.randomUUID()`) and the phone's `recordedAt`.
2. Check it locally (the same rules as the server where possible, for example the **sale invariants** below) so mistakes are caught at the stall, not later.
3. In **one Dexie transaction**: write the record (and its items, payments and stock movements) **and** add its outbox operation. If any part fails, nothing is saved, and the screen says so.
4. The screen updates straight away (live queries). Sync starts in the background.

**Never wait for the network to save.**

### Sale invariants (checked before saving, and again on the server)

- each line: `lineTotal = quantity × agreedPrice` (with half yards, `quantityUnits × agreedPrice ÷ unitScale`, a whole number of pesewas)
- `subtotal = sum of line totals`, `paid = sum of payments`, `credit = subtotal − paid`
- `paid ≤ subtotal`, `credit ≥ 0`; credit needs a customer
- a changed price needs a note

### Receipt numbers

- Made on the phone: `deviceCode-number`, for example `K7M-0042`. The counter lives in `meta` and is increased **inside the same transaction** as the sale, correction or repayment, so two quick sales can never share a number.
- The counter only goes up; numbers are never reused, even if the operation is later rejected.
- If the phone is wiped or the app reinstalled, it registers as a **new device** with a new code, so old numbers can't repeat.

---

## Sync engine (`src/sync/`)

**When it runs:** when the app opens, every 3 minutes while open, right after a save, and when the phone reconnects (`online` event). Only **one sync at a time** (a simple lock in memory).

**Each run:**

1. **Push:** send up to 200 outbox operations, oldest first. Each operation carries `recordedOnline` (whether the phone had a connection when the record was made, saved with the outbox entry), an untrusted hint the server uses only for the clock-skew flag.
   - `saved` or `duplicate` → save the result on the local record, then remove the operation from the outbox (in one Dexie transaction).
   - `rejected` → move to `needsAttention` with the message. **Never silently dropped.**
   - `rejected` with code `OP_ID_CONFLICT` (a per-operation result in the normal 200 answer, not an HTTP error) → also to `needsAttention`, marked "App problem: tell the developer" (it means this phone sent two different things with the same ID, which is a bug); the Help message includes it.
   - Network error, timeout or 5xx → keep; retry with back-off (30 s, 1 min, 2 min, 5 min, then every 5 min). A 5xx is **never** treated as a rejection.
   - Repeat until the outbox is empty or an error stops it.
2. **Pull:** `GET /sync/pull?since=<cursor>`, page by page, until `hasMore` is false. For each page, write the rows into Dexie and set the cursor to the answer's `nextCursor` **in the same transaction**; if writing fails, the cursor doesn't move and the page is fetched again next time. A page can have **no rows** and still move the cursor (the server skipped rows this person may not see); that's normal.
3. Save the last successful sync time.

**Special answers:**

| Answer | What the phone does |
|---|---|
| 401 (session expired) | **Keep all local data and the outbox.** Ask the user to sign in again; then carry on syncing. Selling continues offline meanwhile. |
| 403 `ACCESS_REMOVED` or `DEVICE_REVOKED` | Wipe **that business's** local database, including its outbox, and explain why in plain words. Other businesses on the phone (for example the practice shop) are left alone; sign out only if no business is left. |
| 403 `BUSINESS_CLOSING` | Stop syncing that business. The owner sees the "Closing on [date]" screen (FE13); staff see "This business has been closed by the owner." Local records are kept until the owner cancels or the 30 days end. |
| 429 (too many requests) | Wait and retry later; no message unless it lasts. |

**The free server wakes slowly** (server plan, Free-tier hosting). When the app opens, it calls `GET /api/health` in the background to start waking the server. Sync requests wait up to **60 seconds** before giving up; a timeout counts as a temporary failure (retry with back-off), and the status bar shows "Connecting…" rather than an error. Records are already safe on the phone, so a slow server never blocks selling.

### Sync states (shown to the user)

| State | Meaning | Shown as |
|---|---|---|
| **Not sent yet** | Saved on this phone, in the outbox | A small clock icon with "Not sent yet" |
| **Sending…** | A sync is running | "Sending…" on the status bar |
| **Sent** | The server has it | No mark (the normal case) |
| **Needs attention** | The server rejected it | A warning icon with "Needs attention" and the reason |

The sync status screen shows: "All records sent" or "3 not sent yet · last sync 10:42", the "Needs attention" list, and warnings (below).

### Needs attention

Each rejected record is shown with what it was ("Sale K7M-0042, GH₵ 120.00"), the reason in plain words, and what to do (usually: "Tell the owner" or "Record it again correctly"). Records here **stay visible** until the user marks them as seen; marking one never deletes the original record from the phone's history.

### Storage safety

- On first sign-in, call `navigator.storage.persist()`.
- Warn on the sync status screen if storage isn't persistent, or if there are unsent records older than 2 days.
- **Sign out** with unsent records shows a warning and the count, and needs a second confirmation.

---

## Sign-in, PIN and offline access

- The session is an HTTP-only cookie from the server (idle 30 days, absolute 90 days). The app never sees the token.
- The app **works offline without the session**: the session is only needed to sync. When it expires, selling continues, and the user is asked to sign in when there's data.
- **PIN lock:** a 4-digit PIN, stored only on the phone as a PBKDF2 hash (Web Crypto, random salt, at least 100,000 iterations). Asked on opening and after **5 minutes** in the background. **5 wrong PINs** → the app locks until a full online sign-in. A PIN is set per person on that phone and never sent to the server.
- **Sign up:** name, phone number, **email**, business name, password (shown rules: at least 8 characters), language, and a required tick "I accept the privacy notice and terms" with links that open both (from `GET /legal/current`, in the chosen language).
- **Sign in:** one field, **"Phone number or email"**, plus password. Errors say "Wrong phone number, email or password." Below the button: **Forgot password?**
- **Forgot password:** enter phone number or email → "If that account has a confirmed email, we've sent a link. Check your inbox and spam." Also: "No email? Ask your shop owner to reset your password." The emailed link opens `/reset-password?token=…` in the app: new password twice → "Password changed. Sign in again." The token is taken from the address and removed from it straight away (`history.replaceState`), never stored or logged.
- **Confirm email:** the link opens `/confirm-email?token=…` → "Email confirmed". Until then, Settings shows "Email not confirmed" with **Send the link again** (not a blocking screen: the app works offline from the first minute).
- **Settings → My account:** change password, phone number or email (each asks for the current password), add an email (staff), language. Changing any of them signs out the person's other phones.
- **Terms at a staff member's first sign-in:** after choosing their own password, staff see the same tick before using the app (the server answers 403 `TERMS_REQUIRED` until then).

---

## PWA update safety

- The update prompt says "A new version is ready" with **Update now** and **Later**. The app never reloads itself while a screen has unsaved input (a sale in progress).
- Before reloading, the app finishes any running sync and save.
- Each release is tested by: installing the old version, making unsent records offline, updating, and checking every record and outbox operation survived (see versioned migrations).
- The service worker caches the app's files only; it never caches `/api` responses.

---

## Same-site API

Requests go to `/api` on the app's own address. Locally the Vite proxy forwards to the server; in production `vercel.json` rewrites `/api/*` to the server. Every request goes through **one shared API helper** that sends `X-Requested-With: XMLHttpRequest`, `credentials: "include"`, and `X-Business: <the open business's id>` (the server only accepts the person's own businesses), reads the error format, and records the `X-Request-Id` of the last error for the Help message.

### Device key and signed requests (server plan: Devices; backlog F-26)

- **On registering this phone for a business** (FE3): `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])`. The private key is **non-extractable** and is stored as a `CryptoKey` in that business's Dexie `meta`. Then `POST /devices/challenge`, sign the challenge with the new key, and `POST /devices` with the device ID, name, public key (JWK), challenge, signature and the person's password (reused from the sign-in screen just completed; asked again if registering later). The key never leaves the phone and is never logged; the password isn't kept.
- **The API helper signs every business request:** it builds the text (method, path with query, SHA-256 of the exact body string it sends, device ID, business ID, timestamp, nonce, one per line), signs it with `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, …)`, and adds `X-Device-Id`, `X-Signed-At`, `X-Nonce` (16 random bytes, `crypto.getRandomValues`) and `X-Signature`. The body is turned into a string **once**, and that same string is both hashed and sent.
- **Clock:** every response's `X-Server-Time` updates a stored offset (server time − phone time); `X-Signed-At` uses phone time + offset. On `401 CLOCK_OUT_OF_RANGE`, update the offset from the answer and retry once.
- **Key missing** (storage cleared, or `DEVICE_SIGNATURE_INVALID` after a reinstall): ask the person to sign in again, register as a new device, and tell the owner's phone list shows the old one to revoke.
- **Content-Security-Policy** (in `vercel.json` headers): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. No inline scripts, no `dangerouslySetInnerHTML`, no scripts from other sites. This is what protects the signing key from injected code.

---

## Calculations on the phone

- **Stock on hand** uses the server's count rule (server plan, Calculated): the latest count's number plus the movements recorded after it (by `recordedAt`, then `id`), or all movements if never counted; kept ready in `stockLevels`. A count saves **what was counted** (and the stock the phone showed), never a difference; the difference shown is worked out. A size is **Low** at or below its product's level (or the business's, default 3), **Out of stock** at 0, and **Below zero** under 0.
- **Customer balances** come from the server's `balancePesewas` (associates don't hold everyone's sales). After a local sale or repayment not yet sent, show the server balance adjusted by this phone's unsent records, labelled "Updating…".
- **Totals** on the phone are for display and checking; the server recalculates everything.
- **Money** is whole pesewas; one shared helper formats it as "GH₵ 120.00" and one parser turns typed amounts into pesewas **by reading the digits** ("120.5" → 12050), never by multiplying a decimal.
- **Half yards:** stored in half-yard units for yard products and shown as "2.5 yards".

---

## Permanent vs editable records

- Sales, corrections, repayments, stock movements, expenses and day closes **can't be edited or deleted** on the phone: no edit or delete buttons, and no functions for it in the code. Mistakes are fixed with a correction (returns and exchanges, expense corrections).
- Products, sizes, customers, expense categories and settings can be edited; the server keeps the history. Every edit sends the `baseVersion` it started from (the record's `version` on this phone); the server's accepted version comes back in the next pull and replaces the local copy.
- A return or exchange always points each item coming back to the **exact line** of the original sale (`originalSaleItemId`); the return screen picks lines from the sale, never a free product choice.
- **The return screen works out the settlement** with the same rules as the server (Decision 3-10, server plan step 3): what's still owed on that sale is taken off first (shown, not a choice), then the rest as Cash, MoMo, kept as credit, or No refund (with a note), never more back than was paid for that sale. The confirmation shows the split in words. The server recalculates it; if its figures differ (for example another phone's repayment arrived first), the correction is still saved as recorded, because the money was really handed over, and the owner sees it flagged "Refund to check" in Today.

---

## Who sees what (from the server's role filtering)

This matches the server plan's **Who sees what** table, which is the one the server enforces.

| Screen or figure | Owner | Manager | Sales associate |
|---|---|---|---|
| Sell (including credit sales) and customers | ✅ | ✅ | ✅ |
| Record repayments, send balance and repayment receipts | ✅ | ✅ | ✅ |
| Full statements, "Remind today" list | ✅ | ✅ | ❌ |
| Add or remove stock, count stock | ✅ | ✅ | ❌ (sales take stock off automatically; associates see stock levels, worked out from movements and counts) |
| Products, stock levels and selling prices | ✅ | ✅ (add, edit) | ✅ (view only) |
| Cost prices, profit, "Cost price needed" | ✅ | ❌ | ❌ |
| Everyone's sales, daily summary, close the day, close again | ✅ | ✅ (no profit) | Own sales and own totals only |
| Refunds to check (`refundCheck`), counts to check (`countCheck`) | ✅ | ✅ | ❌ |
| Reverse a repayment or a debt brought forward | ✅ | ✅ | ❌ |
| Write off a debt, reverse a write-off | ✅ | ❌ (sees write-offs in a customer's history) | ❌ |
| Expenses | ✅ | ✅ | ❌ |
| Team and phones, reset a staff password | ✅ | ❌ | ❌ |
| Add debts brought forward from the notebook | ✅ | ✅ | ❌ |
| Download records, close the business, reset the practice shop | ✅ | ❌ | ❌ |
| Practice shop, Help, my account settings | ✅ | ✅ | ✅ |

Screens follow these rules, but **the server enforces them**; the phone never holds data it shouldn't show. **Associates never receive other associates' sales, corrections or repayments**, and nobody but the owner receives costs, profit, team members or phones.

---

## Design guide

**The feel:** clear and fast, like a well-kept notebook. Used standing at a stall, often in bright light, often in a hurry.

- **Light theme, high contrast** (dark text on white or very light backgrounds) for outdoor reading. A dark theme can come later.
- **Big targets:** every button at least **48px** tall; the main action on each screen is a full-width button at the bottom, within thumb reach.
- **Large numbers:** money and quantities are the biggest text on their screen.
- **Few words, clear icons with labels:** every icon has a text label (in the chosen language).
- **Colours with words:** "Owes", "Paid", "Low stock", "Not sent yet" and "Needs attention" always use a word or icon, never colour alone.
- **Fonts:** one clear sans-serif (a system font stack) at a minimum of 16px.
- **Bottom navigation:** **Sell**, **Customers**, **Stock**, **Today**, **More**.
- **Designed for 360px-wide phones first;** larger screens centre the content.

A design canvas (Sell, Customers, Stock, Today) will be prepared before FE5; until then, follow this guide.

### Accessibility

- Every input has a visible label; errors appear under their field in words.
- Contrast at least 4.5:1 for text (aim higher for outdoor use).
- Works with the phone's larger text setting (up to 130%) without overlapping.
- Status changes ("Sale saved", "Sent") are announced to screen readers.
- Confirmations for anything permanent ("This sale can't be changed after saving").

---

## Languages

- Every piece of the app's own text comes from the dictionary via `t('key')`. No text is typed directly into components.
- **English and Twi** dictionaries must have the same keys; `npm run check:i18n` fails if any key is missing.
- Customer messages (statements, receipts, reminders) have templates in both languages, chosen by the **customer's** language.
- Product names, customer names and notes stay exactly as typed.

---

## Customer messages

Statements, receipts and reminders open **WhatsApp** (`https://wa.me/<number>?text=<message>`) or the **SMS** app (`sms:<number>?body=<message>`) with the message ready; the staff member taps Send. Nothing is sent automatically in stage 1.

---

## Testing on phones

- **Every task:** 390px width in the browser, **airplane mode**, and a real Android phone where possible.
- **A low-cost Android phone** is the target device; test there before FE12 at the latest.
- **Failure cases** to check as features arrive: closing the app in the middle of a save (nothing half-saved); losing signal in the middle of a sync (nothing lost or doubled); a session that expires while offline (selling continues); an app update with unsent records (nothing lost); a rejected record (it appears in "Needs attention").

---

## Tasks

Each task: explain the plan first, wait for approval, build, check **Done when** (including **390px width** and **airplane mode**), then stop.

### FE0 — Before starting

The server's BE1–BE3 are done, and the server is live on Render (BE1 Part B). (FE3 also needs BE5 and BE5.5.)

### FE1 — Setup and app shell (F1, F7)

Vite, React, Router, Tailwind with design variables, the shared API helper, Vite proxy, `vercel.json`, PWA plugin (manifest, offline start, update prompt that never interrupts unsaved input), bottom navigation, i18n dictionaries, `t()` and `check:i18n`, the money and quantity formatters and parser (with Vitest tests), Dexie database (version 1) with all tables.

**First deploy (ADR-9; I do it myself):** Claude Code writes `vercel.json` (the `/api/*` rewrite to the Render server from BE1, and the security headers) and no deployment guide; I create the project and deploy. Test the live address on a real phone from now on, not only `localhost`. If a Vercel deploy fails with "Git information retrieval failed", use **Redeploy**. **Then** do the backend's proxy re-check (server plan, BE1 Part B: "Proxy hops, measured twice") in the backend project, since the Vercel rewrite adds a hop; this project changes nothing on the server.

**Done when:** the app installs to the home screen and opens with the network turned off; switching language changes every word on screen; the money tests pass; the live Vercel address shows the server's health through `/api` on a phone (checked by me after I deploy); the backend's proxy re-check is done and `TRUST_PROXY` updated.

### FE2 — Sign up, sign in, PIN (F2, F8)

Sign-up (owner and business, with email and the terms tick), sign-in by **phone number or email**, forgot password and reset-password screens, confirm-email screen and the "Email not confirmed" notice, Settings → My account (change password, phone number, email), first-sign-in password change and terms for staff, **invitations** (after sign-in, if `GET /api/auth/me` lists `invitations`, show each: "[business] invited you to join as [role]" with **Accept** and **Decline**), set PIN, PIN lock screen (5 minutes in the background, 5 wrong tries), sign out (warning if unsent records exist).

**Done when:** a signed-in user reopens the app offline and only needs their PIN; 5 wrong PINs require an online sign-in; signing in works with the phone number and with the email; a reset link from the email sets a new password and the other phone is signed out; the token never stays in the address bar; every new screen works in English and Twi at 360px.

### FE3 — Sync engine and status (F5b, F6)

One Dexie database per business (see Offline architecture) with the shared `shopbook-app` database, device registration with its **signing key** and signed requests with the clock offset (see Device key and signed requests), the receipt counter per business, outbox, push-then-pull loop with paging, cursor saved with each page, back-off, 401 / `ACCESS_REMOVED` / `DEVICE_REVOKED` handling, "Needs attention", sync states, sync status screen, persistent storage request. Vitest tests for the engine's decisions (what happens on each kind of answer).

**Done when:** records made offline are sent when the network returns, with no duplicates; a rejected test record appears in "Needs attention"; an expired session keeps every record.

### FE3.5 — Two-phone torture test

With **two real phones** (or one phone and a laptop browser) signed in to the same business, using **`settings.update`** from BE5 (the only operation the server has at this point; both phones signed in as the **owner**, each with its own device; a small developer-only test screen that changes one settings field is enough, and is removed in FE12). "Records" below means settings changes. If a second staff phone is set up, its `settings.update` should come back `rejected` and land in "Needs attention".

- both in airplane mode, records made on both, then reconnected → everything appears on both, once
- the network cut in the middle of a sync (airplane mode on during "Sending…") → nothing lost or doubled after reconnecting
- the app closed during a save → either the whole record is there or none of it
- the same settings field edited on both phones offline → the last one sent wins everywhere, and `ChangeLog` marks the earlier one `conflict: true`
- one person removed by the owner, and one phone revoked → those phones are wiped on their next sync
- the session expired while offline → selling continues; after signing in, everything is sent
- an app update installed while records are unsent → nothing lost

**Done when:** every case passes, and the results are written in `docs/guide.md`. **No feature screens (FE5 onwards) until this passes.** Repeat the relevant cases after FE5 (the same **product** edited on both phones offline → last one sent wins), FE7 (sales) and FE9 (returns).

### FE4 — Team and phones (F3)

Owner's team screen: add staff (name, phone number, role, email optional; shows the temporary password once, only when the person is new: if the number already has an account, the answer has no temporary password and the member shows "Waiting for them to accept"; declined invitations show "Declined" and can be sent again), change role, **reset password** (confirmation, then the new temporary password shown once with "Give this to them in person"), remove. Owner's phones screen: list phones (name, person, last seen), revoke one with a confirmation.

**Done when:** the owner adds a manager who can sign in on another phone and must set a new password; revoking that phone wipes it on its next sync.

### FE5 — Products, sizes and prices (Epic 1)

Product list with search and type filter, add/edit product (type, unit, size ranges and custom sizes, prices, per-size prices, starting stock), hide/unhide, the owner's "Cost price needed" list, change history (owner).

**Done when:** every Epic 1 acceptance criterion that applies to the phone passes, including search in under half a second with 2,000 products.

### FE6 — Stock (Epic 2)

Stock list (search; All / Low / Out of stock / Below zero) and each product's sizes; add a delivery with a quantity box per size (the owner can update the cost price from the same screen); remove stock with a reason and confirmation; count a size (saves the counted number with the number shown and the cursor; the difference is worked out, reason if different; a "Check this count" notice when the server flags `countCheck`), reused by the day close; low-stock list and badge; per-product low-stock level; "Check the shelf" list; stock history (owner and manager); `stockLevels` kept up to date.

**Done when:** every Epic 2 acceptance criterion that applies to the phone passes; adding, removing and counting stock update quantities instantly offline; half yards display correctly; the stock list opens in under a second with 2,000 products.

### FE7 — Sell (Epic 3)

The fastest screen in the app: search with the week's most-sold products, tap product, tap size, quantity, several items per sale, retail/wholesale for the whole sale, agreed price with quick notes (warning below wholesale), payment (cash, MoMo, cash and MoMo, credit, part-paid; change to give; quick-add customer for credit; credit limit: associates stopped, owner and manager warned), the **sale invariants** checked, **confirmation screen**, saved with a receipt number, "New sale" and "Send receipt", today's sales list and sale details with flags. An unfinished sale survives the app being closed briefly.

Each sale line names the price version it used (`productVersion` and `sizeVersion`, or `editOpId` when this phone changed the price and hasn't synced yet); the phone never sends a cost.

**Done when:** a regular cash sale takes **under 15 seconds** from opening Sell to saved; a confirmed sale has no edit or delete option anywhere; two sales saved quickly have different receipt numbers.

### FE8 — Customers and debts (Epics 4 and 5)

Customers screen with search (name or phone) and the duplicate-phone warning; add customer (everyone), edit and hide (owner and manager); credit limits (owner) and the default limit setting; balances with "Updating…"; record a repayment (confirmation, never above the known balance, "Pays everything") and correct one (owner and manager); "Who owes" (owner and manager: most owed or owed longest, total, "Over limit", "30+ days"); customer history by role; write off a debt (owner); "In credit" customers; send statement, send repayment receipt, "Remind today" list.

Associates (Decision F-17) can record repayments and send balances and repayment receipts, but don't see full statements or the "Remind today" list.

**Reversals (Decision 4-9):** on a repayment, debt brought forward or write-off (owner only for write-offs), **Reverse** asks for a reason and confirms ("Cancel the whole GH₵ 500.00 write-off? You can then record the right amount."), then offers to record the right one. Reversed records show "Reversed" with the reason; there's no Reverse button on a reversal or on anything already reversed.

**Debts brought forward (Story 4.12, owner and manager):** on a customer's page, **Owed before Shop Book**: amount, the date it started (a date picker that allows past dates, not future ones), optional note, confirmation ("Add GH₵ 300.00 that Ama owed since 3 Sep?"), then saved offline like a repayment. It shows in her history as "Brought forward" and can be corrected with a reason. During the first days, a shortcut on the Customers screen ("Add debts from your notebook") makes entering many quickly easy.

**Done when:** a repayment updates the balance immediately offline ("Updating…") and the receipt opens in WhatsApp ready to send.

### FE9 — Corrections: returns and exchanges (Epic 3)

From a sale's details or a receipt number: return items (back in stock or damaged; refund by cash, MoMo, off the debt or none, never above the price sold) or exchange items (any size or product; the customer pays the difference or the shop gives it back), reason from the list, confirmation, receipt number and receipt. Associates only on their own sales; a warning past the 7-day return period. Can't return more than this phone's records show (the server makes the final check).

**Done when:** an exchange of size 40 for 41 updates both stock lines, the original sale shows the correction beneath it, and a return rejected by the server appears in "Needs attention".

### FE10 — Expenses (Epic 6b)

Add expense (usual categories first), today's expenses list, correct an expense (a new record with a reason; the original stays).

**Done when:** an expense is recorded in under 10 seconds and appears in Today; a correction shows beside its original.

### FE11 — Today and closing the day (Epic 6)

Today screen by role (sales, cash, MoMo, credit, collected, expenses, by person, price changes with notes, flags, records that arrived after closing; profit for the owner, marked "incomplete" when cost prices are missing), past days, and the manager's **Close the day** (expected vs counted cash and MoMo, notes). A wrong close is never edited: **Close again** (owner or manager) records a new close for the same day with a reason, and the day shows the latest close with the earlier one beneath it.

Owner and manager also see **Refunds to check** and **Counts to check** with what to do ("GH₵ 100.00 more cash was given back than was paid for sale K7M-0042").

**Done when:** the figures match the server's day report for the same test data; a flagged refund and a flagged count appear for the owner and manager, never for an associate.

### FE13 — Download records, close the business, Help (F12, F13, F15)

- **More → Download my records** (owner, online): one button per file (Products and stock, Customers and balances, Sales, Repayments, Expenses), with dates for the last three. The file downloads as CSV, with "Opens in Excel or Google Sheets".
- **More → Business settings** (owner; others see it read-only): business name, shop phone for receipts, receipt note, default language, low-stock level, return period, default credit limit. Saved with `settings.update` (works offline, syncs). The name shown in the header and on every receipt, reminder and statement comes from here; nothing asks for it again (AC45).
- **More → Close my business** (owner, online): what happens in plain words (staff lose access now; everything is deleted on [date]; you can cancel until then), a **Download my records first** button, then current password and type the business name. While closing, the owner sees only a "Closing on [date]" screen with **Cancel closing** and the download.
- **More → Help:** **Report a problem** opens `https://wa.me/<support number>?text=…` with: app version, the server's version from `/api/health`, this phone's device code, unsent records count, last error code and its reference (`X-Request-Id`), Android and Chrome versions. Never customer names, amounts, phone numbers or passwords. The support number is a build setting (`VITE_SUPPORT_WHATSAPP`). Help also lists short answers ("My sales aren't sending", "I forgot my password").

**Done when:** each CSV opens in Excel with "₵" shown correctly; closing needs the password and the exact name and can be cancelled; the Help message holds the details above and nothing personal.

### FE14 — Practice shop (F14)

- **More → Practice:** switches to the practice shop (calls `POST /practice/open` the first time, then syncs it like any business). A bright **"PRACTICE: nothing here is real"** bar sits on every screen, and **Back to my shop** switches back.
- The owner sees **Reset practice shop** (confirmation, then the samples come back).
- Switching never happens while a sale is in progress, and each business keeps its own unsent records.

**Done when:** a sale in the practice shop never appears in the real shop on any phone; switching back and forth offline keeps both shops' unsent records; reset works; the bar is on every screen in both languages.

### FE12 — Polish and test shop

Every screen at 360px and 390px, in English and Twi (a Twi speaker reviews the wording), offline, and on a low-cost Android phone; larger text setting; data use for a day's sync under 1 MB; README.

**Done when:** the test shop uses the app for a full day without the notebook.

**If time runs short:** FE1–FE8, FE11 and FE13's download and Help make a usable first version; FE9, FE10, closing a business and FE14 (practice shop) can follow.
