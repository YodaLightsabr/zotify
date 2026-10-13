import { getHomeAccount, type VenueName } from "./accounts.js";
import type { QueueEntry, VenueQueue } from "./client.js";
import type { QueuedSong } from "./queued.js";

// Rockbot's app reloads this screen every 20 seconds, so reuse a fetch for a little less than that
const CACHE_MS = 15_000;
const recentFetches = new Map<VenueName, { queue: Promise<VenueQueue>, fetchedAt: number }>();

async function fetchVenueQueue(venueName: VenueName): Promise<VenueQueue> {
    const venue = (await getHomeAccount(venueName)).client[venueName];

    await venue.checkIn();
    return await venue.fetchQueue();
}

export function isEmptyQueue(queue: VenueQueue) {
    return !queue.nowPlaying && !queue.onDeck.length && !queue.comingUp.length;
}

/** Shares one Rockbot request between everyone loading the same venue within CACHE_MS */
export function getVenueQueue(venueName: VenueName) {
    const cached = recentFetches.get(venueName);

    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached;

    const entry = { queue: fetchVenueQueue(venueName), fetchedAt: Date.now() };
    recentFetches.set(venueName, entry);

    // Don't keep serving a failed fetch or an empty queue, since an empty one is more likely a bad response than a silent venue
    const forget = () => {
        if (recentFetches.get(venueName) === entry) recentFetches.delete(venueName);
    };
    entry.queue.then(queue => { if (isEmptyQueue(queue)) forget(); }, forget);

    return entry;
}

const normalize = (text: string) => text.trim().toLowerCase();

/** Whether a queue entry is this song. Entries only carry a song ID while playing, so fall back to the pick ID we saved, then name and artist */
export function isSameSong(entry: QueueEntry, song: { id?: string, name: string, artist: string, pickId?: string }) {
    if (song.pickId && song.pickId === entry.pickId) return true;
    if (song.id && entry.songId) return song.id === entry.songId;

    return !!song.name && normalize(song.name) === normalize(entry.name) && normalize(song.artist) === normalize(entry.artist);
}

export function queueEntries(queue: VenueQueue): QueueEntry[] {
    return [...(queue.nowPlaying ? [queue.nowPlaying] : []), ...queue.onDeck, ...queue.comingUp];
}

/** Whether Zotify queued this entry, using the pick ID saved when it was queued */
export function isFromZotify(entry: QueueEntry, queued: QueuedSong[]) {
    return queued.some(song =>
        song.pickId
            ? song.pickId === entry.pickId
            // Older entries didn't save a pick ID, so fall back to matching the song itself
            : isSameSong(entry, song)
    );
}
