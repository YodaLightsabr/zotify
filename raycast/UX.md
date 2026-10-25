# Zotify for Raycast: UX map

How the extension fits Raycast's building blocks, worked out before writing it. Raycast decides a lot for you (the search bar,
↵ and ⌘↵, the action panel, toasts, the OAuth overlay), so every screen and action below is placed in one of those layers on
purpose.

## Commands

| Command | Mode | What it's for |
| --- | --- | --- |
| **Zotify Queue** (`queue`) | `view` | The main command: what's playing, what's next, Zotify's own queue, and searching to request songs |
| **Zotify Now Playing** (`now-playing`) | `menu-bar`, refreshed every minute | The song playing right now in the menu bar, and the queue in its menu |
| **Add Song to Zotify** (`add-song`) | `no-view`, with a "Song" argument | A shortcut into Zotify Queue's search: type `Add Song`, Tab, a song name, ↵ |
| **My Zotify Picks** (`picks`) | `view` | Every song you've requested, by day, to request again |
| **Zotify Meals** (`meals`) | `view` | The dining halls' menus, with a detail pane for each dish, and your favorites |
| **Zotify Spaces** (`spaces`) | `view` | Study rooms free right now, finding a time, and every room's week |

Add Song is `no-view` because its only job is to launch Zotify Queue with `launchCommand`, passing the typed text as
`launchContext.searchText`. Raycast then shows Zotify Queue already searching, so there's one search screen, not two.
The menu bar's "Add Song…" item does the same with empty text.

## Signing in

- **OAuth with PKCE**, through `OAuthService` from `@raycast/utils`, against the public Zotify app registered at
  www.zotify.app/developers with the redirect URI `https://raycast.com/redirect?packageName=Extension`. Raycast shows its own
  sign-in overlay ("Connect your Zotify account"), opens www.zotify.app/oauth/authorize, and comes back with the code.
- **Zotify Queue** is wrapped in `withAccessToken`, so it asks to sign in the first time it opens, with no screen of our own.
  Raycast adds a "Log out" preference automatically once tokens are saved.
- **A personal access token** preference (optional, password field) skips OAuth, for developers.
- **The menu bar never asks to sign in.** It runs in the background every minute, where an OAuth overlay would pop up out
  of nowhere. What's playing and what's next come from the public queue route, which needs no token, so the menu bar works
  signed out. Zotify's waiting songs only show when a token is already saved, and the menu bar only refreshes an expired
  token when it was opened by a click, not in the background.
- **Admin tools** (downvoting, rearranging and clearing Zotify's queue) need the `admin` scope. An "Admin Tools" checkbox
  preference adds it to the scopes asked for. Most people never see admin wording on the consent screen.
- Raycast's commands are separate processes sharing one saved token. If two refresh at the same moment, Zotify accepts the
  refresh token they both used for a minute after it was replaced, so neither gets signed out (see `refreshGrant` in
  `src/developers.ts` on the server).

## Venues

- Which venue you're looking at is kept in `LocalStorage` (shared by every command), so the queue and the menu bar always agree.
- **Zotify Queue:** a `List.Dropdown` in the search bar (⌘P), with venues grouped by school in `List.Dropdown.Section`s.
- **Menu bar:** a "Venue" submenu, with a checkmark on the current one.
- Venues come from the public `GET /v1/schools`. Until one's picked, it's the first venue of the first school you're in.

## Zotify Queue

### Two modes, one list

The search bar is for **finding songs to request**. With it empty, the list is the queue; typing turns it into search
results. Raycast's own filtering is off (`onSearchTextChange` with `throttle`), since filtering the queue by typing would
fight with search. Esc clears the search bar and goes back to the queue, which Raycast does for free.

**The queue (empty search bar)**, in sections:

1. **Now Playing:** the song, its artist, album art, and the time left as an accessory, counting down every second. The
   timer lives in the row's own component, so only that row re-renders, not the whole list.
2. **On Deck:** next up, locked in by Rockbot.
3. **Waiting in Zotify:** songs waiting for room in Rockbot's queue, numbered, with a "You" tag on yours. They go in after
   On Deck, so this is where they'll play.
4. **Coming Up:** ordered by votes. Accessories show ▲ upvotes, ▼ downvotes, and a yellow "Zotify" tag for Zotify's picks.
5. **Couldn't Be Requested:** recent failures, with the reason as a tooltip.

It refreshes every 15 seconds while open (the server only asks Rockbot that often anyway), and after every action.
`useCachedPromise` shows the last queue instantly when the command opens, then updates it.

**Search results (typing)** come from `GET /v1/venues/:venue/search`, grouped into sections like the website's, but with
what you can request first: Available to Play, Only Available at Brandywine, Unavailable Anywhere, Requested by Others (in
Rockbot's queue, so ↵ upvotes), and On Cooldown (Zotify already queued it, or played it in the last two hours). The
accessory says where each song stands: "In Queue", "Waiting", "Played Recently", "At Brandywine", or "Unavailable".

**Spotify links (pasted into the search bar)** aren't searched for:

- A **track** link is looked up on Rockbot (`GET /v1/venues/:venue/match?spotify=`), and the matching song shows as the
  only result, with the same actions as any other.
- A **playlist** link shows "Open Playlist", which pushes the playlist (`POST /v1/me/playlists`). The server first finds every
  track on Rockbot (`POST /v1/venues/:venue/playlists/:id/matches`, then polling it), behind a loading screen that counts up,
  so only songs that are really there are listed: grouped like search results, then "Not on Rockbot" and "Couldn't Look Up".
  ↵ does what it does for any search result (Request Song, Upvote…). Request All (⌘⇧↵) asks, then requests every song in the
  background (`POST /v1/venues/:venue/playlists/:id/queue`), and each song's tag shows how it went. ⌘R searches again.

### Actions

The first action is ↵ and the second ⌘↵; the rest are in the action panel (⌘K), grouped in sections. Destructive actions
are never first, use `Action.Style.Destructive`, and ask with `confirmAlert` first. Shortcuts use `Keyboard.Shortcut.Common`
where one fits.

**Search result**, by status:

| Status | ↵ | Then |
| --- | --- | --- |
| Can be requested | **Request Song** | |
| Already in Rockbot's queue | **Upvote** (every account) | Upvote with… |
| Waiting in Zotify's queue | **Show in Queue** (clears search, selects it) | |
| Requestable at another venue | **Switch to Brandywine** (keeps the search) | |
| Unavailable | **Copy Song Name** | |

Every result also has Copy Song Name (⌘⇧C), Refresh (⌘R) and Open Zotify (⌘O).

**Queue items:**

| Item | ↵ | Others |
| --- | --- | --- |
| Now Playing | Copy Song Name | Refresh, Open Zotify |
| On Deck, Coming Up | **Upvote** (every account) | Upvote with… (⌘⇧U), Downvote with… (⌘⇧D, admins), Copy, Refresh, Open Zotify |
| Waiting in Zotify | Copy Song Name | Remove from Queue (⌃X, yours or admins), Move Up (⌘⌥↑) and Move Down (⌘⌥↓, admins), Clear Zotify's Queue (⌃⇧X, admins) |
| Couldn't Be Requested | **Request Again** | Copy |

- **Upvote with…** is an `ActionPanel.Submenu` that loads, when opened (`onOpen`), how many of Zotify's accounts can still
  vote, and lists "1 Account" to "All 12 Accounts". This replaces the website's vote dialog: picking a number is the confirmation.
- **Downvote with…** loads Zotify's downvote rules when opened. Counts are listed fewest first, since a song can be
  downvoted again (until Zotify has added 6), so admins start with as few as will do; it says how many Zotify has added. If they allow it, it lists counts, and picking one asks with a
  destructive `confirmAlert`. If karma protection is the only thing in the way, it has "Override Karma Protection…", which
  pushes a small `Form` (count and reason, ⌘↵ to submit). Otherwise it shows the reason as a disabled item.
- **Remove from Queue** and **Clear Zotify's Queue** ask with `confirmAlert` first.

### Feedback

- Every action shows an animated toast ("Requesting Dancing Queen…"), then turns it into success ("Added to Zotify's queue",
  "#2 in line at The Anteatery") or failure, with the API's own error as the message.
- Changes show in the list straight away (`mutate` with `optimisticUpdate`) and roll back if the request fails.
- After a request or vote, the menu bar is told to refresh (`launchCommand` with `LaunchType.Background`).
- Nothing closes Raycast, so there are no HUDs: you can keep requesting.

### Empty states

| When | `List.EmptyView` |
| --- | --- |
| Not in that school's Zotify yet | "You're not in UCI's Zotify yet", with Request to Join (opens the website) |
| Venue closed | "The Anteatery isn't taking requests right now" |
| Nothing found | "No songs found for …" |
| Queue empty | "Nothing's queued at The Anteatery", with "Type to search for a song" |

## Zotify Now Playing (menu bar)

**In the menu bar:** a Zotify icon, plus the song's title (cut short) unless the "Show Song Title" preference is off.
Hovering shows the song, artist and venue. Nothing's playing, or the venue's closed: just the icon.

**The menu:**

```
Now Playing at The Anteatery
  ♪ Risk It All                     Bruno Mars · 1:32 left
On Deck
  Dior Jeans                        GhostRyder
Waiting in Zotify                     (signed in only)
  1. Dancing Queen                  ABBA · You
Coming Up
  Walls (with Jon Bellion)          ▲2
  … up to 8
──────────
Add Song…                           ⌘N
Open Zotify Queue                   ⌘O
Venue                             ▸ ✓ The Anteatery / Brandywine / UF: The Eatery
Refresh                             ⌘R
```

- Clicking a song opens Zotify Queue with that song selected (`launchContext.pickId` → `selectedItemId`). Holding ⌥ turns
  it into **Upvote** (`alternate`), which votes straight from the menu bar.
- Add Song… opens Zotify Queue ready to search.
- The menu is loaded with `useCachedPromise`, so clicking it shows the last queue instantly while it updates, and
  `isLoading` keeps the command alive until it has.
- Every minute, in the background, it refreshes what's in the menu bar.

## Preferences

| Preference | Type | For |
| --- | --- | --- |
| Personal Access Token | password, optional | Skips OAuth |
| Admin Tools | checkbox | Asks for the admin scope when signing in |
| Show Song Title | checkbox (menu bar only, default on) | Icon only in the menu bar when off |

## Files

```
raycast/
  package.json          the manifest: commands, arguments, preferences
  assets/               extension icon, menu bar icon
  src/queue.tsx         Zotify Queue
  src/now-playing.tsx   the menu bar
  src/add-song.ts       Add Song to Zotify
  src/zotify.ts         OAuth, the API client and types
  src/venues.ts         the shared venue, and the venue picker's data
  src/actions.tsx       the action panels: request, votes, Zotify's queue
  src/downvote-form.tsx the karma override form
```

## Joining the beta

Someone who isn't in the venue's school's Zotify sees why in the queue's empty view, and can get in without leaving Raycast:
**Request to Join** (↵) asks the school's admins, and **Use an Invite Code…** (⌘I) pushes a one-field form. Once they've
asked, the view says the request is waiting (or wasn't approved).

## Feedback, revisited

- A request's success toast has **Undo** (⌘Z while it's showing), which takes the song back out of Zotify's queue if it hasn't
  moved into Rockbot's yet. It's the quickest fix for a mistap, and safer than making requests ask first.
- Failures say why, as text, rather than hiding the reason in a tooltip.
- **Search Artist** (⌘⇧A) on every song searches for its artist, like clicking an artist on the website.

## My Zotify Picks

Your requests, grouped by day (Today, Yesterday, then dates), with the venue and time on each. The search bar's dropdown is
the venue to request at, like the website's picker; ↵ is **Request Again**. Search Artist opens Zotify Queue searching.

## Zotify Meals

- **The dropdown is the meal**, like "Today · Lunch · 11 AM–2:30 PM", for the next week, built from both halls' hours. It
  starts on the meal being served now, or the next one. ⌘] and ⌘[ step to the next and previous meal.
- **Sections are kinds of counter** (Home-Style, Grill, Salad Bar…) across both halls, in the same order as the website, with
  each dish's hall as a tag. Your favorites on the meal come first.
- **The detail pane** has the photo, description, diet tags, allergens (tagged, found in the ingredients, and incomplete),
  nutrition and ingredients, so browsing never needs another screen.
- **Diet…** (⌘⇧D) and **Avoid Allergens…** (⌘⇧X) are submenus of toggles, remembered between runs.
- **Add to Favorites** is ⌘. (Raycast's Pin). **Show Favorite Dishes** (⌘⇧F) pushes them, soonest served first, each with
  its next serving.
- Menus are public; favorites need the `meals:read` and `meals:write` scopes. Someone signed in before the extension asked for
  them gets a toast offering to sign in again.

## Zotify Spaces

Public, so no sign-in. Zotify can't book rooms, so ↵ is always **Book Room**, which opens the room's booking page.

- **The front screen** is rooms free now (or within half an hour), longest first, grouped by location under their casual
  names (Langson, Science Library…), then **Free Soon**. The dropdown is the room size, remembered. The detail pane has the
  photo, description, when it's free, size and directions. It refreshes every 30 seconds.
- **Show This Week** (⌘↵) pushes the room's free times for each of the next seven days.
- **Find a Time…** (⌘F) pushes a form (day, from, until, size); submitting pushes every room free for all of it.
- **Browse All Rooms** (⌘B) pushes every room's free times on a day, picked in the dropdown.
