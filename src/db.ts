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
`);

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

    return data;
}
