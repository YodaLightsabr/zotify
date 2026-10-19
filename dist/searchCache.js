import { db, transaction } from "./db.js";
// How long a cached search is trusted before asking Rockbot again
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the database from growing without bound
const MAX_QUERIES_PER_VENUE = 200;
export function normalizeQuery(query) {
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
export async function getCachedSearch(venue, query) {
    const row = findSearch.get(venue, normalizeQuery(query));
    if (!row || row.cached_at < Date.now() - SEARCH_CACHE_TTL_MS)
        return null;
    const songs = [];
    for (const { id, requestable } of JSON.parse(row.results)) {
        const song = findSong.get(id);
        // Every result's song should be stored; if one somehow isn't, treat the whole search as uncached
        if (!song)
            return null;
        songs.push({ id, name: song.name, artist: song.artist, ...(song.cover ? { cover: song.cover } : {}), requestable });
    }
    return songs;
}
/** Caches one query's results for several venues in one transaction */
export async function cacheSearches(query, resultsByVenue) {
    const normalized = normalizeQuery(query);
    const now = Date.now();
    transaction(() => {
        for (const [venue, venueSongs] of Object.entries(resultsByVenue)) {
            // Song details are refreshed whenever a song comes up, and never expire
            for (const song of venueSongs)
                saveSong.run(song.id, song.name, song.artist, song.cover ?? null);
            saveSearch.run(venue, normalized, JSON.stringify(venueSongs.map(({ id, requestable }) => ({ id, requestable }))), now);
            keepNewest.run(venue, venue, MAX_QUERIES_PER_VENUE);
        }
        dropExpired.run(now - SEARCH_CACHE_TTL_MS);
    });
}
//# sourceMappingURL=searchCache.js.map