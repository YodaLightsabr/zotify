# Zotify

Queue music at UCI's Anteatery and Brandywine through Rockbot. Built with Express on Node 22.

## Setup

```bash
npm install
```

The server reads accounts from `.accounts.json` and keeps everything else (sessions, members, invite codes, cached searches, pick history) in a SQLite database, `.zotify.db`, both in the project root. Environment variables in `.env` are loaded if the file exists.

Older versions kept that data in `.cache.json`. The first time the server starts without a database, it imports `.cache.json` and then leaves it alone as a backup. Run `npm run backup` (after `npm run build`) to save a consistent copy of the database to `backups/`, even while the server is running.

Login codes are emailed through [Resend](https://resend.com) when `RESEND_API_KEY` is set in `.env`; otherwise they're printed to the server console. See `.env.example` for the settings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the server from `src/` and restarts it when files change |
| `npm run typecheck` | Type checks everything without building |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the built server from `dist/` |
| `npm run backup` | Saves a copy of the database to `backups/` |
| `npm run queue-songs` | Runs the `QueueSongs` script in `src/scripts/queue-songs.ts` |

The server listens on port 3000, or `PORT` if it's set.

## Layout

- `src/server.ts`: the Express app and its routes
- `src/routes/`: one file per API route
- `src/`: Rockbot client, caching, search, queuing, voting and Spotify modules
- `src/scripts/`: one-off scripts
- `app/index.html`: the page, served as a static file
