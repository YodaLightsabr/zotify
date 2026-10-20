import { db, transaction } from "./db.js";

// How long a cached search is trusted before asking Rockbot again
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the database from growing without bound
const MAX_QUERIES_PER_VENUE = 200;

export interface CachedSong {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    requestable: boolean;
}

// A song's details are the same at every venue and never change, so each song is one row in "songs".
// A search row only keeps which songs came up and whether each could be requested at that venue
interface SearchResult {
    id: string;
    requestable: boolean;
}

// Searches used to be cached with every song unrequestable when Rockbot left out the "unavailable" heading, which it does
// when everything can be requested. Drop cached searches where nothing was requestable, once, so they're fetched again
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'droppedUnrequestableSearches'").get()) {
    transaction(() => {
        const { changes } = db.prepare(`DELETE FROM searches WHERE results NOT LIKE '%"requestable":true%'`).run();
        db.prepare("INSERT INTO meta (key, value) VALUES ('droppedUnrequestableSearches', ?)").run(JSON.stringify({ at: Date.now(), dropped: changes }));
        if (changes) console.log(`Dropped ${changes} cached searches where nothing was requestable, so they're searched again`);
    });
}

export function normalizeQuery(query: string) {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const findSearch = db.prepare("SELECT results, cached_at FROM searches WHERE venue = ? AND query = ?");
const findSong = db.prepare("SELECT name, artist, cover FROM songs WHERE id = ?");
const saveSong = db.prepare("INSERT OR REPLACE INTO songs (id, name, artist, cover) VALUES (?, ?, ?, ?)");
const saveSearch = db.prepare("INSERT OR REPLACE INTO searches (venue, query, results, cached_at) VALUES (?, ?, ?, ?)");
const dropExpired = db.prepare("DELETE FROM searches WHERE cached_at < ?");
const keepNewest = db.prepare(`
    DELETE FROM searches WHERE venue = ? AND rowid NOT IN (
        SELECT rowid FROM searches WHERE venue = ? ORDER BY cached_at DESC LIMIT ?
    )
`);

export async function getCachedSearch(venue: string, query: string): Promise<CachedSong[] | null> {
    const row = findSearch.get(venue, normalizeQuery(query)) as { results: string, cached_at: number } | undefined;

    if (!row || row.cached_at < Date.now() - SEARCH_CACHE_TTL_MS) return null;

    const songs: CachedSong[] = [];

    for (const { id, requestable } of JSON.parse(row.results) as SearchResult[]) {
        const song = findSong.get(id) as { name: string, artist: string, cover: string | null } | undefined;

        // Every result's song should be stored; if one somehow isn't, treat the whole search as uncached
        if (!song) return null;

        songs.push({ id, name: song.name, artist: song.artist, ...(song.cover ? { cover: song.cover } : {}), requestable });
    }

    return songs;
}

/** Caches one query's results for several venues in one transaction */
export async function cacheSearches(query: string, resultsByVenue: Record<string, CachedSong[]>) {
    const normalized = normalizeQuery(query);
    const now = Date.now();

    transaction(() => {
        for (const [venue, venueSongs] of Object.entries(resultsByVenue)) {
            // Song details are refreshed whenever a song comes up, and never expire
            for (const song of venueSongs) saveSong.run(song.id, song.name, song.artist, song.cover ?? null);

            saveSearch.run(venue, normalized, JSON.stringify(venueSongs.map(({ id, requestable }) => ({ id, requestable }))), now);
            keepNewest.run(venue, venue, MAX_QUERIES_PER_VENUE);
        }

        dropExpired.run(now - SEARCH_CACHE_TTL_MS);
    });
}
