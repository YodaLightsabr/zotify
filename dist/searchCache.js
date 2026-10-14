import { cache } from "./cache.js";
// How long a cached search is trusted before asking Rockbot again
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the cache file from growing without bound
const MAX_QUERIES_PER_VENUE = 200;
export function normalizeQuery(query) {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
}
const songInfo = ({ name, artist, cover }) => cover ? { name, artist, cover } : { name, artist };
let migrated;
/** Moves searches saved in the old format to the new one, once per process. Expired ones are dropped rather than kept as songs */
function migrateLegacySearches() {
    migrated ??= (async () => {
        const searches = (await cache.get(["searches"])) ?? {};
        const songs = (await cache.get(["songs"])) ?? {};
        const cutoff = Date.now() - SEARCH_CACHE_TTL_MS;
        let changed = false;
        for (const venueSearches of Object.values(searches)) {
            for (const [query, search] of Object.entries(venueSearches)) {
                if (!("songs" in search))
                    continue;
                changed = true;
                if (search.cachedAt < cutoff) {
                    delete venueSearches[query];
                    continue;
                }
                for (const song of search.songs)
                    songs[song.id] = songInfo(song);
                venueSearches[query] = {
                    results: search.songs.map(({ id, requestable }) => ({ id, requestable })),
                    cachedAt: search.cachedAt
                };
            }
        }
        if (changed) {
            await cache.set(["songs"], songs);
            await cache.set(["searches"], searches);
        }
    })().catch(error => {
        // Try again next time rather than remembering the failure
        migrated = undefined;
        throw error;
    });
    return migrated;
}
async function readLogs() {
    await migrateLegacySearches();
    return {
        searches: ((await cache.get(["searches"])) ?? {}),
        songs: ((await cache.get(["songs"])) ?? {})
    };
}
export async function getCachedSearch(venue, query) {
    const { searches, songs } = await readLogs();
    const entry = searches[venue]?.[normalizeQuery(query)];
    if (!entry || entry.cachedAt < Date.now() - SEARCH_CACHE_TTL_MS)
        return null;
    // Every result's song should be stored; if one somehow isn't, treat the whole search as uncached
    if (entry.results.some(({ id }) => !songs[id]))
        return null;
    return entry.results.map(({ id, requestable }) => ({ id, ...songs[id], requestable }));
}
/** Caches one query's results for several venues, so parallel searches can't overwrite each other */
export async function cacheSearches(query, resultsByVenue) {
    const { searches, songs } = await readLogs();
    const cutoff = Date.now() - SEARCH_CACHE_TTL_MS;
    for (const [venue, venueSongs] of Object.entries(resultsByVenue)) {
        // Song details are refreshed whenever a song comes up, and never expire
        for (const song of venueSongs)
            songs[song.id] = songInfo(song);
        searches[venue] = {
            ...searches[venue],
            [normalizeQuery(query)]: {
                results: venueSongs.map(({ id, requestable }) => ({ id, requestable })),
                cachedAt: Date.now()
            }
        };
    }
    // Drop expired searches, then keep only the newest ones per venue
    for (const [venueName, venueSearches] of Object.entries(searches)) {
        searches[venueName] = Object.fromEntries(Object.entries(venueSearches)
            .filter(([, search]) => search.cachedAt >= cutoff)
            .sort(([, a], [, b]) => b.cachedAt - a.cachedAt)
            .slice(0, MAX_QUERIES_PER_VENUE));
    }
    await cache.set(["songs"], songs);
    await cache.set(["searches"], searches);
}
//# sourceMappingURL=searchCache.js.map