import { cache } from "./cache.js";

export const QUEUED_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface QueuedSong {
    id: string;
    // Rockbot's ID for this request, used to spot it in the venue's queue
    pickId?: string;
    name: string;
    artist: string;
    cover?: string;
    queuedAt: number;
}

// Older entries were stored as a bare timestamp
type QueuedLog = Record<string, Record<string, QueuedSong | number>>;

// Songs Zotify queued live under "queued"; songs others queued that Zotify boosted live under "boosted", with queuedAt meaning when they were boosted
type LogKey = "queued" | "boosted";

async function readLog(key: LogKey = "queued"): Promise<QueuedLog> {
    return (await cache.get([key])) ?? {};
}

function normalize(id: string, entry: QueuedSong | number): QueuedSong {
    return typeof entry === "number" ? { id, name: "", artist: "", queuedAt: entry } : entry;
}

/** Returns songs queued at this venue within the last 2 hours, newest first */
export async function getRecentlyQueued(venue: string, key: LogKey = "queued"): Promise<QueuedSong[]> {
    const cutoff = Date.now() - QUEUED_WINDOW_MS;

    return Object.entries((await readLog(key))[venue] ?? {})
        .map(([id, entry]) => normalize(id, entry))
        .filter(song => song.queuedAt >= cutoff)
        .sort((a, b) => b.queuedAt - a.queuedAt);
}

export async function markQueued(venue: string, song: Omit<QueuedSong, "queuedAt">, queuedAt = Date.now(), key: LogKey = "queued") {
    const log = await readLog(key);
    const cutoff = Date.now() - QUEUED_WINDOW_MS;

    // Drop expired entries so the cache doesn't grow forever
    for (const [venueName, songs] of Object.entries(log)) {
        log[venueName] = Object.fromEntries(
            Object.entries(songs).filter(([id, entry]) => normalize(id, entry).queuedAt >= cutoff)
        );
    }

    log[venue] = { ...log[venue], [song.id]: { ...song, queuedAt } };

    await cache.set([key], log);

    return queuedAt;
}

/** Songs others queued that Zotify boosted at this venue within the last 2 hours, newest first. queuedAt is when it was boosted */
export function getRecentlyBoosted(venue: string) {
    return getRecentlyQueued(venue, "boosted");
}

export function markBoosted(venue: string, song: Omit<QueuedSong, "queuedAt">, boostedAt = Date.now()) {
    return markQueued(venue, song, boostedAt, "boosted");
}

/** Fills in details for queued songs that were saved without them, using songs from search results */
export async function fillQueuedDetails(venue: string, songs: Omit<QueuedSong, "queuedAt">[]) {
    const log = await readLog();
    const entries = log[venue];
    if (!entries) return;

    let changed = false;

    for (const song of songs) {
        const entry = entries[song.id];
        if (entry === undefined) continue;

        const existing = normalize(song.id, entry);
        if (existing.name) continue;

        entries[song.id] = { ...song, cover: song.cover ?? existing.cover, queuedAt: existing.queuedAt };
        changed = true;
    }

    if (changed) await cache.set(["queued"], log);
}
