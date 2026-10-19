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
