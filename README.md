# Hi World Club — Explore Well

A student-club site for industry immersion, practical skills, and giving back. The public site, club desk, and API all use the same backend state.

## What’s included

- **Public site** (`public/`): interactive homepage, live stats, book-drive pledges, reservations, visitor passes, application form, photos, and a small upcoming-events preview.
- **Dedicated event calendar** at `/events`: a public, date-grouped calendar populated from the club desk and refreshed automatically. Events can be linked to Alibaba HQ or Refinery Island so they also appear in that trek’s homepage modal.
- **Club desk** at `/admin`: applications, book drive, events, trek rosters, visitor passes, activity, CSV export, and a confirmed clear-all action.
- **Backend** (`server/`): Express API with PostgreSQL persistence when `DATABASE_URL` is configured, plus a JSON-file adapter for local development and fallback use.
- **Offline recovery**: book pledges and join applications may be queued in the current browser and retried when it reconnects. Retry IDs prevent duplicate submissions; a server clear/reset invalidates old queued submissions so they cannot silently repopulate cleared data.

## Run locally

```bash
npm ci
npm start        # http://localhost:3000
npm run dev      # Node watch mode
npm test
```

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000`). |
| `ADMIN_TOKEN` | Club-desk key. Set a private value outside local development. |
| `DATABASE_URL` | PostgreSQL connection string. When present, PostgreSQL is the source of truth. |
| `DATABASE_SSL` | Set to `1` if the provider requires TLS but the connection string does not enable it. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Set to `true` to verify the TLS certificate when using `DATABASE_SSL`. |
| `PGPOOL_MAX` | Maximum PostgreSQL pool size per instance (default `1` on Vercel, `5` elsewhere). |
| `DB_PATH` | JSON-store path and one-time PostgreSQL bootstrap source (default `data/club.json`; Vercel fallback is `/tmp/hiworld-club.json`). |
| `SEED_DEMO` | Set to `0` to start an empty store; otherwise an empty store can be seeded with sample data. |

Do not commit `.env` files or database credentials. Set production values in the hosting provider’s environment-variable settings.

## PostgreSQL persistence

With `DATABASE_URL` set, the app creates a PostgreSQL table named `hiworld_club_state` and stores the club state as a JSONB document in a singleton row. Writes run in database transactions and lock that row, so status edits, public submissions, and clear-all actions are shared across app instances. API requests refresh from PostgreSQL, so a change made in the desk or another running instance appears on public views without relying on the page’s local storage.

The JSONB approach keeps the existing data model intact while making PostgreSQL the durable backend. On the first connection, if the PostgreSQL table has no state row, the app bootstraps it from `DB_PATH` (or the normal empty/demo seed). After that, PostgreSQL is authoritative; updating or redeploying the static UI does not clear or replace the database row. If `DATABASE_URL` is not configured, the app uses the local JSON store instead.

The health endpoint reports the active adapter as `storage: "postgres"` or `storage: "json"` at `GET /api/health`. On Vercel, confirm it reports `postgres` before clearing or editing live records; `json` means the app is using ephemeral `/tmp` storage and writes may not persist consistently between serverless instances. For Supabase, set `DATABASE_URL` to the project’s transaction-pooler PostgreSQL URI (not `SUPABASE_URL` or an API key), then redeploy.

## Club desk and book totals

Open `/admin` to manage club data. The default admin key is `hiworld-admin` for local development only. Set a long, private `ADMIN_TOKEN` before deployment; admin requests send it in the `x-admin-token` header.

An empty store can be populated with realistic sample records unless `SEED_DEMO=0`. The sample-data reset is only available while the desk is still demo data. **Clear all data** requires typing `CLEAR ALL DATA`; it deletes saved record collections (including event listings and trek reservations) and activity history, resets the historical book baseline from 347 to **0**, and preserves the configured book goal. The fixed Alibaba HQ and Refinery Island destination panels remain; their saved trek roster entries are cleared. The public and admin book total is therefore zero immediately after a confirmed clear, with the goal still available for the next drive. A persisted clear marker prevents demo records from being silently reseeded on restart.

Book totals are calculated as the historical baseline plus non-cancelled saved pledges. The baseline is stored with the backend state, can be zero, and is not a pledge record. Changing the goal from the Book drive page updates both the public and admin progress displays.

## API overview

- `GET /api/health`, `/api/stats`, `/api/treks`, `/api/events`, `/api/public/activity`
- `GET/POST /api/pledges`
- `POST /api/applications` (admin list/detail under `/api/admin/*`)
- `POST /api/passes`, `GET /api/passes/latest`
- `GET/POST /api/reservations`
- Authenticated desk APIs under `/api/admin/*`, including book-goal updates, event CRUD, record status actions, activity, and CSV export.

Public event responses expose only publication fields, including the optional trek destination (`alibaba` or `refinery`) used to place the event in the matching homepage trek window. Public activity uses generic messages and never includes names, WeChat IDs, private notes, or internal activity summaries. Public pages use same-origin relative API URLs and refresh live data periodically.

## Deploy on Vercel

The repo includes rewrites for `/events`, `/admin`, and `/api/*`. Static pages are served by the CDN; the Express API runs as a serverless function.

Set these in Vercel → Project → Settings → Environment Variables:

| Variable | Required? | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | **Yes** | Long random private key for the club desk. |
| `DATABASE_URL` | **Yes for durable data** | PostgreSQL provider connection string. Use the provider’s pooled/serverless connection URL when it supplies one. |
| `DATABASE_SSL` | Provider-dependent | Set to `1` if the provider requires TLS and the URL does not specify it. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Optional | Set to `true` when certificate verification is supported/configured. |
| `PGPOOL_MAX` | Optional | Set a modest per-instance pool size for serverless deployments. |
| `SEED_DEMO` | Optional | Set to `0` to initialize without sample data. |

Vercel’s filesystem is ephemeral. If `DATABASE_URL` is omitted, the app deliberately falls back to JSON under `/tmp`, which is **not durable** across serverless cold starts or deployments. Configure PostgreSQL in the host environment for durable data; do not put credentials in the repository or chat.

## Tests

`npm test` runs the API/club-desk suite, including event publishing and trek assignment, reservation capacity, idempotent offline submissions, data-clear persistence, and the baseline reset-to-zero behavior.
