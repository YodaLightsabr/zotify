# Zotify for Raycast

See what's playing at your dining hall, request songs on Rockbot, and vote on the queue, with [Zotify](https://zotify.app).

- **Zotify Queue:** what's playing, what's next, and Zotify's own queue. Type to search for a song, and ↵ to request it.
- **Zotify Now Playing:** the song playing right now in your menu bar, with the queue in its menu.
- **Add Song to Zotify:** type `Add Song`, Tab, a song, and ↵.

Zotify is in private beta at each school, so you'll need to be in your school's Zotify to search and request. Ask to join at zotify.app.

## Signing in

The first time you open Zotify Queue, Raycast asks you to connect your Zotify account. If you're a developer, you can use a
personal access token from [zotify.app/developers](https://zotify.app/developers) instead, in the extension's preferences.

School admins can turn on **Admin Tools** in the preferences, then log out and back in, to downvote and rearrange Zotify's queue.

## Developing

```bash
npm install
npm run dev
```

The extension uses Zotify's public API ([docs.zotify.app](https://docs.zotify.app)). It signs in through a public OAuth app
whose client ID is `CLIENT_ID` in `src/zotify.ts`, registered at zotify.app/developers with the redirect URI
`https://raycast.com/redirect?packageName=Extension`. How every screen and action fits together is in [UX.md](UX.md).
