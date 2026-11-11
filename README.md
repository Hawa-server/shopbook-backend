# Shop Book server

The API for Shop Book, an offline-first bookkeeping app for market traders: Express 5, MySQL 8 (Sequelize), Node 26. The phone app is a separate project and uses only what [`docs/api.md`](docs/api.md) describes.

- What to build: [`docs/backlog.md`](docs/backlog.md) · how: [`docs/server-plan.md`](docs/server-plan.md) · the contract: [`docs/api.md`](docs/api.md)
- Explanations for studying: [`docs/guide.md`](docs/guide.md)

## Setup (local)

1. Node 26: `nvm use` (reads `.nvmrc`).
2. `npm install`
3. In MySQL, create two databases, for example `shopbook_dev` and `shopbook_test`, and a user with full rights on both.
4. Copy `.env.example` to `.env` (development database) and to `.env.test` (test database) and fill in the values, including a `JWT_SECRET` in each (the command to make one is in `.env.example`). Both are Git-ignored. The tests empty and refill their own tables, so `.env.test` must point to a database used **only** for tests (its name must end in `_test`).
5. `npm run db:migrate` (and `npm run db:migrate:test`)
6. `npm run dev`, then open <http://localhost:3000/api/health>. In development, account emails (with their links) are printed in this terminal instead of being sent.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server with `.env`, restarting when a file changes |
| `npm start` | Starts the server with the environment already set (Render) |
| `npm test` | Everyday tests: `check:api-docs`, then the unit and API tests, using `.env.test` (aim: under 3 minutes). Leaves out the isolation and torture suites |
| `npm run test:all` | Everything: `npm test`, then `test:isolation`, then `test:sync`. **Must pass for every task's Done when.** Stops at the first failure |
| `npm run check:api-docs` | Checks that `docs/api.md` lists exactly the server's routes |
| `npm run db:migrate` / `db:migrate:status` / `db:migrate:undo` | Migrations on the development database (`.env`) |
| `npm run db:migrate:test` | Migrations on the test database (`.env.test`) |
| `npm run test:isolation` | The business isolation tests on their own |
| `npm run test:sync` | The sync torture test (`tests/torture`), three runs in a row; stops at the first failing run |
| `npm run check:sequences` / `check:operations` / `check:stock` / `check:receipts` / `check:balances` | Read-only consistency checks of sync on the development database; print any problem (IDs only) and exit 1, change nothing |
| `npm run dev:sign -- …` | Signs test requests with a throwaway test key (development only; see `docs/guide.md`) |

`check:sequences` and `check:operations` exist since BE5, `check:stock` since BE7, `check:receipts` and `check:balances` since BE8 (`check:balances` becomes the full debt-lot rebuild in BE9). On production they're run only by the project owner: `node --env-file=.env.production scripts/check.js sequences` (read-only).

## Deployment

Done by the owner of the project. Environment variables are typed into Render's dashboard, never copied from a local `.env`; `.env.example` lists every one. Production migrations are run from a laptop with a Git-ignored `.env.production` in the project folder:

| Command | What it does |
|---|---|
| `npm run db:migrate:status:production` | Lists which migrations have run on production (changes nothing) |
| `npm run db:migrate:production` | Applies new migrations to production |

Both read **only** `.env.production` (never the terminal's own variables), refuse to run if it's missing or isn't `NODE_ENV=production`, and print the database host and name before doing anything.

## Known limits

- **Rate limits are kept in memory.** Correct while the API runs as **one** Render instance; a restart resets the counts. Before running more than one instance, move them to a MySQL table (`RateLimitHit`).
- **Trust proxy:** `TRUST_PROXY=3` for the **direct** path (phone → Cloudflare → Render's router → a local proxy → server), measured on **3 Nov 2026** from a phone on mobile data: `X-Forwarded-For` arrives as `[caller, Cloudflare, Render 10.x]` with the socket at `::1`, and with 3 the server's `req.ip` is the caller's own address. A request sent with a forged `X-Forwarded-For: 1.2.3.4` arrived without it (Render's edge replaces the header), so `req.ip` was still the caller's real address. **To re-check after FE1** (the Vercel rewrite adds a hop), and whenever the hosting changes (custom domain, paid plan, another proxy).
- **Free hosting:** Render's free plan sleeps after about 15 minutes (the first request can take up to a minute); Aiven's free MySQL is for testing only. See the server plan's "Free-tier hosting".
