# Zotify

Queue music at UCI's Anteatery and Brandywine through Rockbot. Two apps: an Express API on Node 22 (`src/`) and a Next.js frontend built with React (`web/`).

## Setup

```bash
npm install
```

The server reads accounts from `.accounts.json` and keeps everything else (sessions, members, invite codes, cached searches, pick history) in a SQLite database, `.zotify.db`, both in the project root. Environment variables in `.env` are loaded if the file exists.

Older versions kept that data in `.cache.json`. The first time the server starts without a database, it imports `.cache.json` and then leaves it alone as a backup. Run `npm run backup` (after `npm run build`) to save a consistent copy of the database to `backups/`, even while the server is running.

Login codes are emailed through [Resend](https://resend.com) when `RESEND_API_KEY` is set in `.env`; otherwise they're printed to the server console. See `.env.example` for the settings.

## Ports and URLs

The API and the frontend run separately and talk over CORS, with the session cookie sent cross-origin.

| | Development | Production |
| --- | --- | --- |
| API (`src/`) | http://localhost:3001 | https://api.zotify.app |
| Frontend (`web/`) | http://localhost:3000 | https://zotify.app |

The API always listens on port 3001 and the frontend on 3000. The URLs are hardcoded in `src/config.ts` and `web/lib/config.ts`, picked by `NODE_ENV`: `npm start` runs the API as production, and `next build` builds the frontend as production. The API only accepts requests from the frontend's URL. Magic links and invite links in emails point at the frontend.

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
