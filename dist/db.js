import { existsSync, readFileSync } from "node:fs";
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

    -- Which people have opened which playlists. Many people can share a playlist, and anyone can have many
    CREATE TABLE IF NOT EXISTS user_playlists (
        email TEXT NOT NULL,
        playlist_id TEXT NOT NULL REFERENCES playlists (id),
        added_at INTEGER NOT NULL,
        opened_at INTEGER NOT NULL,
        PRIMARY KEY (email, playlist_id)
    );

    CREATE INDEX IF NOT EXISTS user_playlists_playlist ON user_playlists (playlist_id);

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

    -- Each school gets its own Zotify: zotify.app for the main school, or a subdomain like uf.zotify.app.
    -- email_domain turns a bare ID like "panteater" into panteater@uci.edu; id_label is what those IDs are called there
    CREATE TABLE IF NOT EXISTS schools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL,
        -- NULL for the main school, which lives at zotify.app itself
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

    CREATE TABLE IF NOT EXISTS meal_items (
        school_id TEXT NOT NULL,
        sku TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (school_id, sku)
    );
`);
// Which school's dining site and which of its locations Zotify Meals reads: schools.dining_config (JSON, see
// src/meals/config.ts) and venues.dining_location_key, like "the-anteatery". Added after both tables existed
for (const [table, column] of [["schools", "dining_config"], ["venues", "dining_location_key"]]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(existing => existing.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
}
// Databases from before the Zotify queue could be rearranged don't have its position column. Songs keep the order they were added in
if (!db.prepare("PRAGMA table_info(zotify_queue)").all().some(column => column.name === "position")) {
    db.exec("ALTER TABLE zotify_queue ADD COLUMN position REAL; UPDATE zotify_queue SET position = id;");
}
/** Runs fn in a transaction: all of it lands, or none of it does */
export function transaction(fn) {
    db.exec("BEGIN");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
// Sections that have their own tables; everything else in the old cache goes in kv
const TABLE_SECTIONS = ["songs", "searches", "pickHistory"];
/** Brings in the old .cache.json, once. Runs when the module loads, before anything reads the database */
function importLegacyCache() {
    if (db.prepare("SELECT 1 FROM meta WHERE key = 'imported'").get())
        return;
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
            if (TABLE_SECTIONS.includes(key))
                continue;
            setKv.run(key, JSON.stringify(value));
            counts.sections++;
        }
        const setSong = db.prepare("INSERT OR REPLACE INTO songs (id, name, artist, cover) VALUES (?, ?, ?, ?)");
        const addSong = (id, song) => {
            setSong.run(String(id), String(song.name ?? ""), String(song.artist ?? ""), song.cover ?? null);
            counts.songs++;
        };
        for (const [id, song] of Object.entries(data.songs ?? {}))
            addSong(id, song);
        const setSearch = db.prepare("INSERT OR REPLACE INTO searches (venue, query, results, cached_at) VALUES (?, ?, ?, ?)");
        for (const [venue, searches] of Object.entries(data.searches ?? {})) {
            for (const [query, search] of Object.entries(searches)) {
                if (search.cachedAt < cutoff)
                    continue;
                // The oldest format kept full songs inside each search
                const results = "songs" in search
                    ? search.songs.map((song) => { addSong(song.id, song); return { id: String(song.id), requestable: !!song.requestable }; })
                    : search.results;
                setSearch.run(venue, query, JSON.stringify(results), search.cachedAt);
                counts.searches++;
            }
        }
        // Without a pick history yet, start one from whatever the two-hour queued log still has
        const picks = data.pickHistory ?? Object.entries(data.queued ?? {}).flatMap(([venue, songs]) => Object.values(songs)
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
function once(key, fn) {
    if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(key))
        return;
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
    if (!existsSync(".accounts.json"))
        return;
    const add = db.prepare("INSERT OR IGNORE INTO rockbot_accounts (username, email, refresh_token, key, password, added_at) VALUES (?, ?, ?, ?, ?, ?)");
    const accounts = JSON.parse(readFileSync(".accounts.json", "utf8"));
    for (const account of accounts)
        add.run(account.username, account.email, account.refreshToken, account.key, account.password ?? null, Date.now());
    console.log(`Imported ${accounts.length} Rockbot accounts from .accounts.json, which was left as a backup`);
});
// UCI's dining site, and its two dining halls there
once("seededDining", () => {
    db.prepare("UPDATE schools SET dining_config = ? WHERE id = ?").run(JSON.stringify({ storeCode: "ch_uci", storeViewCode: "ch_uci_en", clientPath: "ch/uci/en", campusUrlKey: "campus" }), MAIN_SCHOOL_ID);
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
        const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(section);
        if (!row)
            continue;
        const entries = JSON.parse(row.value);
        for (const entry of Object.values(entries))
            entry.school ??= MAIN_SCHOOL_ID;
        db.prepare("UPDATE kv SET value = ? WHERE key = ?").run(JSON.stringify(entries), section);
    }
});
/** Everything, in the same shape .cache.json used to have. For the admin dashboard's cache view */
export function snapshot() {
    const data = {};
    for (const row of db.prepare("SELECT key, value FROM kv ORDER BY key").all()) {
        data[row.key] = JSON.parse(row.value);
    }
    data.songs = Object.fromEntries(db.prepare("SELECT id, name, artist, cover FROM songs").all()
        .map(({ id, name, artist, cover }) => [id, cover ? { name, artist, cover } : { name, artist }]));
    data.searches = {};
    for (const row of db.prepare("SELECT venue, query, results, cached_at FROM searches ORDER BY cached_at DESC").all()) {
        (data.searches[row.venue] ??= {})[row.query] = { results: JSON.parse(row.results), cachedAt: row.cached_at };
    }
    data.pickHistory = db.prepare("SELECT * FROM pick_history ORDER BY id").all().map(row => ({
        pickId: row.pick_id, songId: row.song_id, name: row.name, artist: row.artist,
        ...(row.cover ? { cover: row.cover } : {}), venue: row.venue, requestedAt: row.requested_at,
        ...(row.requested_by ? { requestedBy: row.requested_by } : {})
    }));
    data.zotifyQueue = db.prepare("SELECT * FROM zotify_queue ORDER BY id DESC LIMIT 200").all();
    data.playlists = Object.fromEntries(db.prepare("SELECT * FROM playlists ORDER BY fetched_at DESC").all().map(row => [row.id, {
            name: row.name, owner: row.owner, fetchedAt: row.fetched_at,
            tracks: db.prepare("SELECT title, artist FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(row.id)
                .map(track => `${track.title} · ${track.artist}`),
            people: db.prepare("SELECT email FROM user_playlists WHERE playlist_id = ? ORDER BY added_at").all(row.id).map(link => link.email)
        }]));
    return data;
}
//# sourceMappingURL=db.js.map