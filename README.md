# Hi World Club — Explore Well

Refined poster site + real backend. One part industry immersion, one part hard skills, one part giving back.

## What's inside

- **Frontend** (`public/`) — the original interactive poster, refined and split into `index.html` + `css/styles.css` + `js/app.js`
  - HI (vials + NFC/member lanyards) and WORLD (books, pens, remotes, tubes) compositions
  - **Upcoming events** calendar populated from the club desk, plus the **Moments** photo gallery with lightbox
  - Photos inside every modal (treks, workshop, book drive, cohort)
  - Live stats band, live trek seat counts, recent passes & pledges, and privacy-safe public club updates
  - Works **offline**: forms fall back to localStorage when the API is unreachable
- **Backend** (`server/`) — Node.js + Express + zero-dependency JSON file store (file at `data/club.json`, no native builds)
  - `GET /api/health`, `GET /api/treks`, `GET /api/stats`, `GET /api/events`, `GET /api/public/activity` (generic updates only; no private application details)
  - `GET/POST /api/pledges` — book-drive pledges; the goal is configurable from the admin desk and persisted in the JSON store
  - `POST /api/applications` (+ admin `GET`) — join applications
  - `POST /api/passes`, `GET /api/passes/latest` — cohort visitor passes
  - `GET/POST /api/reservations` — trek reservations with capacity, waitlisting, and duplicate guards
  - Validation, rate limiting, security headers (preview/iframe-friendly)

## Run it

```bash
npm install
npm start        # http://localhost:3000
npm run dev      # with --watch reload
```

Optional env: `PORT=3000`, `DB_PATH=./data/club.json`, `ADMIN_TOKEN=hiworld-admin`.

### Club desk

Open **`/admin`** for the operations desk. It covers applications, the book drive, events, trek rosters, visitor passes, and the activity log. Admins can adjust the book goal and create, edit, or delete events; upcoming events appear on the public homepage. It uses the same JSON store as the public forms; it is not a separate demo UI.

The local default key is `hiworld-admin`. Set a private `ADMIN_TOKEN` before deployment (for example, `openssl rand -hex 32`). The browser sends it only in the `x-admin-token` request header. Admin endpoints return `401` without a valid key:

```bash
curl -H 'x-admin-token: hiworld-admin' http://localhost:3000/api/admin/overview
curl -H 'x-admin-token: hiworld-admin' http://localhost:3000/api/admin/applications
```

An empty store is populated with realistic sample records so the desk has something to work with on first launch. Set `SEED_DEMO=0` to start empty (also used by the test suite). The sample-data banner has a guarded reset action. The first new public submission or manual record disables sample reset so real records cannot be wiped by that control. The sidebar’s **Clear all data** action requires typing `CLEAR ALL DATA`; it deletes all five record collections and the activity log while preserving club configuration. The default book goal is 500 and can be changed from the Book drive page; the goal is saved in the JSON store. The fixed 347-book historical baseline is not a saved pledge, so it remains separate from saved desk records in public totals. A persisted marker prevents an empty store from being automatically reseeded with demo records on the next start, as long as the configured JSON file remains available. `DB_PATH` controls the JSON file location.

Desk routes include `GET /api/admin/overview`, `/badges`, `/search`, `/activity`, and collection list/detail endpoints under `/applications`, `/pledges`, `/reservations`, and `/passes`. `PATCH /api/admin/book-goal` updates the persisted target; `/api/admin/events` supports authenticated event listing and `POST`/`PATCH`/`DELETE` management. CSV export is at `/api/admin/export.csv?type=applications` (or another record collection). Every route under `/api/admin/*` requires the same token.

Status changes affect live public totals and capacity: cancelled pledges stop counting toward the book goal, revoked passes stop appearing as active, and waitlisted/cancelled reservations do not consume seats. A reservation’s WeChat ID is unique per trek while that reservation is open. Changing a record, adding a private note, or removing it is recorded in the activity log. The public homepage polls for live changes; its update feed uses generic messages and never publishes names, WeChat IDs, private notes, or internal activity summaries.

## Deploy on Vercel

Import the repo in Vercel — no build step needed (`vercel.json` routes `/api/*`
to the Express app as a serverless function; `/public` is served by the CDN).

Environment variables to set in Vercel → Project → Settings → Environment Variables:

| Variable      | Required? | What to enter |
| ------------- | --------- | ------------- |
| `ADMIN_TOKEN` | **Yes** | A long random secret, e.g. `openssl rand -hex 32`. Protects the club desk and application admin API via `x-admin-token`. |
| `DB_PATH`     | No | Leave unset — the app defaults to `/tmp/hiworld-club.json` on Vercel. |
| `SEED_DEMO`   | No | Leave unset to seed an empty store with a sample club; set to `0` to start empty. |
| `PORT`        | No | Vercel injects this itself; not used by serverless functions. |
| `NODE_ENV`    | No | Vercel sets `production` automatically. |

> ⚠️ **Persistence note:** Vercel's serverless filesystem is ephemeral — pledges,
> applications, passes, reservations, events, and the configured book goal can reset
> on redeploys/cold starts. For permanent storage, host the backend on
> Render/Railway/Fly/your own VPS
> (where `data/club.json` persists), or swap `server/db.js` for Vercel Postgres/KV.

## Bug fixes vs the original single-file HTML

- Fixed remote hover `transform: scale(var(--s))` that shrunk the remote (parent is already scaled)
- Focus trap now uses `getClientRects()` (reliable for all layouts) instead of `offsetParent`
- Join modal resets to the form when reopened (no stale success screen)
- Tome buttons inside the Q3 quadrant removed from tab order (`tabindex="-1"`) — no nested-tab-stop trap
- Blackout layer is keyboard reachable; lightbox has its own Esc handling
- Quantity stepper has a labelled group; deck swipe handles `pointercancel`
- All `fetch` calls time out (8s) and degrade to offline mode with a status chip

## Project layout

```
public/
  index.html  css/styles.css  js/app.js  images/*.jpg
  admin.html  css/admin.css  js/admin.js
server/
  server.js  db.js  adminRoutes.js  seed.js  clubdesk.test.js
data/         # json store (git-ignored)
```
