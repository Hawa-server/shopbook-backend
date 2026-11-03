# Shop Book server

The API for Shop Book, an offline-first bookkeeping app for market traders: Express 5, MySQL 8 (Sequelize), Node 26. The phone app is a separate project and uses only what [`docs/api.md`](docs/api.md) describes.

- What to build: [`docs/backlog.md`](docs/backlog.md) · how: [`docs/server-plan.md`](docs/server-plan.md) · the contract: [`docs/api.md`](docs/api.md)
- Explanations for studying: [`docs/guide.md`](docs/guide.md)

## Setup (local)

1. Node 26: `nvm use` (reads `.nvmrc`).
2. `npm install`
3. In MySQL, create two databases, for example `shopbook_dev` and `shopbook_test`, and a user with full rights on both.
4. Copy `.env.example` to `.env` (development database) and to `.env.test` (test database) and fill in the values. Both are Git-ignored. The tests create and delete their own data, so `.env.test` must point to a database used **only** for tests.
5. `npm run db:migrate` (and `npm run db:migrate:test`)
6. `npm run dev`, then open <http://localhost:3000/api/health>

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the server with `.env`, restarting when a file changes |
| `npm start` | Starts the server with the environment already set (Render) |
| `npm test` | `check:api-docs`, then every Jest test, using `.env.test` |
| `npm run check:api-docs` | Checks that `docs/api.md` lists exactly the server's routes |
| `npm run db:migrate` / `db:migrate:status` / `db:migrate:undo` | Migrations on the development database (`.env`) |
| `npm run db:migrate:test` | Migrations on the test database (`.env.test`) |

Consistency checks (`check:balances`, `check:stock`, `check:receipts`, `check:sequences`, `check:operations`) arrive with the tasks that need them (BE5 onwards).

## Deployment

Done by the owner of the project. Environment variables are typed into Render's dashboard, never copied from a local `.env`; `.env.example` lists every one. Production migrations are run from a laptop with a Git-ignored `.env.production` in the project folder:

| Command | What it does |
|---|---|
| `npm run db:migrate:status:production` | Lists which migrations have run on production (changes nothing) |
| `npm run db:migrate:production` | Applies new migrations to production |

Both read **only** `.env.production` (never the terminal's own variables), refuse to run if it's missing or isn't `NODE_ENV=production`, and print the database host and name before doing anything.

## Known limits

- **Rate limits are kept in memory.** Correct while the API runs as **one** Render instance; a restart resets the counts. Before running more than one instance, move them to a MySQL table (`RateLimitHit`).
- **Trust proxy:** the number of proxies in front of the server (`TRUST_PROXY`) is **not yet checked in production**; it's measured in BE1 Part B and written here with the date. Re-check it whenever the hosting changes (custom domain, paid plan, Cloudflare).
- **Free hosting:** Render's free plan sleeps after about 15 minutes (the first request can take up to a minute); Aiven's free MySQL is for testing only. See the server plan's "Free-tier hosting".
