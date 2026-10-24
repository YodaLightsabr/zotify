import { API_URL, DOCS_URL } from "./config.js";
import { SCOPES, TOKEN_LIFETIMES } from "./developers.js";
import { AUTHORIZE_URL } from "./routes/oauth.js";

// The public API's OpenAPI 3.1 description, served at /v1/openapi.json. docs.zotify.app renders its reference from this, so
// every route a token can reach is here, with examples. Routes only Zotify's own pages use (signing in, managing tokens and
// apps, site admin) are left out.
//
// x-zotify-access says who can call each route, beyond its scope: "public", "signed-in", "member" (approved at the venue's or
// school's Zotify), or "admin" (one of the school's admins)

type Schema = Record<string, unknown>;
type Access = "public" | "signed-in" | "member" | "admin";

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const array = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
const string = (description?: string, example?: unknown): Schema => ({ type: "string", ...(description ? { description } : {}), ...(example !== undefined ? { example } : {}) });
const integer = (description?: string): Schema => ({ type: "integer", ...(description ? { description } : {}) });
const number = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
const boolean = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
const timestamp = (description: string): Schema => ({ type: "integer", description: `${description} Milliseconds since 1970.` });

/** An object whose listed properties are all required, except those ending in "?" */
function object(properties: Record<string, Schema>, description?: string): Schema {
    const entries = Object.entries(properties).map(([name, schema]) => [name.replace(/\?$/, ""), schema, !name.endsWith("?")] as const);
    return {
        type: "object",
        ...(description ? { description } : {}),
        properties: Object.fromEntries(entries.map(([name, schema]) => [name, schema])),
        required: entries.filter(([, , required]) => required).map(([name]) => name)
    };
}

const path = (name: string, description: string, example: string) =>
    ({ name, in: "path", required: true, description, schema: { type: "string" }, example });
const query = (name: string, description: string, example?: string, required = false) =>
    ({ name, in: "query", required, description, schema: { type: "string" }, ...(example ? { example } : {}) });

const venue = path("venue", "A venue's ID, from GET /v1/schools.", "anteatery");
const school = path("school", "A school's ID, from GET /v1/schools.", "uci");

const ERRORS: Record<number, string> = {
    400: "The request isn't right; error says why.",
    401: "No token, or one that isn't valid (code invalid_token or unauthorized).",
    403: "The token doesn't have the scope (code insufficient_scope), or you aren't allowed (not_approved, forbidden).",
    404: "There's no such venue, school, song or pick (code not_found).",
    409: "It can't be done right now; error says why.",
    429: "Over the rate limit (code rate_limited). Wait for Retry-After seconds.",
    502: "Rockbot didn't answer, or answered with an error. Try again.",
    503: "The venue isn't taking requests right now (code venue_unavailable)."
};

interface Operation {
    tag: string;
    summary: string;
    description?: string;
    scope?: keyof typeof SCOPES;
    access: Access;
    parameters?: Schema[];
    body?: { schema: Schema, example: unknown };
    status?: number;
    response?: { description: string, schema?: Schema, example?: unknown };
    errors?: number[];
}

function operation(id: string, op: Operation) {
    const status = op.status ?? 200;
    const scopes = op.scope ? [op.scope] : [];

    return {
        operationId: id,
        tags: [op.tag],
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        "x-zotify-access": op.access,
        security: op.access === "public" ? [] : [{ personalAccessToken: scopes }, { oauth: scopes }],
        ...(op.parameters ? { parameters: op.parameters } : {}),
        ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: op.body.schema, example: op.body.example } } } } : {}),
        responses: {
            [status]: {
                description: op.response?.description ?? "OK",
                ...(op.response?.schema ? { content: { "application/json": { schema: op.response.schema, ...(op.response.example !== undefined ? { example: op.response.example } : {}) } } } : {})
            },
            ...Object.fromEntries((op.errors ?? []).map(code => [code, { $ref: `#/components/responses/Error${code}` }]))
        }
    };
}

// Errors every authenticated route can answer with
const AUTH_ERRORS = [401, 403, 429];

const exampleSong = { id: "1091753", name: "All Of The Girls You Loved Before", artist: "Taylor Swift", cover: "https://s.rockbot.com/upload/live/albums/500/8/2578038.jpg" };
const exampleEntry = { pickId: "50556543023105", name: "Signed, Sealed, Delivered (I'm Yours)", artist: "Stevie Wonder", cover: "https://s.rockbot.com/upload/live/albums/500/0/159120.jpg", upvotes: 7, downvotes: 0, zotify: true };
const exampleVotes = { requested: 6, alreadyVoted: 0, confirmed: 6, missing: [] };
const exampleItem = {
    sku: "1234567", recipeId: "R-88213", name: "Steamed Mixed Vegetables", description: "Lightly seasoned steamed fresh green and yellow squash, broccoli, cauliflower and bell pepper",
    category: "Vegetables", ingredients: "Broccoli, Cauliflower, Yellow Squash, Zucchini, Red Bell Pepper, Salt, Black Pepper",
    allergens: { tagged: [], incomplete: [], statement: null, possibleFromIngredients: [] },
    dietTags: ["Vegan", "Vegetarian", "Halal Friendly"], serving: "1/2 cup",
    image: { url: "https://delivery-p140432-e1469601.adobeaemcloud.com/adobe/assets/urn:aaid:aem:01b9df60-af0b-4211-8e30-a91859b17d0a/as/steamed-mixed-vegetables.jpg?width=1200&quality=80", thumbnail: "https://delivery-p140432-e1469601.adobeaemcloud.com/adobe/assets/urn:aaid:aem:01b9df60-af0b-4211-8e30-a91859b17d0a/as/steamed-mixed-vegetables.jpg?width=320&quality=80" },
    nutrition: { calories: 17, protein: 1.1, totalFat: 0.3, saturatedFat: 0.1, transFat: 0, cholesterolMg: 0, sodiumMg: 32, totalCarbohydrates: 3.5, dietaryFiber: 1.3, sugars: 1.7, addedSugars: 0 }
};

const schemas: Record<string, Schema> = {
    Error: object({
        error: string("What went wrong, in a sentence you can show people."),
        "code?": string("A stable code to check in code: unauthorized, invalid_token, insufficient_scope, not_approved, forbidden, not_found, invalid_request, rate_limited, venue_unavailable or downvote_refused. Some errors from Rockbot don't have one.")
    }),
    School: object({
        id: string("Used in paths, like /v1/schools/uci.", "uci"),
        name: string(undefined, "UC Irvine"),
        shortName: string(undefined, "UCI"),
        subdomain: nullable(string("The school's Zotify is at this subdomain of zotify.app; null for the main school, at www.zotify.app.")),
        emailDomain: nullable(string("People sign in with an email at this domain.", "uci.edu")),
        idLabel: nullable(string("What the school calls the part before the @.", "UCInetID")),
        idPlaceholder: nullable(string()),
        tagline: nullable(string()),
        footer: nullable(string()),
        url: string("Where the school's Zotify is.", "https://www.zotify.app"),
        venues: array(object({ id: string(undefined, "anteatery"), name: string(undefined, "The Anteatery") }), "Its venues, in the order Zotify shows them.")
    }),
    QueueEntry: object({
        pickId: string("Rockbot's ID for this request. Vote on it with /v1/venues/{venue}/picks/{pickId}/votes."),
        "songId?": string("Only on the playing song."),
        name: string(),
        artist: string(),
        "cover?": string("Album art URL."),
        "upvotes?": integer(),
        "downvotes?": integer(),
        zotify: boolean("Whether it was requested through Zotify.")
    }),
    VenueQueue: object({
        nowPlaying: nullable({ allOf: [ref("QueueEntry"), object({ "duration?": integer("Seconds."), "secondsRemaining?": integer("Seconds left, as of this response.") })] }),
        onDeck: array(ref("QueueEntry"), "Next up, in order. Rockbot locks these in."),
        comingUp: array(ref("QueueEntry"), "After that, ordered by votes.")
    }),
    SearchResult: object({
        id: string("The song's ID. Request it with POST /v1/venues/{venue}/requests."),
        name: string(),
        artist: string(),
        "cover?": string(),
        requestable: boolean("Whether it can be requested at this venue right now."),
        availableAt: nullable(string("When it can't be requested here, another of the school's venues where it can.")),
        pickId: nullable(string("When it's in the queue, its pick, to vote on.")),
        queuedByZotify: nullable(boolean("When it's in the queue, whether Zotify requested it.")),
        queuedAt: nullable(timestamp("When Zotify last requested it, in the last two hours.")),
        boostedAt: nullable(timestamp("When Zotify last voted it up, in the last two hours.")),
        status: nullable({ type: "string", enum: ["queued", "cooldown"], description: "queued: waiting or playing, in Rockbot's queue or Zotify's. cooldown: Zotify requested it in the last two hours and it's already played. null: neither." })
    }),
    ZotifySong: object({
        id: integer("Its place in Zotify's queue, to remove it."),
        songId: string(),
        name: string(),
        artist: string(),
        "cover?": string(),
        requestedAt: timestamp("When it was requested."),
        mine: boolean("Whether you requested it.")
    }),
    ZotifyQueue: object({
        waiting: array(ref("ZotifySong"), "Songs waiting for room in Rockbot's queue, front first. Zotify keeps at most 3 of its songs in Rockbot's queue at a time."),
        failures: array({ allOf: [ref("ZotifySong"), object({ failedAt: timestamp("When it gave up."), attempts: integer(), error: nullable(string()) })] }, "Songs that couldn't be put in Rockbot's queue, even after retrying.")
    }),
    VoteResult: object({
        requested: integer("How many of Zotify's accounts were asked to vote. Accounts that had already voted are skipped."),
        alreadyVoted: nullable(integer("How many had already voted.")),
        confirmed: nullable(integer("How many votes Rockbot shows as landed; null if that couldn't be checked.")),
        missing: array(string(), "Accounts whose votes didn't land, even after retrying.")
    }),
    DownvoteCheck: object({
        allowed: boolean(),
        reason: nullable(string("Why it isn't allowed.")),
        upvotes: nullable(integer()),
        downvotes: nullable(integer()),
        karma: nullable(integer("Upvotes minus downvotes. Songs with positive karma are protected.")),
        outsideDownvotes: nullable(integer("Downvotes from outside Zotify. At least one is needed first.")),
        downvotedAt: nullable(timestamp("When Zotify last downvoted it.")),
        overridable: boolean("Whether karma protection is the only thing in the way, so an overrideReason gets past it."),
        count: integer("The most accounts that can downvote.")
    }),
    Pick: object({
        pickId: string(),
        songId: string(),
        name: string(),
        artist: string(),
        "cover?": string(),
        venue: string(),
        requestedAt: timestamp("When it went into Rockbot's queue.")
    }),
    PlaylistSummary: object({
        id: string("Spotify's playlist ID."),
        name: string(),
        "owner?": string(),
        trackCount: integer(),
        addedAt: timestamp("When you first added it."),
        openedAt: timestamp("When you last opened it.")
    }),
    Playlist: object({
        id: string("Spotify's playlist ID.", "37i9dQZF1DXcBWIGoYBM5M"),
        name: string(),
        "owner?": string(),
        mayBeTruncated: boolean("Spotify only shows Zotify the first 100 tracks, so a playlist with exactly 100 may have more."),
        fetchedAt: timestamp("When its tracks were last read from Spotify."),
        tracks: array(object({ title: string(), artist: string(), "durationMs?": integer(), "uri?": string("Spotify URI.") }))
    }),
    PlaylistJob: object({
        playlistId: string(),
        venue: string(),
        startedBy: string("Email of whoever started it."),
        startedAt: timestamp("When it started."),
        finishedAt: nullable(timestamp("When it finished; null while it's running.")),
        stoppedEarly: nullable(string("Why it stopped before the end, if it did.")),
        tracks: array(object({
            title: string(),
            artist: string(),
            outcome: { type: "string", enum: ["waiting", "working", "queued", "not-found", "unavailable", "already-queued", "played-recently", "duplicate", "failed"] },
            "song?": object({ id: string(), name: string(), artist: string(), "cover?": string() }, "The Rockbot song it matched."),
            "error?": string()
        }), "Every track in playlist order, and what happened to it.")
    }),
    Me: object({
        email: string(undefined, "panteater@uci.edu"),
        siteAdmin: boolean(),
        developer: boolean(),
        scopes: nullable(array(string(), "What this token may do.")),
        schools: array(object({
            id: string(),
            name: string(),
            admin: boolean("Whether you're one of its admins."),
            approved: boolean("Whether you're in its Zotify. It's in private beta, so music routes need this."),
            request: nullable(object({ status: { type: "string", enum: ["pending", "approved", "rejected"] }, requestedAt: integer() }, "Your request to join, if you've made one."))
        }), "Where you stand at every school.")
    }),
    MenuItem: object({
        sku: string("This item's ID. The same dish has a different SKU at each hall and on each day."),
        recipeId: nullable(string("The dish's ID, the same wherever and whenever it's served. Favorites use this.")),
        name: string(),
        description: nullable(string()),
        category: nullable(string()),
        ingredients: nullable(string("As written by the dining hall.")),
        allergens: object({
            tagged: array(string(), "What the dining hall tagged it with."),
            incomplete: array(string(), "Allergens the data is incomplete for. This means unknown, not free from."),
            statement: nullable(string("The dining hall's own statement.")),
            possibleFromIngredients: array(string(), "Allergens Zotify found by reading the ingredients. Not tagged by the dining hall, so it can be wrong either way.")
        }),
        dietTags: array(string()),
        serving: nullable(string()),
        image: nullable(object({ url: string("1200 pixels wide."), thumbnail: string("320 pixels wide.") }, "A photo, for about one in five dishes.")),
        nutrition: object(Object.fromEntries(["calories", "protein", "totalFat", "saturatedFat", "transFat", "cholesterolMg", "sodiumMg", "totalCarbohydrates", "dietaryFiber", "sugars", "addedSugars"]
            .map(name => [name, nullable(number())])), "Per serving: grams, except calories and the ones ending in Mg.")
    }),
    Station: object({
        id: integer(),
        name: string(undefined, "Home"),
        kind: object({ id: string(undefined, "home"), name: string(undefined, "Home-style"), order: integer() }, "Stations of the same kind line up across halls, in the same order everywhere."),
        items: array(ref("MenuItem"))
    }),
    SpaceRoom: object({
        id: string("The booking site's ID and LibCal's, used in /v1/spaces/{school}/rooms/{room}.", "lib-44696"),
        name: string(undefined, "Langson 380"),
        capacity: integer("How many people it's for."),
        location: string("Its location's ID, for ?location=.", "langson"),
        locationName: string(undefined, "Langson Library"),
        locationShortName: string("What people call it, for tight spots.", "Langson"),
        group: string("The booking site's group within the location."),
        image: nullable(string("A photo.")),
        description: nullable(string("Plain text; lists are lines starting with •. Fills in over the first minute after the API starts.")),
        directions: nullable(string()),
        bookingUrl: string("Where to book it. Zotify can't book rooms; this is the booking site's page.")
    }),
    SpaceSlot: object({
        start: string("ISO 8601 with the school's offset.", "2026-10-21T14:30:00-07:00"),
        end: string(undefined, "2026-10-21T15:00:00-07:00"),
        status: { type: "string", enum: ["available", "booked", "unavailable"], description: "unavailable means it can't be booked, like when the room's closed or held." },
        "past?": { type: "boolean", const: true, description: "The slot has started, so the booking site no longer lists it; this is how it was when it could last be booked. Never counted as free." }
    }),
    FreeTime: object({ start: string(), end: string(), minutes: integer() }, "Back-to-back free slots, joined."),
    Favorite: object({
        recipeId: string(),
        name: string(),
        addedAt: timestamp("When you starred it."),
        upcoming: array(object({ date: string(undefined, "2026-10-22"), location: string(), locationName: string(), periodId: integer(), period: string(), stationId: integer(), station: string() }), "When it's served from today on, soonest first.")
    })
};

const responses = Object.fromEntries(Object.entries(ERRORS).map(([code, description]) =>
    [`Error${code}`, { description, content: { "application/json": { schema: ref("Error") } } }]));

const paths: Record<string, Record<string, unknown>> = {
    "/v1": {
        get: operation("index", {
            tag: "Basics", access: "public", summary: "The scopes, and where the docs are",
            response: {
                description: "Every scope and what it lets a token do, and how long personal access tokens can last, in days (null is no expiry).",
                schema: object({ docs: string(), openapi: string(), scopes: { type: "object", additionalProperties: string() }, tokenLifetimes: array(nullable(integer())) }),
                example: { docs: DOCS_URL, openapi: "/v1/openapi.json", scopes: SCOPES, tokenLifetimes: TOKEN_LIFETIMES }
            }
        })
    },
    "/v1/status": {
        get: operation("status", { tag: "Basics", access: "public", summary: "Check the API is up", response: { description: "The text OK." } })
    },
    "/v1/version": {
        get: operation("version", {
            tag: "Basics", access: "public", summary: "The commit the API is running",
            response: { description: "null if it can't be told.", schema: nullable(object({ commit: string(), committedAt: nullable(string()) })), example: { commit: "806029a", committedAt: "2026-10-21T10:12:44-07:00" } }
        })
    },
    "/v1/schools": {
        get: operation("listSchools", {
            tag: "Basics", access: "public", summary: "List schools and their venues",
            description: "Every school with a Zotify. Venues' IDs go in /v1/venues/{venue} paths.",
            response: { description: "Every school.", schema: array(ref("School")) }
        })
    },
    "/v1/schools/{school}": {
        get: operation("getSchool", { tag: "Basics", access: "public", summary: "Get a school", parameters: [school], response: { description: "The school.", schema: ref("School") }, errors: [404] })
    },
    "/v1/me": {
        get: operation("me", {
            tag: "You", access: "signed-in", summary: "Who you are",
            description: "Works with any token, whatever its scopes. schools says which schools' Zotify you're in; music routes need you to be in the venue's school.",
            response: { description: "You.", schema: ref("Me"), example: { email: "panteater@uci.edu", siteAdmin: false, developer: true, scopes: ["music:read", "music:write"], schools: [{ id: "uci", name: "UC Irvine", admin: false, approved: true, request: null }] } },
            errors: AUTH_ERRORS
        })
    },
    "/v1/me/picks": {
        get: operation("myPicks", {
            tag: "You", scope: "music:read", access: "signed-in", summary: "Songs you've requested",
            description: "Every song you've requested through Zotify that made it into Rockbot's queue, newest first.",
            parameters: [query("school", "Only picks at this school's venues.", "uci")],
            response: { description: "Your picks.", schema: array(ref("Pick")) },
            errors: AUTH_ERRORS
        })
    },
    "/v1/me/playlists": {
        get: operation("myPlaylists", {
            tag: "Playlists", scope: "music:read", access: "signed-in", summary: "Your playlists",
            description: "Spotify playlists you've added or opened, most recently opened first.",
            response: { description: "Your playlists.", schema: array(ref("PlaylistSummary")) },
            errors: AUTH_ERRORS
        }),
        post: operation("addPlaylist", {
            tag: "Playlists", scope: "music:write", access: "signed-in", summary: "Add a Spotify playlist",
            description: "Reads a public Spotify playlist and adds it to your playlists. Adding one that's already saved reads it again.",
            body: { schema: object({ url: string("A Spotify playlist link, spotify:playlist: URI, or ID.") }), example: { url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" } },
            status: 201,
            response: { description: "The playlist.", schema: ref("Playlist") },
            errors: [400, ...AUTH_ERRORS, 404, 502]
        })
    },
    "/v1/playlists/{id}": {
        get: operation("getPlaylist", {
            tag: "Playlists", scope: "music:read", access: "signed-in", summary: "Get a playlist and its tracks",
            description: "Opening a playlist adds it to your playlists, so shared links show up there.",
            parameters: [path("id", "Spotify's playlist ID.", "37i9dQZF1DXcBWIGoYBM5M")],
            response: { description: "The playlist.", schema: ref("Playlist") },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/venues/{venue}/queue": {
        get: operation("venueQueue", {
            tag: "Music", access: "public", summary: "What's playing, and what's next",
            description: "The venue's Rockbot queue. Zotify fetches it from Rockbot at most every few seconds, so polling every 15 seconds or so is plenty.",
            parameters: [venue],
            response: { description: "The queue.", schema: ref("VenueQueue"), example: { nowPlaying: { ...exampleEntry, songId: "71356", duration: 172, secondsRemaining: 95 }, onDeck: [], comingUp: [] } },
            errors: [404, 502, 503]
        })
    },
    "/v1/venues/{venue}/search": {
        get: operation("search", {
            tag: "Music", scope: "music:read", access: "member", summary: "Search for songs",
            description: "Searches Rockbot's catalog at the venue. Each result says whether it can be requested here, and whether it's already in the queue. Searches are cached for a day.",
            parameters: [venue, query("q", "What to search for.", "taylor swift", true)],
            response: { description: "Songs, best match first.", schema: array(ref("SearchResult")), example: [{ ...exampleSong, requestable: true, availableAt: null, pickId: null, queuedByZotify: null, queuedAt: null, boostedAt: null, status: null }] },
            errors: [400, ...AUTH_ERRORS, 404, 502]
        })
    },
    "/v1/venues/{venue}/match": {
        get: operation("match", {
            tag: "Music", scope: "music:read", access: "member", summary: "Find a song by title and artist, or a Spotify link",
            description: "Finds the Rockbot song for a track from somewhere else, like Spotify: send title and artist, or a Spotify track link as spotify. match is null when Rockbot doesn't have it.",
            parameters: [
                venue, query("title", "The track's title.", "Dancing Queen"), query("artist", "Its artist.", "ABBA"),
                query("spotify", "Instead of title and artist, a Spotify track link or URI, like https://open.spotify.com/track/….")
            ],
            response: {
                description: "The best match, if there is one. With spotify, track is the title and artist Spotify gave.",
                schema: object({ match: nullable(ref("SearchResult")), "track?": object({ title: string(), artist: string() }) })
            },
            errors: [400, ...AUTH_ERRORS, 404, 502]
        })
    },
    "/v1/venues/{venue}/requests": {
        post: operation("requestSong", {
            tag: "Music", scope: "music:write", access: "member", summary: "Request a song",
            description: "Adds a song to Zotify's queue at the venue. Zotify keeps up to 3 of its songs in Rockbot's queue at a time and puts the next one in as soon as there's room, voting each one up. If the song is already in Rockbot's queue, vote on its pick instead.\n\nThe song has to have come up in a search first, so Zotify knows what it is.",
            parameters: [venue],
            body: { schema: object({ songId: string("From search results.") }), example: { songId: "1091753" } },
            status: 201,
            response: {
                description: "Added. If it was already waiting, the answer is 200 with alreadyWaiting.",
                schema: object({ requestedAt: timestamp("When it was first requested."), position: integer("Its place in Zotify's queue, from 1."), alreadyWaiting: boolean() }),
                example: { requestedAt: 1792607436572, position: 1, alreadyWaiting: false }
            },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/venues/{venue}/picks/{pickId}/votes": {
        get: operation("pickVotes", {
            tag: "Votes", scope: "music:read", access: "member", summary: "How many votes Zotify can add",
            description: "How many of Zotify's Rockbot accounts have voted a pick up, and how many more could. For admins whose token has the admin scope, down says whether it can be downvoted; it's null for everyone else.",
            parameters: [venue, path("pickId", "From the queue or search results.", "50556543023105")],
            response: {
                description: "Its votes.",
                schema: object({ up: object({ total: integer(), voted: integer(), available: integer("0 once every account has voted.") }), down: nullable(ref("DownvoteCheck")) }),
                example: { up: { total: 12, voted: 6, available: 6 }, down: null }
            },
            errors: [...AUTH_ERRORS, 404, 502]
        }),
        post: operation("votePick", {
            tag: "Votes", scope: "music:write", access: "member", summary: "Vote on a song in the queue",
            description: "Votes on a pick with Zotify's Rockbot accounts, then checks the votes landed and re-sends any that didn't, so it can take a few seconds.\n\nUp is for anyone. Down is only for the school's admins, with the admin scope, and only for songs nobody really wants: it's refused (409) for songs with positive karma or no downvotes from outside Zotify. An overrideReason gets past karma protection, and is recorded.",
            parameters: [venue, path("pickId", "From the queue or search results.", "50556543023105")],
            body: {
                schema: object({
                    "direction?": { type: "string", enum: ["up", "down"], default: "up" },
                    "count?": integer("How many accounts vote. Up: all of them by default, and a negative number means all but that many. Down: 1 to 6, 6 by default."),
                    "songId?": string("Up only: the song's ID from search results, so later searches show it as voted up."),
                    "overrideReason?": string("Down only: why it's worth overriding karma protection, 3 to 200 characters.")
                }),
                example: { direction: "up" }
            },
            response: {
                description: "How the votes went. Up votes also have boostedAt.",
                schema: { allOf: [ref("VoteResult"), object({ "boostedAt?": timestamp("When it was voted up.") })] },
                example: { ...exampleVotes, boostedAt: 1792607436572 }
            },
            errors: [400, ...AUTH_ERRORS, 404, 409, 502]
        })
    },
    "/v1/venues/{venue}/zotify-queue": {
        get: operation("zotifyQueue", {
            tag: "Zotify's queue", scope: "music:read", access: "signed-in", summary: "Songs waiting to go into Rockbot's queue",
            parameters: [venue],
            response: { description: "Zotify's queue.", schema: ref("ZotifyQueue"), example: { waiting: [{ id: 412, songId: exampleSong.id, name: exampleSong.name, artist: exampleSong.artist, cover: exampleSong.cover, requestedAt: 1792607436572, mine: true }], failures: [] } },
            errors: [...AUTH_ERRORS, 404]
        }),
        delete: operation("clearZotifyQueue", {
            tag: "Zotify's queue", scope: "admin", access: "admin", summary: "Clear Zotify's queue",
            description: "Takes every waiting song out. Songs already in Rockbot's queue stay there.",
            parameters: [venue],
            response: { description: "How many were taken out.", schema: object({ removed: integer() }) },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/venues/{venue}/zotify-queue/{id}": {
        delete: operation("removeFromZotifyQueue", {
            tag: "Zotify's queue", scope: "music:write", access: "member", summary: "Take a song out of Zotify's queue",
            description: "Your own songs, or anyone's for admins with the admin scope.",
            parameters: [venue, path("id", "The song's id in Zotify's queue.", "412")],
            status: 204,
            response: { description: "Taken out." },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/venues/{venue}/zotify-queue/order": {
        put: operation("reorderZotifyQueue", {
            tag: "Zotify's queue", scope: "admin", access: "admin", summary: "Rearrange Zotify's queue",
            parameters: [venue],
            body: { schema: object({ ids: array(integer(), "Every waiting song's id, in the new order.") }), example: { ids: [415, 412, 413] } },
            response: { description: "The queue in its new order.", schema: ref("ZotifyQueue") },
            errors: [400, ...AUTH_ERRORS, 404, 409]
        })
    },
    "/v1/venues/{venue}/playlists/{id}/queue": {
        post: operation("queuePlaylist", {
            tag: "Playlists", scope: "music:write", access: "member", summary: "Request a whole playlist",
            description: "Starts requesting every track in the playlist at the venue, in order, in the background. Tracks Rockbot doesn't have, or that can't be requested there, are skipped. Poll the GET to follow along. Starting it again while it's running returns the same job.",
            parameters: [venue, path("id", "Spotify's playlist ID. Add it first with POST /v1/me/playlists.", "37i9dQZF1DXcBWIGoYBM5M")],
            status: 202,
            response: { description: "The job.", schema: ref("PlaylistJob") },
            errors: [...AUTH_ERRORS, 404]
        }),
        get: operation("playlistQueueStatus", {
            tag: "Playlists", scope: "music:read", access: "member", summary: "How requesting a playlist is going",
            parameters: [venue, path("id", "Spotify's playlist ID.", "37i9dQZF1DXcBWIGoYBM5M")],
            response: { description: "The latest job, or null if nobody's started one in the last hour.", schema: nullable(ref("PlaylistJob")) },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/join-request": {
        post: operation("requestToJoin", {
            tag: "You", access: "signed-in", summary: "Ask to join a school's Zotify",
            description: "Zotify is in private beta. This asks the school's admins to let you in, once.",
            parameters: [school],
            response: { description: "Your request.", schema: object({ request: object({ status: string(), requestedAt: integer() }) }) },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/invite-codes/redeem": {
        post: operation("redeemInviteCode", {
            tag: "You", access: "signed-in", summary: "Join with an invite code",
            parameters: [school],
            body: { schema: object({ code: string() }), example: { code: "ZOT-4F7K" } },
            response: { description: "Where you stand now.", schema: object({ approved: boolean(), request: nullable(object({ status: string(), requestedAt: integer() })) }) },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/spaces/{school}": {
        get: operation("spacesSchool", {
            tag: "Zotify Spaces", access: "public", summary: "Study rooms and their locations",
            description: "Every bookable study room at the school's libraries and housing, from their LibCal booking sites. Zotify Spaces is public: no token needed, and any site can call it.",
            parameters: [school],
            response: { description: "Locations and rooms.", schema: object({ school: string(), timezone: string(), locations: array(object({ id: string(), name: string(), shortName: string(), site: string(), siteName: string(), url: string(), rooms: integer() })), rooms: array(ref("SpaceRoom")) }) },
            errors: [404, 502]
        })
    },
    "/v1/spaces/{school}/now": {
        get: operation("spacesNow", {
            tag: "Zotify Spaces", access: "public", summary: "Rooms free now",
            description: "Rooms whose next free stretch starts within half an hour, longest first, and in soon, rooms free within two hours, soonest first. Booking sites never list a slot that's already started, so a room that's empty right now usually shows as free from the next half hour.\n\nAvailability is fetched live from the booking sites (shared for at most 15 seconds) and never cached by browsers. If a site can't be reached, its rooms are left out and listed in errors.",
            parameters: [school, query("capacity", "At least this many people.", "4"), query("location", "Only these locations, comma-separated.", "langson,science")],
            response: {
                description: "Free rooms.",
                schema: object({
                    at: string("Now, in the school's timezone."),
                    rooms: array({ allOf: [ref("SpaceRoom"), object({ freeFrom: string(), freeUntil: string(), minutes: integer("How long it's free, from now or from freeFrom."), startsInMinutes: integer("0 when it's free now.") })] }),
                    soon: array({ allOf: [ref("SpaceRoom"), object({ freeFrom: string(), freeUntil: string(), minutes: integer(), startsInMinutes: integer() })] }),
                    errors: array(object({ location: string(), error: string() }))
                })
            },
            errors: [400, 404, 502]
        })
    },
    "/v1/spaces/{school}/free": {
        get: operation("spacesFree", {
            tag: "Zotify Spaces", access: "public", summary: "Rooms free for a whole stretch of time",
            parameters: [
                school, query("date", "today (the default), tomorrow, or YYYY-MM-DD.", "tomorrow"), query("from", "Start, in the school's timezone.", "14:00", true),
                query("to", "End; 24:00 is midnight.", "16:00", true), query("capacity", "At least this many people.", "4"), query("location", "Only these locations, comma-separated.")
            ],
            response: { description: "Rooms free from from to to, with the whole free stretch that covers it.", schema: object({ date: string(), from: string(), to: string(), rooms: array({ allOf: [ref("SpaceRoom"), object({ freeFrom: string(), freeUntil: string(), minutes: integer() })] }), errors: array(object({ location: string(), error: string() })) }) },
            errors: [400, 404, 502]
        })
    },
    "/v1/spaces/{school}/availability": {
        get: operation("spacesDay", {
            tag: "Zotify Spaces", access: "public", summary: "Every room's slots on a day",
            parameters: [school, query("date", "today (the default), tomorrow, or YYYY-MM-DD, within the booking window (about two weeks).", "today"), query("capacity", "At least this many people."), query("location", "Only these locations, comma-separated.", "oasis")],
            response: { description: "Each room with its slots (from now on, for today) and free stretches.", schema: object({ date: string(), rooms: array({ allOf: [ref("SpaceRoom"), object({ slots: array(ref("SpaceSlot")), free: array(ref("FreeTime")) })] }), errors: array(object({ location: string(), error: string() })) }) },
            errors: [400, 404, 502]
        })
    },
    "/v1/spaces/{school}/rooms/{room}": {
        get: operation("spacesRoom", {
            tag: "Zotify Spaces", access: "public", summary: "One room's availability over several days",
            parameters: [school, path("room", "A room's id.", "lib-44696"), query("days", "How many days from today, 1 to 14 (7 by default).", "7")],
            response: { description: "The room, and its slots and free stretches for each day.", schema: { allOf: [ref("SpaceRoom"), object({ days: array(object({ date: string(), slots: array(ref("SpaceSlot")), free: array(ref("FreeTime")) })) })] } },
            errors: [400, 404, 502]
        })
    },
    "/v1/meals": {
        get: operation("mealsIndex", {
            tag: "Zotify Meals", access: "public", summary: "Schools and their dining halls",
            description: "Zotify Meals' menus are public: no token needed, and any site can call them. Answers can be cached for a few minutes.",
            response: { description: "Schools.", schema: object({ schools: array(object({ id: string(), name: string(), locations: array(object({ id: string(), name: string() })) })) }), example: { schools: [{ id: "uci", name: "UC Irvine", locations: [{ id: "anteatery", name: "The Anteatery" }, { id: "brandywine", name: "Brandywine" }] }] } }
        })
    },
    "/v1/meals/{school}": {
        get: operation("mealsSchool", {
            tag: "Zotify Meals", access: "public", summary: "A school's labels, meal periods and dates",
            description: "Allergen and diet tag labels, meal periods, dining halls, and every date with menus kept. Menus are kept from the day Zotify Meals started, through two weeks ahead.",
            parameters: [school],
            response: { description: "The school's reference data.", schema: object({ school: string(), timezone: string(undefined, "America/Los_Angeles"), allergens: array(object({})), dietTags: array(object({})), mealPeriods: array(object({})), locations: array(object({ id: string(), name: string(), menusPublishedThrough: nullable(string()) })), firstDate: nullable(string()), lastDate: nullable(string()), dates: array(string()) }) },
            errors: [404, 503]
        })
    },
    "/v1/meals/{school}/{location}": {
        get: operation("mealsLocation", {
            tag: "Zotify Meals", access: "public", summary: "A dining hall's stations and hours",
            parameters: [school, path("location", "A dining hall's ID.", "brandywine")],
            response: { description: "Its stations, meal periods, and hours for the next 14 days.", schema: object({ id: string(), name: string(), menusPublishedThrough: nullable(string()), stations: array(object({})), mealPeriods: array(object({})), hours: array(object({})), transitionNote: nullable(string()) }) },
            errors: [404, 503]
        })
    },
    "/v1/meals/{school}/{location}/{date}": {
        get: operation("mealsDay", {
            tag: "Zotify Meals", access: "public", summary: "A day's menu",
            description: "Every meal period served that day, with each station's dishes. Stations are in the same order at every hall. Past days work as long as they were saved.",
            parameters: [
                school, path("location", "A dining hall's ID.", "brandywine"), path("date", "YYYY-MM-DD, today, tomorrow or yesterday, in the school's timezone.", "today"),
                query("period", "One meal period, by slug or ID.", "lunch"),
                query("exclude", "Leave out dishes tagged with, or whose ingredients mention, these allergens. Comma-separated.", "milk,peanuts"),
                query("diet", "Only dishes with these diet tags. Comma-separated.", "vegan")
            ],
            response: {
                description: "The day's menu.",
                schema: object({
                    location: string(), name: string(), date: string(), schedule: nullable(string()),
                    periods: array(object({
                        id: integer(), name: string(), slug: string(),
                        hours: array(object({ opens: string(undefined, "11:00"), closes: string(undefined, "14:30") })),
                        scheduled: boolean("Whether the hours say it's served that day."),
                        menu: { type: "string", enum: ["menu", "none", "not-fetched"] },
                        updatedAt: nullable(string()),
                        stations: array(ref("Station"))
                    })),
                    fetched: boolean("False when none of the day's menus were ever fetched: more than two weeks ahead, or before Zotify Meals started."),
                    past: boolean(),
                    transitionNote: nullable(string())
                }),
                example: { location: "anteatery", name: "The Anteatery", date: "2026-10-21", schedule: "standard", periods: [{ id: 106, name: "Lunch", slug: "lunch", hours: [{ opens: "11:00", closes: "14:30" }], scheduled: true, menu: "menu", updatedAt: "2026-10-21T17:00:04.000Z", stations: [{ id: 32, name: "Home", kind: { id: "home", name: "Home-style", order: 0 }, items: [exampleItem] }] }], fetched: true, past: false, transitionNote: null }
            },
            errors: [400, 404, 503]
        })
    },
    "/v1/meals/{school}/items/{sku}": {
        get: operation("mealsItem", {
            tag: "Zotify Meals", access: "public", summary: "A dish, and when it's served",
            parameters: [school, path("sku", "The item's SKU, from a menu.", "1234567")],
            response: { description: "The dish, and every menu it's on.", schema: { allOf: [ref("MenuItem"), object({ servedAt: array(object({ date: string(), location: string(), periodId: integer(), period: nullable(string()), stationId: integer() })) })] } },
            errors: [404, 503]
        })
    },
    "/v1/meals/{school}/favorites": {
        get: operation("mealFavorites", {
            tag: "Zotify Meals", scope: "meals:read", access: "signed-in", summary: "Your favorite dishes",
            description: "Dishes you've starred, each with when it's served next across the school's halls.",
            parameters: [school],
            response: { description: "Your favorites.", schema: array(ref("Favorite")) },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/meals/{school}/favorites/{recipeId}": {
        put: operation("addMealFavorite", {
            tag: "Zotify Meals", scope: "meals:write", access: "signed-in", summary: "Star a dish",
            parameters: [school, path("recipeId", "The dish's recipeId, from a menu.", "R-88213")],
            body: { schema: object({ name: string("The dish's name.") }), example: { name: "Steamed Mixed Vegetables" } },
            status: 204,
            response: { description: "Starred." },
            errors: [400, ...AUTH_ERRORS, 404]
        }),
        delete: operation("removeMealFavorite", {
            tag: "Zotify Meals", scope: "meals:write", access: "signed-in", summary: "Unstar a dish",
            parameters: [school, path("recipeId", "The dish's recipeId.", "R-88213")],
            status: 204,
            response: { description: "Unstarred." },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/history": {
        get: operation("schoolHistory", {
            tag: "Admin", scope: "admin", access: "admin", summary: "Every song requested at the school",
            parameters: [school],
            response: { description: "Every pick at the school's venues, newest first, with who requested it.", schema: array({ allOf: [ref("Pick"), object({ "requestedBy?": string() })] }) },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/beta": {
        get: operation("betaOverview", {
            tag: "Admin", scope: "admin", access: "admin", summary: "The school's members, requests and invite codes",
            parameters: [school],
            response: { description: "The beta.", schema: object({ members: array(object({})), requests: array(object({})), codes: array(object({})) }) },
            errors: [...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/beta/decisions": {
        post: operation("decideJoinRequest", {
            tag: "Admin", scope: "admin", access: "admin", summary: "Approve or reject a request to join",
            parameters: [school],
            body: { schema: object({ email: string(), decision: { type: "string", enum: ["approved", "rejected"] }, "silent?": boolean("Don't email them.") }), example: { email: "peter@uci.edu", decision: "approved" } },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/beta/invites": {
        post: operation("inviteMember", {
            tag: "Admin", scope: "admin", access: "admin", summary: "Let someone in",
            parameters: [school],
            body: { schema: object({ netid: string("Their email, or the part before the @ at the school's email domain."), "silent?": boolean("Don't email them.") }), example: { netid: "peter" } },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/invite-codes": {
        post: operation("createInviteCode", {
            tag: "Admin", scope: "admin", access: "admin", summary: "Make an invite code",
            parameters: [school],
            body: { schema: object({ "maxUses?": nullable(integer("Leave out for unlimited.")) }), example: { maxUses: 20 } },
            status: 201,
            response: { description: "The code, and a link that uses it.", schema: object({ code: string(), url: string() }) },
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/schools/{school}/invite-codes/{code}": {
        delete: operation("revokeInviteCode", {
            tag: "Admin", scope: "admin", access: "admin", summary: "Revoke an invite code",
            parameters: [school, path("code", "The code.", "ZOT-4F7K")],
            status: 204,
            errors: [400, ...AUTH_ERRORS, 404]
        })
    },
    "/v1/oauth/token": {
        post: {
            operationId: "oauthToken",
            tags: ["OAuth"],
            summary: "Get or refresh an access token",
            description: "OAuth 2.0's token endpoint. Takes a form (application/x-www-form-urlencoded) or JSON. Confidential apps authenticate with HTTP Basic (client_secret_basic) or client_secret in the body; public apps send only client_id, and must have used PKCE. Refresh tokens work once: every refresh returns a new one.",
            "x-zotify-access": "public",
            security: [],
            requestBody: {
                required: true,
                content: {
                    "application/x-www-form-urlencoded": {
                        schema: object({
                            grant_type: { type: "string", enum: ["authorization_code", "refresh_token"] },
                            client_id: string(),
                            "client_secret?": string("Confidential apps only."),
                            "code?": string("authorization_code: the code from the redirect."),
                            "redirect_uri?": string("authorization_code: the same redirect_uri sent to the authorize page."),
                            "code_verifier?": string("authorization_code: the PKCE verifier."),
                            "refresh_token?": string("refresh_token: the latest refresh token."),
                            "scope?": string("refresh_token: fewer scopes than were allowed, space-separated, to narrow the token from then on.")
                        }),
                        example: { grant_type: "authorization_code", client_id: "zotify_app_09f95b95612b5fc572bf85de", code: "VaiqPIux90iYPVI5McWJncDrZlYrGqSmootGtju8Qdw", redirect_uri: "https://raycast.com/redirect?packageName=Extension", code_verifier: "…" }
                    }
                }
            },
            responses: {
                200: {
                    description: "Tokens. Access tokens last an hour; refresh tokens last 180 days from their last use.",
                    content: { "application/json": { schema: object({ access_token: string(), token_type: string(undefined, "Bearer"), expires_in: integer(), refresh_token: string(), scope: string() }), example: { access_token: "zotify_at_…", token_type: "Bearer", expires_in: 3600, refresh_token: "zotify_rt_…", scope: "music:read music:write" } } }
                },
                400: { description: "OAuth's error format: { error, error_description }, where error is invalid_request, invalid_grant, invalid_scope or unsupported_grant_type." },
                401: { description: "invalid_client: an unknown client_id, or the wrong secret." }
            }
        }
    },
    "/v1/oauth/revoke": {
        post: {
            operationId: "oauthRevoke",
            tags: ["OAuth"],
            summary: "Revoke a token",
            description: "Revokes an access token or refresh token, which signs that sign-in out entirely, or a personal access token. Always answers 200, even for tokens that don't exist (RFC 7009).",
            "x-zotify-access": "public",
            security: [],
            requestBody: { required: true, content: { "application/x-www-form-urlencoded": { schema: object({ token: string(), "client_id?": string(), "client_secret?": string() }) } } },
            responses: { 200: { description: "Revoked, or it didn't exist." } }
        }
    }
};

export const spec = {
    openapi: "3.1.0",
    info: {
        title: "Zotify API",
        version: "1",
        description: `Everything Zotify's own pages can do: search for songs and request them at dining halls, vote, request whole Spotify playlists, see what's playing, and Zotify Meals' menus and favorites. The guides are at ${DOCS_URL}.`
    },
    servers: [{ url: API_URL }],
    tags: [
        { name: "Basics", description: "Schools, venues and the API itself. No token needed." },
        { name: "You", description: "Who you are, your picks, and joining a school's Zotify." },
        { name: "Music", description: "What's playing at a venue, searching, and requesting songs. Requesting needs you to be in the venue's school's Zotify." },
        { name: "Votes", description: "Voting on songs already in a venue's Rockbot queue, with Zotify's accounts." },
        { name: "Zotify's queue", description: "Songs waiting to go into Rockbot's queue. Zotify keeps at most 3 of its songs in Rockbot's queue at a venue, and adds the next as each one plays." },
        { name: "Playlists", description: "Spotify playlists, and requesting every track in one." },
        { name: "Zotify Meals", description: "Dining hall menus, which are public, and your favorite dishes." },
        { name: "Zotify Spaces", description: "Study rooms at the libraries and housing, and when they're free. Public, and live." },
        { name: "Admin", description: "For a school's admins, with the admin scope." },
        { name: "OAuth", description: "Signing people in to your app. See the authentication guide." }
    ],
    paths,
    components: {
        schemas,
        responses,
        securitySchemes: {
            personalAccessToken: {
                type: "http",
                scheme: "bearer",
                description: `A personal access token from www.zotify.app/developers, like zotify_pat_…, in the Authorization header. Developers only. Tokens last ${TOKEN_LIFETIMES.filter(Boolean).join(", ")} days, or never expire.`
            },
            oauth: {
                type: "oauth2",
                description: "Sign people in to your app. Public apps (desktop, mobile, Raycast) must use PKCE with S256.",
                flows: {
                    authorizationCode: {
                        authorizationUrl: AUTHORIZE_URL,
                        tokenUrl: `${API_URL}/v1/oauth/token`,
                        refreshUrl: `${API_URL}/v1/oauth/token`,
                        scopes: SCOPES
                    }
                }
            }
        }
    }
};
