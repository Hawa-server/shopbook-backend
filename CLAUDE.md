# Shop Book: server (backend)

Shop Book is an offline-first bookkeeping app for market traders: products and stock, sales, payments, debts, expenses, and a team (owner, manager, sales associates) working on their own Android phones. Many businesses use it, and each one's records are completely private. It is built as **two separate projects**, each with its own Git repository and its own `CLAUDE.md`: the **backend** (`STOREBOK_BACKEND`: Express API and MySQL) and the **frontend** (`STOREBOK_FRONTEND`: installable web app that works offline and syncs).

**This is the backend project.** Open Claude Code in its root folder for every backend (BE) task. The server's code lives at the root of this project (`src/`, `migrations/`, `tests/`, `scripts/`…), and the documents are in **`docs/`**. The frontend is a separate project you can't see; if a task seems to need a change there, stop and tell me.

## Source of truth

- **`docs/backlog.md`:** what the product must do and why (user stories, acceptance criteria, decisions). Use it for detail; don't change it.
- **`docs/server-plan.md`:** how to build the server, tasks BE0–BE17 (with BE5.5), the whole-project build order, and the decisions (ADRs).
- **`docs/app-plan.md`:** how to build the phone app, tasks FE0–FE14 (with FE3.5).
- **`docs/api.md`:** **you write it**, as the server is built; it's the frontend's only contract. After each task I copy it into the frontend project, so it must be complete on its own.
- **`docs/guide.md`** (plain-language explanations for studying): kept up to date by each task. **There is no `deploy.md`:** I do deployment myself, my own way; don't write deployment guides or dashboard steps.
- **Order of authority:** backlog → plans → `api.md` → code. **If two documents conflict, or a task would break a rule: stop, tell me which documents disagree, propose which one to update, and wait.** Never quietly pick one.

## Build order (whole project)

1. Server foundations BE0–BE5, then the **server sync torture test BE5.5** (must pass).
2. App foundations FE0–FE4, with the **two-phone torture test FE3.5** (must pass before FE5).
3. Each feature, server then app: BE6 → FE5, BE7 → FE6, BE8 → FE7, BE9 → BE13 (reminders, needed by FE8) → FE8, BE10 → FE9, BE11 → FE10, BE12 → FE11.
4. Accounts, privacy and support: BE15 → FE13 (download records, close a business, Help), BE16 → FE14 (practice shop), BE17 (support tools, error monitoring).
5. Finish: BE14 (production review, security checklist, backup restore; the server has been live since BE1) and FE12 (polish, a full day in the test shop).

## Rules for the whole project

- **Permanent records:** sales, corrections, repayments, debt write-offs, debts brought forward, stock movements, stock counts, expenses and day closes are never edited or deleted, on the server or the phone. Write no code that could change them. Mistakes are fixed with corrections or reversals. The only deletes allowed are in the server's `deleteBusinessData`: a business its owner closed, after 30 days, and resetting a practice shop.
- **Money** in whole pesewas, shown as "GH₵ 120.00"; **quantities** in whole units, with half-yard units for yard products (shown as "2.5 yards"). No floating-point money anywhere.
- **Secrets** only in `.env` files (never committed); keep `.env.example` complete. **Never read or print `.env` or `.env.production` files; ask me if you need a value.**
- **Hosting** (free plans for testing): Render (API), Aiven (MySQL), Vercel (app), Brevo (email), Sentry (errors). **Deploy early:** I put the server live in BE1 and the app in FE1, myself.
- **Don't add any library without asking.**

## Git and deployment: I do them, you don't

**I handle everything to do with Git and deployment.** You never:

- run any Git command (`git add`, `commit`, `push`, `pull`, `branch`, `checkout`, `merge`, `rebase`, `stash`, `reset`, `tag`) or `gh`, and never create or change `.github/` workflows unless a task asks for the file;
- deploy or touch a hosting service: no Render, Vercel or Aiven CLIs or APIs, no dashboards, no creating accounts, databases or projects;
- run anything against **production**: no production migrations, seeders, consistency checks, support scripts, backups or restores, and nothing that reads `.env.production` (you never open that file).

You also **don't write deployment instructions** (no `deploy.md`, no `render.yaml`, no dashboard walk-throughs). You only keep the project's own files right: `.nvmrc`, `engines`, `.env.example` with every variable and a comment saying what it's for, and (frontend) `vercel.json`.

At the end of a task, if anything changed that production needs, say it in **one or two lines**: new environment variable names, or new migrations. Nothing more.

After I've deployed, I'll paste what I see (health output, logs, errors). Use that to finish the task's **Done when**; if an item needs production, mark it "waiting for you" rather than guessing it passed.

## The standard

The goal isn't the most complicated bookkeeping system. It's the **simplest system that can never silently lose, duplicate or misrepresent a trader's money**. When a shortcut would risk that, don't take it; when extra complexity doesn't protect it, don't add it. Never say a test passed unless you ran it, and never claim the system has no bugs or vulnerabilities.

## Comments for learning

I'm learning from this code. Start every file with a short comment saying what it's for, and put a comment above every function or component explaining what it does and why, especially in sync, transactions, and isolation.

# Server rules

## Stack

Node 26 (pinned in `package.json` `engines` and `.nvmrc`), Express 5, MySQL 8 with Sequelize, `mysql2` and `sequelize-cli` migrations (never `sync({ alter })`), Zod (requests and environment variables), argon2 (argon2id), `jsonwebtoken` + `cookie-parser` (JWT in an HTTP-only cookie), `cors`, Node's built-in `crypto` (signatures, hashes, tokens), `@sentry/node`, Jest + Supertest (dev).

- Email through the provider's HTTPS API with `fetch` (**no SMTP, no Nodemailer**).
- Written in the project, no library: the JSON logger, rate limiter, security headers, Ghana phone-number function, CSV helper.
- Local environment with `node --env-file=.env`; reloads with `node --watch`.
- If `argon2` won't install on the host, ask me before falling back to `bcryptjs`. Don't add any other library without asking.

## Hosting and production (I deploy)

- **Render free** (Root Directory: the project root, Start Command `npm start`, never `npm run dev`), **Aiven free** MySQL with SSL (the CA certificate stays outside the project and out of GitHub), **Brevo free** for email, **Sentry free** for errors. Details in the server plan's "Free-tier hosting".
- Environment variables go in Render's dashboard, **never pasted from a local `.env`**; list each one by name in `.env.example`.
- Production scripts (migrations, consistency checks, support scripts, backups) are run **by me** with a Git-ignored `.env.production`. You write them and test them against the development and test databases only.
- **Email** is only for accounts (confirm email, reset password, email changed, business closing), sent after the database change commits; in development and tests it goes to the log, never sent. No SMS from the server.
- **Support tools** are command-line scripts in `scripts/support/`, never routes; every change they make is logged in `SupportAction`.

## Isolation, accounts and devices

- **Business isolation:** every query on business data is scoped by the signed-in user's `businessId`, taken from the database, never from the request. Another business's record is answered as 404. The `X-Business` header (real business or its practice shop) only chooses among the user's own active memberships.
- **The database guards isolation too:** business tables have a `(businessId, id)` unique key and composite foreign keys, so a row can't point at another business's record.
- **Roles on the server:** re-read the user's current membership on every request. Never trust a role, business or user ID sent by the phone. Follow the server plan's **Who sees what** table for every endpoint and pull.
- **Field privacy:** cost prices, profit and anything derived from them go only to the owner, in every endpoint and every pull.
- **Accounts:** sign in by phone number or email; email links are one-time tokens stored only as hashes; forgot password never reveals whether an account exists; every password reset ends the person's other sign-ins.
- **Removing a member, revoking a phone or closing a business** ends access to that business only; `sessionVersion` changes only for password, phone number or email changes.
- **Devices sign every business request** with a non-extractable key made on the phone; the server checks signature, server-corrected time and nonce after the session. A device ID alone proves nothing. Never claim this stops script injection: the app's strict CSP does that job.
- **Enrolling a device** needs the current password, a one-time challenge signed with the new key, and an unused device ID.

## Money, debts and stock

- **The server recalculates** totals, balances, stock and profit; a phone's totals are only checked, never trusted.
- **Customer debts** are debt lots and allocations, rebuilt per customer in one fixed order: a return reduces its own sale's debt, repayments and write-offs the oldest, extra becomes credit, never negative debt. They're projections; the permanent records are the truth.
- **Order of events** for debts uses only values stored on the records: `(effectiveAt, recordedAt, kindRank, id)`, never `serverSeq` or arrival time. The same accepted records in any arrival order give the same result.
- **Credit** is its own lot (`CreditLot`), used oldest first; an allocation always names the debt lot it reduced and, for credit, which credit lot paid it.
- **Reversals** (repayments, debts brought forward, write-offs, expenses) are full, once only, never of a reversal; the right amount is a new record. Amounts are always positive.
- **Returns** settle debt on that sale first, then money back only up to what was paid for that sale (less earlier refunds, flagged ones included), then credit or no refund; the parts add up exactly. Cash already handed back is saved and flagged, never rejected.
- **Sale prices** are checked against `PriceVersion` for the version the phone used; the server sets the cost.
- **Stock counts** record what was on the shelf and become the starting point; the difference is worked out, never stored.
- **Receipt numbers** are made on the phone and checked by one `ReceiptNumber` registry across sales, corrections and repayments. The server never makes them.

## Sync, concurrency and checks

- **Idempotent sync:** every operation's result is stored in `ProcessedOperation` in the same transaction, so the same operation twice is applied once. The same `opId` with a different payload is answered `rejected` with code `OP_ID_CONFLICT` for that operation only (the push still answers 200 and the rest of the batch carries on); a payload that fails Zod is rejected without reserving the `opId`; a temporary failure (database down, deadlock) rolls back and is never stored as a rejection.
- **Pulls** use a watermark; the cursor is the last sequence number **scanned**, never the last row returned.
- **Concurrency:** every data-changing operation goes through `runOperation`, which takes locks in one global order (idempotency reservation → customer → sale → sale lines → products and sizes → reversal original → receipt registry and new rows → `SyncSequence` last), retries deadlocks up to 3 times, and relies on `CHECK` constraints too. No handler opens its own transaction or calls `FOR UPDATE`. Concurrency tests use a real MySQL database, never mocks.
- **Consistency checks** (`check:balances`, `check:stock`, `check:receipts`, `check:sequences`, `check:operations`) are read-only; repairs are separate support scripts, run only after a backup.
- **Deletes** happen only in `deleteBusinessData`: a business closed for 30+ days (`purge_closed`) or a practice reset (`practice_reset`).

## Errors, security and time

- **Errors:** always `{ "error": { "code", "message", "fields"? } }`; never leak stack traces, SQL or secrets.
- **Security:** follow the server plan's Security section and checklist: hashed passwords, sessions (idle 30 days, absolute 90), rate limits, the `X-Requested-With` header and the `Origin` check, CORS only for `CLIENT_URL`, security headers, request IDs.
- **Never log (or send to Sentry)** passwords, tokens, email links, cookies, bodies, customer phone numbers or email addresses. Sentry uses an allow-list.
- **Time:** store UTC; business days use `Africa/Accra`; keep both the phone's `recordedAt` and the server's `receivedAt`.

## After each server task

Update **`docs/api.md` for the frontend**, following the server plan's "The API contract for the frontend": the Changes list; conventions and headers (including the exact signed text); every error code with what the app should do; every endpoint (who, signed or not, request and response fields with examples, errors, rate limit, "Available since"); every sync operation's payload and results; every pull row type with what each role receives; and enums and flags with their wording. The app is built **only** from this file, so it must be complete on its own; `npm run check:api-docs` must pass. Then update `docs/guide.md` (plain-language explanation for studying), and the Postman collection. Tell me how to test in Postman and MySQL Workbench. Run the tests that apply (`npm test`, and `test:isolation`, `test:sync`, `test:concurrency`, `test:recovery` and `check:api-docs` once they exist) and report what passed and failed.

## How to work

1. Read the task in `docs/server-plan.md` (and the related backlog epic), explain your plan briefly, and wait for my OK.
2. Build only that task.
3. Check every **Done when** item, and do what "After each server task" says. Summarise what changed, and end with the one or two lines on anything production needs (new environment variables, new migrations), if any.
4. Stop. Don't start the next task until I say so. Never run Git commands or deploy; I do both.

## Commands

Fill these in during BE1:

- Node version: 26 (`nvm use` reads `.nvmrc`)
- Start the server: `npm run dev` (local, reads `.env`, reloads on change); `npm start` on Render
- Run the tests: `npm test` (runs `check:api-docs`, then Jest with `.env.test`)
- Run migrations (local): `npm run db:migrate` (development, `.env`); `npm run db:migrate:test` (test, `.env.test`); `db:migrate:status`, `db:migrate:undo`
- Run the consistency checks (local): not yet; added from BE5 (`check:sequences`, `check:operations`) and later tasks
