import { cache } from "./cache.js";

// How long a cached search is trusted before asking Rockbot again
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Keep the cache file from growing without bound
const MAX_QUERIES_PER_VENUE = 200;

export interface CachedSong {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    requestable: boolean;
}

// A song's details are the same at every venue and never change, so each song is stored once under "songs"
interface SongInfo {
    name: string;
    artist: string;
    cover?: string;
}

// Searches only keep which songs came up and whether each could be requested at that venue
interface SearchResult {
    id: string;
    requestable: boolean;
}

interface CachedSearch {
    results: SearchResult[];
    cachedAt: number;
}

// Before song details were split out, each search stored full copies of its songs
interface LegacySearch {
    songs: CachedSong[];
    cachedAt: number;
}

type SearchLog = Record<string, Record<string, CachedSearch | LegacySearch>>;
type SongLog = Record<string, SongInfo>;

export function normalizeQuery(query: string) {
    return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const songInfo = ({ name, artist, cover }: CachedSong): SongInfo => cover ? { name, artist, cover } : { name, artist };

let migrated: Promise<void> | undefined;

/** Moves searches saved in the old format to the new one, once per process. Expired ones are dropped rather than kept as songs */
function migrateLegacySearches() {
    migrated ??= (async () => {
        const searches: SearchLog = (await cache.get(["searches"])) ?? {};
        const songs: SongLog = (await cache.get(["songs"])) ?? {};
        const cutoff = Date.now() - SEARCH_CACHE_TTL_MS;
        let changed = false;

        for (const venueSearches of Object.values(searches)) {
            for (const [query, search] of Object.entries(venueSearches)) {
                if (!("songs" in search)) continue;
                changed = true;

                if (search.cachedAt < cutoff) {
                    delete venueSearches[query];
                    continue;
                }

                for (const song of search.songs) songs[song.id] = songInfo(song);
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
        searches: ((await cache.get(["searches"])) ?? {}) as Record<string, Record<string, CachedSearch>>,
        songs: ((await cache.get(["songs"])) ?? {}) as SongLog
    };
}

export async function getCachedSearch(venue: string, query: string): Promise<CachedSong[] | null> {
    const { searches, songs } = await readLogs();
    const entry = searches[venue]?.[normalizeQuery(query)];

    if (!entry || entry.cachedAt < Date.now() - SEARCH_CACHE_TTL_MS) return null;

    // Every result's song should be stored; if one somehow isn't, treat the whole search as uncached
    if (entry.results.some(({ id }) => !songs[id])) return null;

    return entry.results.map(({ id, requestable }) => ({ id, ...songs[id], requestable }));
}

/** Caches one query's results for several venues, so parallel searches can't overwrite each other */
export async function cacheSearches(query: string, resultsByVenue: Record<string, CachedSong[]>) {
    const { searches, songs } = await readLogs();
    const cutoff = Date.now() - SEARCH_CACHE_TTL_MS;

    for (const [venue, venueSongs] of Object.entries(resultsByVenue)) {
        // Song details are refreshed whenever a song comes up, and never expire
        for (const song of venueSongs) songs[song.id] = songInfo(song);

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
        searches[venueName] = Object.fromEntries(
            Object.entries(venueSearches)
                .filter(([, search]) => search.cachedAt >= cutoff)
                .sort(([, a], [, b]) => b.cachedAt - a.cachedAt)
                .slice(0, MAX_QUERIES_PER_VENUE)
        );
    }

    await cache.set(["songs"], songs);
    await cache.set(["searches"], searches);
}
