# Zotify

Queue music at UCI's Anteatery and Brandywine through Rockbot. Two apps: an Express API on Node 22 (`src/`) and a Next.js frontend built with React (`web/`).

## Setup

```bash
npm install
```

The server keeps everything (Rockbot accounts, schools, sessions, members, invite codes, cached searches, pick history) in a SQLite database, `.zotify.db`, in the project root. Rockbot accounts used to be in `.accounts.json`, which is imported the first time. Environment variables in `.env` are loaded if the file exists.

Older versions kept that data in `.cache.json`. The first time the server starts without a database, it imports `.cache.json` and then leaves it alone as a backup. Run `npm run backup` (after `npm run build`) to save a consistent copy of the database to `backups/`, even while the server is running.

Login codes are emailed through [Resend](https://resend.com) when `RESEND_API_KEY` is set in `.env`; otherwise they're printed to the server console. See `.env.example` for the settings.

## Ports and URLs

The API and the frontend run separately and talk over CORS, with the session cookie sent cross-origin.

| | Development | Production |
| --- | --- | --- |
| API (`src/`) | http://localhost:3001 | https://api.zotify.app |
| Frontend (`web/`) | http://localhost:3000 | https://zotify.app |

The API always listens on port 3001 and the frontend on 3000. The URLs are hardcoded in `src/config.ts` and `web/lib/config.ts`, picked by `NODE_ENV`: `npm start` runs the API as production, and `next build` builds the frontend as production. The API only accepts requests from the frontend's URL. Magic links and invite links in emails point at the frontend.

## Schools

Each school gets its own Zotify. The main school (UCI) is at zotify.app, and every other school at a subdomain, like uf.zotify.app for the University of Florida. Site admins manage schools from the admin dashboard: each school's name, subdomain, email domain (so people can sign in with just their ID, like a UCInetID), wording, venues with their Rockbot IDs, and admins. The Rockbot accounts Zotify uses are managed there too; a venue can have a home account that only ever checks in there, or share the rest.

- `web/proxy.ts` works out the school from each request's host. Unknown subdomains go to zotify.app, so every `*.zotify.app` address (other than `api.`) can point at the frontend.
- The API works out the school from each request's `Origin`, so one school's site can only reach its own venues, beta and history.
- One sign-in works at every school, but each school has its own private beta, members and admins. Site admins (in `src/auth.ts`) run every school.
- Schools and venues live in the `schools` and `venues` tables, Rockbot accounts in `rockbot_accounts`. On first start, UCI's Anteatery and Brandywine and UF's The Eatery are added, `.accounts.json` is imported (and kept as a backup), and the existing beta becomes UCI's.

## Zotify Meals

A public, read-only REST API for dining hall menus at `api.zotify.app/api/meals`. No sign-in, CORS open to any site. Menus come from each school's mydininghub.com site, through the unofficial GraphQL API behind it (Aramark's "Elevate"; everything about it is in `src/meals/config.ts`). Zotify keeps its own copy in the database, so answers are instant and keep working if the dining site is down: the next two weeks are fetched nightly at 3 AM (and on first start), and today and tomorrow every hour, since menus change on the day. Saved menus are never deleted, so past days can be looked up too, back to when Meals started; a menu that was published is never replaced by an empty answer.

| Request | What it returns |
| --- | --- |
| `GET /api/meals` | Schools and their dining halls |
| `GET /api/meals/uci` | Allergen and diet tag labels, meal periods, dining halls, and every date kept (`firstDate` to `lastDate`) |
| `GET /api/meals/uci/anteatery` | Stations, and hours for the next two weeks |
| `GET /api/meals/uci/anteatery/today` | The day's meal periods with hours, stations and items (`today`, `tomorrow`, `yesterday` or any `YYYY-MM-DD` with saved menus) |
| `…/today?period=lunch` | One meal period (by name or ID) |
| `…/today?exclude=milk,peanuts&diet=vegan` | Leaves out items with those allergens (tagged, or mentioned in the ingredients) and keeps those diet tags |
| `GET /api/meals/uci/items/:sku` | One item, and where and when it's served |
| `GET /api/meals/uci/status` | When menus were last fetched, and any failures |

Each item has its nutrition, ingredients and diet tags, plus allergens in three parts, since the dining hall's tags aren't reliable on their own:

- `tagged`: what the dining hall tagged
- `incomplete`: allergens it says its information is incomplete for. This means unknown, not free of
- `possibleFromIngredients`: allergens the ingredient text mentions that aren't tagged. Derived by keyword, so it can be wrong; soybean oil and coconut don't count (see `src/meals/items.ts`)

Meal periods say whether the hours list them that day (`scheduled`); the dining site sometimes has menus for periods that aren't served. Between periods there's a 30–45 minute transition when the full menu may not be out. A school is set up for Meals with its dining site's store codes (`schools.dining_config`) and each dining hall's location key (`venues.dining_location_key`); UCI's Anteatery and Brandywine are set up on first start.

## Live updates

Pages don't poll. The frontend keeps one socket.io connection open for the whole visit (`web/lib/live.tsx`), and the API (`src/live.ts`, on port 3001 too) pushes updates to it:

- **Venue queues:** the API fetches each venue's queue from Rockbot every 15 seconds, but only while someone is watching that venue or Zotify has songs waiting there, and sends each fetch to everyone watching. Votes, boosts and songs moving into Rockbot trigger an extra fetch a couple of seconds later.
- **Zotify's queue and its failures:** sent to approved members as soon as anything changes.
- **Playlist "queue all" progress:** sent as each track is done.

The connection is opened with the session cookie, and signing in or out reconnects. The HTTP routes (`/api/venue-queue`, `/api/zotify-queue`, `/api/playlists/:id/queue`) still work and share the same Rockbot fetch.

## The Zotify queue

Queuing a song (the Queue button, Request again, or a whole playlist) adds it to Zotify's own first-in, first-out queue for that venue, kept in the database. After each poll of Rockbot's queue (below), and whenever something is added, the API checks: while fewer than 3 of Zotify's songs are waiting there, it requests the next one and upvotes it with every account. Keeping only a few in Rockbot at once keeps cooldowns short and keeps songs in the order people asked for them.

If someone else requests the same song on Rockbot while it waits, Zotify boosts their pick with every account instead of requesting it again; that doesn't use up one of the 3 places. Admins can move waiting songs up and down and remove any of them, and everyone can remove their own.

A song that can't be requested is retried twice, 30 and 60 seconds apart, holding its place in line meanwhile. After that (or straight away, if Rockbot says it was played too recently) it's marked failed and the next song goes. Signed-in people see the waiting songs on the homepage between On deck and Coming up, and a warning by "Up next" lists recent failures. The rules live in `src/zotifyQueue.ts`.

## Running on a server

`deploy/install.sh` sets Zotify up on a Linux server with systemd: the API and the frontend run as services that start on boot and restart if they crash, and a timer checks GitHub every minute and deploys new commits on `main`. Cloudflare Tunnel (or anything else) points at ports 3000 and 3001 as before.

```bash
git clone https://github.com/YodaLightsabr/zotify.git ~/zotify-setup
sudo ~/zotify-setup/deploy/install.sh --import ~/zotify
```

`--import` copies `.env`, `.accounts.json` and the database from an existing checkout; stop whatever's running Zotify there first. Node 22.9+ is found from your shell (nvm works), or pass `--node-bin`. Everything lives in `/srv/zotify`:

- `releases/<commit>/`: each deploy is built in its own folder, and `current` only switches to it once the build works, so a broken commit never takes the site down. The newest 3 are kept.
- `shared/`: `.env`, `.accounts.json`, `zotify.db` and `backups/`, used by every release
- `repo/`: the clone deploys are made from

A commit that fails to build is skipped until the next push. Useful commands:

| Command | What it does |
| --- | --- |
| `journalctl -fu zotify-deploy` | Follow deploys as they happen |
| `journalctl -fu zotify-api` (or `zotify-web`) | Follow the API's (or frontend's) logs |
| `sudo systemctl restart zotify-api zotify-web` | Restart both |
| `sudo -u <user> bash -c 'set -a; . /etc/default/zotify; /srv/zotify/repo/deploy/deploy.sh --force'` | Rebuild and redeploy the latest commit now |
| `sudo systemctl stop zotify-deploy.timer`, then `ln -sfn releases/<commit> /srv/zotify/current && sudo systemctl restart zotify-api zotify-web` | Roll back to an earlier release. The timer has to stop first, or it redeploys the latest commit within a minute; `sudo systemctl start zotify-deploy.timer` turns deploys back on |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API from `src/` and restarts it when files change |
| `npm run dev:web` | Runs the frontend with hot reloading |
| `npm run typecheck` | Type checks both apps without building |
| `npm run build` | Compiles `src/` to `dist/` and builds the frontend (`build:api` and `build:web` do one each) |
| `npm start` | Runs the built API from `dist/` |
| `npm run start:web` | Runs the built frontend |
| `npm run backup` | Saves a copy of the database to `backups/` |
| `npm run queue-songs` | Runs the `QueueSongs` script in `src/scripts/queue-songs.ts` |

In development, run `npm run dev` and `npm run dev:web` side by side.

## Layout

- `src/server.ts`: the Express app and its routes
- `src/routes/`: one file per API route
- `src/`: Rockbot client, caching, search, queuing, voting and Spotify modules
- `src/scripts/`: one-off scripts
- `web/app/`: the pages (home, sign in, private beta, invite links, My picks, admin)
- `web/components/`: shared components, including the `Navbar` on the homepage, My picks and admin
- `web/lib/`: the API client, the signed-in user, and formatting helpers
