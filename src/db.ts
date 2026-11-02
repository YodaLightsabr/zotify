import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Zotify's data lives in one SQLite file. Small sections (sessions, members, codes...) are JSON in the kv table;
// the big, growing ones (songs, searches, pick history) get real tables so changes only touch the rows involved
export const DB_FILE = process.env.ZOTIFY_DB ?? ".zotify.db";
// Before SQLite, everything was in this file. It's imported once and then left alone as a backup
const LEGACY_CACHE_FILE = ".cache.json";
// Same TTL searchCache uses: expired searches aren't worth importing
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export const db = new DatabaseSync(DB_FILE);

// WAL keeps the file consistent through crashes and power cuts, and lets reads happen during writes
db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover TEXT
    );

    -- results is a JSON array of { id, requestable }
    CREATE TABLE IF NOT EXISTS searches (
        venue TEXT NOT NULL,
        query TEXT NOT NULL,
        results TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (venue, query)
    );

    CREATE TABLE IF NOT EXISTS pick_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pick_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover TEXT,
        venue TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        requested_by TEXT
    );

    CREATE INDEX IF NOT EXISTS pick_history_requested_at ON pick_history (requested_at);
    CREATE INDEX IF NOT EXISTS pick_history_requested_by ON pick_history (requested_by);

    -- Spotify playlists people have pasted, keyed by Spotify's playlist ID, with their tracks as of the last read
    CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner TEXT,
        may_be_truncated INTEGER NOT NULL DEFAULT 0,
        fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists (id),
        position INTEGER NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_ms INTEGER,
        uri TEXT,
        PRIMARY KEY (playlist_id, position)
    );

    -- Album art for each Spotify track (spotify:track:...) from Spotify's API, or a null image when it has none (see spotifyArt.ts)
    CREATE TABLE IF NOT EXISTS spotify_art (
        uri TEXT PRIMARY KEY,
        image TEXT,
        fetched_at INTEGER NOT NULL
    );

    -- Which people have opened which playlists. Many people can share a playlist, and anyone can have many
    CREATE TABLE IF NOT EXISTS user_playlists (
        email TEXT NOT NULL,
        playlist_id TEXT NOT NULL REFERENCES playlists (id),
        added_at INTEGER NOT NULL,
        opened_at INTEGER NOT NULL,
        PRIMARY KEY (email, playlist_id)
    );

    CREATE INDEX IF NOT EXISTS user_playlists_playlist ON user_playlists (playlist_id);

    -- Everyone Zotify knows: anyone who's signed in, been invited or asked to join (see users.ts). Signing in only proves
    -- someone owns an email address, so the email is who they are, and other tables refer to people by it. created_at is
    -- when Zotify first knew of them; last_active_at is when they last used it
    CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER
    );

    -- Signed-in browsers (see auth.ts). Only a hash of each token is stored, so the database can't be used to sign in
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL REFERENCES users (email),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);

    -- Who's in each school's Zotify during the beta (see beta.ts), and how they got in: joined_via is request, invite or code.
    -- approved_by is the admin who approved or invited them; code is the invite code they used; silent invites sent no email
    CREATE TABLE IF NOT EXISTS school_members (
        school_id TEXT NOT NULL,
        email TEXT NOT NULL REFERENCES users (email),
        joined_via TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        approved_by TEXT,
        code TEXT,
        silent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (school_id, email)
    );

    -- Asking to join a school's Zotify, once per school. status is pending, approved or rejected
    CREATE TABLE IF NOT EXISTS join_requests (
        school_id TEXT NOT NULL,
        email TEXT NOT NULL REFERENCES users (email),
        status TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        decided_at INTEGER,
        decided_by TEXT,
        PRIMARY KEY (school_id, email)
    );

    -- Each person's Library: Rockbot songs (in songs) they requested, saved by hand (source "saved"), that turned up in a
    -- playlist they saved (source "playlist", with playlist_id), or imported from their Spotify likes (source "liked"). removed_at marks songs they took out, so a saved playlist doesn't
    -- put them back; requesting or saving one again does
    CREATE TABLE IF NOT EXISTS library_songs (
        email TEXT NOT NULL,
        song_id TEXT NOT NULL REFERENCES songs (id),
        saved_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        playlist_id TEXT,
        removed_at INTEGER,
        PRIMARY KEY (email, song_id)
    );

    -- The Rockbot songs each playlist's tracks turned out to be, from every time anyone looked it up at any venue, whether or
    -- not they can be requested there. Tracks Rockbot doesn't have aren't here
    CREATE TABLE IF NOT EXISTS playlist_songs (
        playlist_id TEXT NOT NULL REFERENCES playlists (id),
        song_id TEXT NOT NULL REFERENCES songs (id),
        found_at INTEGER NOT NULL,
        PRIMARY KEY (playlist_id, song_id)
    );

    -- Whether each song could be requested at each venue the last time it came up in a search. Unlike searches, kept for good,
    -- so the Library knows what can be played where, and notices when that changes
    CREATE TABLE IF NOT EXISTS song_availability (
        song_id TEXT NOT NULL,
        venue TEXT NOT NULL,
        requestable INTEGER NOT NULL,
        checked_at INTEGER NOT NULL,
        PRIMARY KEY (song_id, venue)
    );

    -- Zotify's own first-in, first-out queue at each venue. Songs wait here until there's room for them in Rockbot's queue.
    -- status: waiting, released (requested or boosted on Rockbot as pick_id), failed (after its retries, with last_error)
    -- or removed. position orders the waiting songs, so admins can rearrange them
    CREATE TABLE IF NOT EXISTS zotify_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue TEXT NOT NULL,
        song_id TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover TEXT,
        requested_by TEXT,
        requested_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER,
        pick_id TEXT,
        released_at INTEGER,
        failed_at INTEGER,
        position REAL
    );

    CREATE INDEX IF NOT EXISTS zotify_queue_status ON zotify_queue (venue, status, id);

    -- Each school gets its own Zotify: www.zotify.app for the main school, or a subdomain like uf.zotify.app.
    -- email_domain turns a bare ID like "panteater" into panteater@uci.edu; id_label is what those IDs are called there
    CREATE TABLE IF NOT EXISTS schools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        -- NULL for the main school, which lives at www.zotify.app
        subdomain TEXT UNIQUE,
        email_domain TEXT,
        id_label TEXT,
        id_placeholder TEXT,
        tagline TEXT,
        footer TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    -- Dining halls with Rockbot. id is used throughout Zotify (queues, searches, history), so it never changes.
    -- home_account is a Rockbot account that only ever checks in here, so it can always read the queue; optional
    CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY,
        school_id TEXT NOT NULL REFERENCES schools (id),
        name TEXT NOT NULL,
        rockbot_id TEXT NOT NULL,
        home_account TEXT,
        position INTEGER NOT NULL DEFAULT 0
    );

    -- The Rockbot accounts Zotify queues and votes with, shared by every venue
    CREATE TABLE IF NOT EXISTS rockbot_accounts (
        username TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        key TEXT NOT NULL,
        password TEXT,
        added_at INTEGER NOT NULL
    );

    -- People who run a school's Zotify: its beta, requests and history. Site admins (auth.ts) run every school
    CREATE TABLE IF NOT EXISTS school_admins (
        school_id TEXT NOT NULL REFERENCES schools (id),
        email TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (school_id, email)
    );
`);

// Zotify Meals: menus from each school's dining site (see src/meals/). Each table is per school.
// meal_reference: allergen and diet tag labels, meal periods and timezone
// meal_locations: a dining hall's stations, meal periods and hours, keyed by the Zotify venue it is
// meal_menus: which items each station serves for one date and meal period; status "none" means no menu was published
// meal_items: each item once, by SKU, however many menus it's on
db.exec(`
    CREATE TABLE IF NOT EXISTS meal_reference (
        school_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meal_locations (
        school_id TEXT NOT NULL,
        venue_id TEXT NOT NULL,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (school_id, venue_id)
    );

    CREATE TABLE IF NOT EXISTS meal_menus (
        school_id TEXT NOT NULL,
        venue_id TEXT NOT NULL,
        date TEXT NOT NULL,
        period_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        stations TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (school_id, venue_id, date, period_id)
    );

    -- Dishes people have starred on Zotify Meals, by recipe, since the same dish has a different SKU at each hall and day
    CREATE TABLE IF NOT EXISTS meal_favorites (
        email TEXT NOT NULL,
        school_id TEXT NOT NULL,
        recipe_id TEXT NOT NULL,
        name TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (email, school_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS meal_items (
        school_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (school_id, sku)
    );
`);

// The public API (see src/developers.ts). Site admins decide who's a developer; developers make personal access tokens and
// OAuth apps. Tokens, secrets and codes are only stored as SHA-256 hashes. Scopes are space-separated, like OAuth's
db.exec(`
    CREATE TABLE IF NOT EXISTS developers (
        email TEXT PRIMARY KEY,
        added_by TEXT NOT NULL,
        added_at INTEGER NOT NULL
    );

    -- prefix is the token's first characters, so people can tell their tokens apart. expires_at is NULL for no expiry
    CREATE TABLE IF NOT EXISTS api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        prefix TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS api_tokens_email ON api_tokens (email);

    -- id is the client ID. redirect_uris is a JSON array. Public apps (like a Raycast extension) have no secret and must use PKCE
    CREATE TABLE IF NOT EXISTS oauth_apps (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        homepage_url TEXT,
        redirect_uris TEXT NOT NULL,
        confidential INTEGER NOT NULL DEFAULT 0,
        secret_hash TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS oauth_apps_owner ON oauth_apps (owner);

    -- Authorization codes, which last a few minutes and work once
    CREATE TABLE IF NOT EXISTS oauth_codes (
        code_hash TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        email TEXT NOT NULL,
        scopes TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT,
        expires_at INTEGER NOT NULL
    );

    -- One row per sign-in to an app: its current access token and refresh token, which change on every refresh
    CREATE TABLE IF NOT EXISTS oauth_grants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        email TEXT NOT NULL,
        scopes TEXT NOT NULL,
        access_hash TEXT NOT NULL UNIQUE,
        access_expires_at INTEGER NOT NULL,
        refresh_hash TEXT NOT NULL UNIQUE,
        refresh_expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        -- The refresh token this one replaced, and when, so a second refresh with it moments later still works
        previous_refresh_hash TEXT,
        rotated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS oauth_grants_email ON oauth_grants (email, app_id);
`);

// Zotify Spaces' record of availability (see src/spaces/availability.ts). The booking sites stop listing a slot once it's
// started, so each slot's status is saved every time it's seen, and the last one saved is how it was when it could last be
// booked. room is like "lib-44696"; times are milliseconds since 1970. Kept, so past days can be shown too
db.exec(`
    CREATE TABLE IF NOT EXISTS space_slots (
        room TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        PRIMARY KEY (room, start_ms)
    );
`);

// How long each deployed commit took from being committed to going live, for the admin dashboard's deploy progress bar
// (see src/deploys.ts). Times are milliseconds since 1970
db.exec(`
    CREATE TABLE IF NOT EXISTS deploy_times (
        commit_hash TEXT PRIMARY KEY,
        committed_at INTEGER NOT NULL,
        live_at INTEGER NOT NULL
    );
`);

// Which school's dining site and which of its locations Zotify Meals reads: schools.dining_config (JSON, see
// src/meals/config.ts) and venues.dining_location_key, like "the-anteatery". Added after both tables existed
for (const [table, column] of [["schools", "dining_config"], ["venues", "dining_location_key"]]) {
    if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(existing => existing.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
}

// oauth_grants from before refreshes had a grace period
for (const column of ["previous_refresh_hash TEXT", "rotated_at INTEGER"]) {
    if (!(db.prepare("PRAGMA table_info(oauth_grants)").all() as { name: string }[]).some(existing => existing.name === column.split(" ")[0])) {
        db.exec(`ALTER TABLE oauth_grants ADD COLUMN ${column}`);
    }
}

// Databases from before the Zotify queue could be rearranged don't have its position column. Songs keep the order they were added in
if (!(db.prepare("PRAGMA table_info(zotify_queue)").all() as { name: string }[]).some(column => column.name === "position")) {
    db.exec("ALTER TABLE zotify_queue ADD COLUMN position REAL; UPDATE zotify_queue SET position = id;");
}

// Private playlists, read through someone's own Spotify (see spotifyApi.ts). Only people who added them can open them
if (!(db.prepare("PRAGMA table_info(playlists)").all() as { name: string }[]).some(column => column.name === "private")) {
    db.exec("ALTER TABLE playlists ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
}

// Playlists' covers from Spotify (see spotifyArt.ts), and when they were last looked up
for (const column of ["image TEXT", "image_checked_at INTEGER"]) {
    if (!(db.prepare("PRAGMA table_info(playlists)").all() as { name: string }[]).some(existing => existing.name === column.split(" ")[0])) {
        db.exec(`ALTER TABLE playlists ADD COLUMN ${column}`);
    }
}

// Playlists people saved to their Library, as opposed to ones they only opened. Added after user_playlists existed
if (!(db.prepare("PRAGMA table_info(user_playlists)").all() as { name: string }[]).some(column => column.name === "saved_at")) {
    db.exec("ALTER TABLE user_playlists ADD COLUMN saved_at INTEGER");
}

/** Runs fn in a transaction: all of it lands, or none of it does */
export function transaction<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

// Sections that have their own tables; everything else in the old cache goes in kv
const TABLE_SECTIONS = ["songs", "searches", "pickHistory"];

/** Brings in the old .cache.json, once. Runs when the module loads, before anything reads the database */
function importLegacyCache() {
    if (db.prepare("SELECT 1 FROM meta WHERE key = 'imported'").get()) return;

    if (!existsSync(LEGACY_CACHE_FILE)) {
        db.prepare("INSERT INTO meta (key, value) VALUES ('imported', ?)").run(JSON.stringify({ at: Date.now(), from: null }));
        return;
    }

    const data = JSON.parse(readFileSync(LEGACY_CACHE_FILE, "utf8"));
    const cutoff = Date.now() - SEARCH_TTL_MS;
    const counts = { sections: 0, songs: 0, searches: 0, picks: 0 };

    transaction(() => {
        const setKv = db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)");
        for (const [key, value] of Object.entries(data)) {
            if (TABLE_SECTIONS.includes(key)) continue;
            setKv.run(key, JSON.stringify(value));
            counts.sections++;
        }

        const setSong = db.prepare("INSERT OR REPLACE INTO songs (id, name, artist, cover) VALUES (?, ?, ?, ?)");
        const addSong = (id: string, song: any) => {
            setSong.run(String(id), String(song.name ?? ""), String(song.artist ?? ""), song.cover ?? null);
            counts.songs++;
        };
        for (const [id, song] of Object.entries<any>(data.songs ?? {})) addSong(id, song);

        const setSearch = db.prepare("INSERT OR REPLACE INTO searches (venue, query, results, cached_at) VALUES (?, ?, ?, ?)");
        for (const [venue, searches] of Object.entries<any>(data.searches ?? {})) {
            for (const [query, search] of Object.entries<any>(searches)) {
                if (search.cachedAt < cutoff) continue;

                // The oldest format kept full songs inside each search
                const results = "songs" in search
                    ? search.songs.map((song: any) => { addSong(song.id, song); return { id: String(song.id), requestable: !!song.requestable }; })
                    : search.results;

                setSearch.run(venue, query, JSON.stringify(results), search.cachedAt);
                counts.searches++;
            }
        }

        // Without a pick history yet, start one from whatever the two-hour queued log still has
        const picks: any[] = data.pickHistory ?? Object.entries<any>(data.queued ?? {}).flatMap(([venue, songs]) =>
            Object.values<any>(songs)
                .filter(song => typeof song === "object" && song.pickId && song.name)
                .map(song => ({ pickId: song.pickId, songId: song.id, name: song.name, artist: song.artist, cover: song.cover, venue, requestedAt: song.queuedAt })));

        const addPick = db.prepare(`INSERT INTO pick_history (pick_id, song_id, name, artist, cover, venue, requested_at, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const pick of [...picks].sort((a, b) => a.requestedAt - b.requestedAt)) {
            addPick.run(pick.pickId, String(pick.songId), pick.name, pick.artist, pick.cover ?? null, pick.venue, pick.requestedAt, pick.requestedBy ?? null);
            counts.picks++;
        }

        db.prepare("INSERT INTO meta (key, value) VALUES ('imported', ?)").run(JSON.stringify({ at: Date.now(), from: LEGACY_CACHE_FILE, ...counts }));
    });

    console.log(`Imported ${LEGACY_CACHE_FILE} into ${DB_FILE}: ${counts.sections} sections, ${counts.songs} songs, ${counts.searches} searches, ${counts.picks} picks. ${LEGACY_CACHE_FILE} was left as a backup.`);
}

importLegacyCache();

// The first school, which everything before schools existed belongs to
export const MAIN_SCHOOL_ID = "uci";

/** Runs fn once per database, recorded in meta under key */
function once(key: string, fn: () => void) {
    if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(key)) return;

    transaction(() => {
        fn();
        db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, JSON.stringify({ at: Date.now() }));
    });
}

// UCI, whose venues keep the ids everything already uses, and the University of Florida
once("seededSchools", () => {
    const addSchool = db.prepare(`
        INSERT OR IGNORE INTO schools (id, name, short_name, subdomain, email_domain, id_label, id_placeholder, tagline, footer, position, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const addVenue = db.prepare("INSERT OR IGNORE INTO venues (id, school_id, name, rockbot_id, home_account, position) VALUES (?, ?, ?, ?, ?, ?)");

    addSchool.run(MAIN_SCHOOL_ID, "UC Irvine", "UCI", null, "uci.edu", "UCInetID", "panteater", "Zot your song into the queue.", "Made with ♪ by Anteaters", 0, Date.now());
    addVenue.run("anteatery", MAIN_SCHOOL_ID, "Anteatery", "162285", "ant3eatery", 0);
    addVenue.run("brandywine", MAIN_SCHOOL_ID, "Brandywine", "162286", "brandy2wine", 1);

    addSchool.run("uf", "University of Florida", "UF", "uf", "ufl.edu", "GatorLink username", "albertgator", "Get your song into the queue.", "Made with ♪ by Gators", 1, Date.now());
    addVenue.run("the-eatery", "uf", "The Eatery", "104128", null, 0);
});

// Rockbot accounts used to live in .accounts.json. Bring them in once; the file is left as a backup
once("importedRockbotAccounts", () => {
    if (!existsSync(".accounts.json")) return;

    const add = db.prepare("INSERT OR IGNORE INTO rockbot_accounts (username, email, refresh_token, key, password, added_at) VALUES (?, ?, ?, ?, ?, ?)");
    const accounts = JSON.parse(readFileSync(".accounts.json", "utf8")) as { username: string, email: string, refreshToken: string, key: string, password?: string }[];

    for (const account of accounts) add.run(account.username, account.email, account.refreshToken, account.key, account.password ?? null, Date.now());
    console.log(`Imported ${accounts.length} Rockbot accounts from .accounts.json, which was left as a backup`);
});

// UCI's dining site, and its two dining halls there
once("seededDining", () => {
    db.prepare("UPDATE schools SET dining_config = ? WHERE id = ?").run(
        JSON.stringify({ storeCode: "ch_uci", storeViewCode: "ch_uci_en", clientPath: "ch/uci/en", campusUrlKey: "campus" }), MAIN_SCHOOL_ID);
    db.prepare("UPDATE venues SET dining_location_key = 'the-anteatery' WHERE id = 'anteatery'").run();
    db.prepare("UPDATE venues SET dining_location_key = 'brandywine' WHERE id = 'brandywine'").run();
});

// The beta's members and requests became per school. Everything from before is UCI's
once("schoolScopedBeta", () => {
    for (const section of ["members", "joinRequests"]) {
        db.prepare("UPDATE kv SET key = ? WHERE key = ?").run(`${section}:${MAIN_SCHOOL_ID}`, section);
    }

    // Invite codes and magic links stay in one place, each now saying which school it's for
    for (const section of ["inviteCodes", "magicLinks"]) {
        const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(section) as { value: string } | undefined;
        if (!row) continue;

        const entries = JSON.parse(row.value) as Record<string, Record<string, unknown>>;
        for (const entry of Object.values(entries)) entry.school ??= MAIN_SCHOOL_ID;
        db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(JSON.stringify(entries), section);
    }
});

// People got a table of their own, and sessions, the beta's members and join requests moved from JSON in kv to tables. Before
// that, a full copy of the database is saved in backups/ beside it, in case anything needs to be looked up or put back
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'usersTable'").get() && (db.prepare("SELECT COUNT(*) AS count FROM kv").get() as { count: number }).count) {
    const backups = join(dirname(DB_FILE), "backups");
    mkdirSync(backups, { recursive: true });
    const file = join(backups, `before-users-table-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    db.prepare("VACUUM INTO ?").run(file);
    console.log(`Saved a copy of the database to ${file} before moving people out of kv`);
}

once("usersTable", () => {
    const now = Date.now();
    const tableExists = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

    // When Zotify first knew of each person, from the earliest thing it has about them
    const firstSeen = new Map<string, number>();
    const seen = (email: unknown, at: unknown) => {
        if (typeof email !== "string" || !email) return;
        firstSeen.set(email, Math.min(firstSeen.get(email) ?? Infinity, typeof at === "number" ? at : now));
    };

    // What's in the blobs, read first: people have to be in users before anything that refers to them
    const sessions: { hash: string, email: string, createdAt: number, expiresAt: number }[] = [];
    const members: { school: string, email: string, member: any }[] = [];
    const requests: { school: string, email: string, request: any }[] = [];
    const rows = db.prepare("SELECT key, value FROM kv WHERE key = 'sessions' OR key LIKE 'members:%' OR key LIKE 'joinRequests:%'").all() as { key: string, value: string }[];

    for (const { key, value } of rows) {
        for (const [id, entry] of Object.entries<any>(JSON.parse(value) ?? {})) {
            if (key === "sessions") {
                seen(entry.email, entry.createdAt);
                // Expired sessions don't work anyway
                if (typeof entry.email === "string" && entry.expiresAt > now) sessions.push({ hash: id, email: entry.email, createdAt: entry.createdAt ?? now, expiresAt: entry.expiresAt });
            } else if (key.startsWith("members:")) {
                seen(id, entry.joinedAt);
                members.push({ school: key.slice("members:".length), email: id, member: entry });
            } else {
                seen(id, entry.requestedAt);
                requests.push({ school: key.slice("joinRequests:".length), email: id, request: entry });
            }
        }
    }

    // Everyone else Zotify has something about. Some of these tables are made by their own modules, so they may not exist yet
    const people: [table: string, email: string, at: string][] = [
        ["pick_history", "requested_by", "requested_at"], ["library_songs", "email", "saved_at"], ["user_playlists", "email", "added_at"],
        ["developers", "email", "added_at"], ["school_admins", "email", "added_at"], ["api_tokens", "email", "created_at"],
        ["oauth_grants", "email", "created_at"], ["meal_favorites", "email", "added_at"], ["keys_devices", "email", "created_at"],
        ["spotify_accounts", "email", "connected_at"], ["user_activity", "email", "last_active_at"]
    ];

    for (const [table, email, at] of people) {
        if (!tableExists(table)) continue;
        for (const row of db.prepare(`SELECT ${email} AS email, MIN(${at}) AS at FROM ${table} WHERE ${email} IS NOT NULL GROUP BY ${email}`).all() as { email: string, at: number }[]) {
            seen(row.email, row.at);
        }
    }

    // When they were last active, from the table that kept it before this one
    const lastActive = new Map(tableExists("user_activity")
        ? (db.prepare("SELECT email, last_active_at FROM user_activity").all() as { email: string, last_active_at: number }[]).map(row => [row.email, row.last_active_at])
        : []);

    const counts = { users: 0, sessions: 0, members: 0, requests: 0 };
    const addUser = db.prepare("INSERT OR IGNORE INTO users (email, created_at, last_active_at) VALUES (?, ?, ?)");
    for (const [email, at] of firstSeen) counts.users += Number(addUser.run(email, at, lastActive.get(email) ?? null).changes);

    const addSession = db.prepare("INSERT OR IGNORE INTO sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)");
    for (const session of sessions) counts.sessions += Number(addSession.run(session.hash, session.email, session.createdAt, session.expiresAt).changes);

    const addMember = db.prepare(`
        INSERT OR IGNORE INTO school_members (school_id, email, joined_via, joined_at, approved_by, code, silent) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const { school, email, member } of members) {
        counts.members += Number(addMember.run(school, email, member.joinedVia ?? "invite", member.joinedAt ?? now,
            member.approvedBy ?? null, member.code ?? null, member.silent ? 1 : 0).changes);
    }

    const addRequest = db.prepare(`
        INSERT OR IGNORE INTO join_requests (school_id, email, status, requested_at, decided_at, decided_by) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const { school, email, request } of requests) {
        counts.requests += Number(addRequest.run(school, email, request.status ?? "pending", request.requestedAt ?? now,
            request.decidedAt ?? null, request.decidedBy ?? null).changes);
    }

    db.exec("DROP TABLE IF EXISTS user_activity; DELETE FROM kv WHERE key = 'sessions' OR key LIKE 'members:%' OR key LIKE 'joinRequests:%';");
    console.log(`Moved people out of kv: ${counts.users} users, ${counts.sessions} sessions, ${counts.members} members, ${counts.requests} join requests`);
});

/** Everything, in the same shape .cache.json used to have. For the admin dashboard's cache view */
export function snapshot() {
    const data: Record<string, any> = {};

    for (const row of db.prepare("SELECT key, value FROM kv ORDER BY key").all() as { key: string, value: string }[]) {
        data[row.key] = JSON.parse(row.value);
    }

    data.songs = Object.fromEntries((db.prepare("SELECT id, name, artist, cover FROM songs").all() as any[])
        .map(({ id, name, artist, cover }) => [id, cover ? { name, artist, cover } : { name, artist }]));

    data.searches = {};
    for (const row of db.prepare("SELECT venue, query, results, cached_at FROM searches ORDER BY cached_at DESC").all() as any[]) {
        (data.searches[row.venue] ??= {})[row.query] = { results: JSON.parse(row.results), cachedAt: row.cached_at };
    }

    data.pickHistory = (db.prepare("SELECT * FROM pick_history ORDER BY id").all() as any[]).map(row => ({
        pickId: row.pick_id, songId: row.song_id, name: row.name, artist: row.artist,
        ...(row.cover ? { cover: row.cover } : {}), venue: row.venue, requestedAt: row.requested_at,
        ...(row.requested_by ? { requestedBy: row.requested_by } : {})
    }));

    data.zotifyQueue = db.prepare("SELECT * FROM zotify_queue ORDER BY id DESC LIMIT 200").all();

    // People, without their sessions
    data.users = db.prepare("SELECT * FROM users ORDER BY created_at").all();
    data.schoolMembers = db.prepare("SELECT * FROM school_members ORDER BY school_id, joined_at").all();
    data.joinRequests = db.prepare("SELECT * FROM join_requests ORDER BY school_id, requested_at").all();

    data.playlists = Object.fromEntries((db.prepare("SELECT * FROM playlists ORDER BY fetched_at DESC").all() as any[]).map(row => [row.id, {
        name: row.name, owner: row.owner, fetchedAt: row.fetched_at,
        tracks: (db.prepare("SELECT title, artist FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(row.id) as any[])
            .map(track => `${track.title} · ${track.artist}`),
        people: (db.prepare("SELECT email FROM user_playlists WHERE playlist_id = ? ORDER BY added_at").all(row.id) as any[]).map(link => link.email)
    }]));

    return data;
}
