import { getHomeAccount, rockbotVenue, type VenueName } from "./accounts.js";
import type { QueueEntry } from "./client.js";
import { fillQueuedDetails, getRecentlyBoosted, getRecentlyQueued } from "./queued.js";
import { cacheSearches, getCachedSearch, type CachedSong } from "./searchCache.js";
import { getVenueQueue, isFromZotify, isSameSong, queueEntries } from "./venueQueue.js";
import { getVenue, getVenues } from "./schools.js";
import { getWaiting } from "./zotifyQueue.js";

/** Searches Rockbot (or the cache) at a venue and adds each song's queue status, cooldown and availability at the school's other venues */
export async function searchSongs(venueName: VenueName, query: string) {
    const schoolId = getVenue(venueName)?.schoolId;
    const otherVenues = schoolId ? getVenues(schoolId).map(venue => venue.id).filter(id => id !== venueName) : [];

    const [{ songs, otherSongs, cacheHit }, recentlyQueued, recentlyBoosted, liveQueue] = await Promise.all([
        searchAllVenues(venueName, otherVenues, query),
        getRecentlyQueued(venueName),
        getRecentlyBoosted(venueName),
        getVenueQueue(venueName).queue
            .catch(error => (console.error(`Could not load the queue at ${venueName} for search:`, error), null))
    ]);
    const liveEntries = liveQueue ? queueEntries(liveQueue) : null;
    // Songs waiting in Zotify's queue count as queued, since they're on their way into Rockbot's
    const waitingIn = new Map(getWaiting(venueName).map(row => [row.song_id, row.requested_at]));

    // "queued": waiting or playing in the venue's queue.
    // "cooldown": Zotify queued or boosted it in the last 2 hours but it has already left the queue
    const zotifyPickOf = (song: CachedSong) => recentlyQueued.find(queued => queued.id === song.id);
    const boostOf = (song: CachedSong) => recentlyBoosted.find(boosted => boosted.id === song.id);

    // This song's entry in the venue's queue, if it's waiting or playing
    const liveEntryOf = (song: CachedSong) =>
        liveEntries?.find(entry => isSameSong(entry, { ...song, pickId: zotifyPickOf(song)?.pickId ?? boostOf(song)?.pickId })) ?? null;

    const statusOf = (song: CachedSong, liveEntry: QueueEntry | null) => {
        if (liveEntry || waitingIn.has(song.id)) return "queued";
        if (!zotifyPickOf(song) && !boostOf(song)) return null;

        // Without the live queue we can't tell whether it's still waiting, so assume it is
        return liveEntries ? "cooldown" : "queued";
    };

    // Backfill queued songs that were saved before their details were cached
    if (recentlyQueued.some(song => !song.name)) {
        await fillQueuedDetails(venueName, songs.map(({ id, name, artist, cover }) => ({ id, name, artist, cover })))
            .catch(error => console.error("Could not backfill queued song details:", error));
    }

    // Songs that can't be requested here but can be at another of the school's venues: the first one that has it
    const availableAt = (song: CachedSong) => song.requestable ? null
        : otherVenues.find(other => otherSongs.get(other)?.some(match => match.id === song.id && match.requestable)) ?? null;

    const results = songs.map(song => {
        const liveEntry = liveEntryOf(song);

        return {
            ...song,
            availableAt: availableAt(song),
            // Lets the page boost a song someone else queued
            pickId: liveEntry?.pickId ?? null,
            queuedByZotify: liveEntry ? isFromZotify(liveEntry, recentlyQueued) : waitingIn.has(song.id) ? true : null,
            queuedAt: zotifyPickOf(song)?.queuedAt ?? waitingIn.get(song.id) ?? null,
            boostedAt: boostOf(song)?.queuedAt ?? null,
            status: statusOf(song, liveEntry)
        };
    });

    return { songs: results, cacheHit };
}

/**
 * Searches the venue and the school's other venues in parallel with their home accounts, skipping any venue with cached
 * results, and caches new results in one write
 */
async function searchAllVenues(venueName: VenueName, otherVenues: VenueName[], query: string) {
    const [current, ...others] = await Promise.all([
        searchVenue(venueName, query),
        // Other venues only add availability badges, so a failure there shouldn't fail the search
        ...otherVenues.map(other => searchVenue(other, query)
            .catch(error => (console.error(`Could not search "${query}" at ${other}:`, error), null)))
    ]);

    const results = [[venueName, current], ...otherVenues.map((other, i) => [other, others[i]])] as [VenueName, typeof current | null][];
    const fresh = Object.fromEntries(results.filter(([, result]) => result && !result.cacheHit).map(([venue, result]) => [venue, result!.songs]));

    if (Object.keys(fresh).length) {
        await cacheSearches(query, fresh).catch(error => console.error("Could not write search cache:", error));
    }

    const otherSongs = new Map(otherVenues.flatMap((other, i) => others[i] ? [[other, others[i]!.songs] as const] : []));
    return { songs: current.songs, otherSongs, cacheHit: current.cacheHit };
}

/** Returns one venue's search results from the cache if possible, otherwise from Rockbot using that venue's home account */
async function searchVenue(venueName: VenueName, query: string): Promise<{ songs: CachedSong[], cacheHit: boolean }> {
    const cached = await getCachedSearch(venueName, query)
        .catch(error => (console.error("Could not read search cache:", error), null));

    if (cached) return { songs: cached, cacheHit: true };

    // The home account stays checked in here, so searches never move it to the other venue
    const venue = rockbotVenue((await getHomeAccount(venueName)).client, venueName);

    await venue.checkIn();
    const results = await venue.search({ query });

    // Map explicitly so the client (and its tokens) never leak into the response or cache
    const songs: CachedSong[] = results.map(song => ({
        id: String(song.id),
        name: song.name,
        artist: song.artist,
        cover: song.cover?.src,
        requestable: !!song.requestable
    }));

    return { songs, cacheHit: false };
}
