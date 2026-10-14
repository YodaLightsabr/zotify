import { cache } from "./cache.js";
export const QUEUED_WINDOW_MS = 2 * 60 * 60 * 1000;
async function readLog(key = "queued") {
    return (await cache.get([key])) ?? {};
}
function normalize(id, entry) {
    return typeof entry === "number" ? { id, name: "", artist: "", queuedAt: entry } : entry;
}
/** Returns songs queued at this venue within the last 2 hours, newest first */
export async function getRecentlyQueued(venue, key = "queued") {
    const cutoff = Date.now() - QUEUED_WINDOW_MS;
    return Object.entries((await readLog(key))[venue] ?? {})
        .map(([id, entry]) => normalize(id, entry))
        .filter(song => song.queuedAt >= cutoff)
        .sort((a, b) => b.queuedAt - a.queuedAt);
}
export async function markQueued(venue, song, queuedAt = Date.now(), key = "queued") {
    const log = await readLog(key);
    const cutoff = Date.now() - QUEUED_WINDOW_MS;
    // Drop expired entries so the cache doesn't grow forever
    for (const [venueName, songs] of Object.entries(log)) {
        log[venueName] = Object.fromEntries(Object.entries(songs).filter(([id, entry]) => normalize(id, entry).queuedAt >= cutoff));
    }
    log[venue] = { ...log[venue], [song.id]: { ...song, queuedAt } };
    await cache.set([key], log);
    return queuedAt;
}
/** Songs others queued that Zotify boosted at this venue within the last 2 hours, newest first. queuedAt is when it was boosted */
export function getRecentlyBoosted(venue) {
    return getRecentlyQueued(venue, "boosted");
}
export function markBoosted(venue, song, boostedAt = Date.now()) {
    return markQueued(venue, song, boostedAt, "boosted");
}
/** Fills in details for queued songs that were saved without them, using songs from search results */
export async function fillQueuedDetails(venue, songs) {
    const log = await readLog();
    const entries = log[venue];
    if (!entries)
        return;
    let changed = false;
    for (const song of songs) {
        const entry = entries[song.id];
        if (entry === undefined)
            continue;
        const existing = normalize(song.id, entry);
        if (existing.name)
            continue;
        entries[song.id] = { ...song, cover: song.cover ?? existing.cover, queuedAt: existing.queuedAt };
        changed = true;
    }
    if (changed)
        await cache.set(["queued"], log);
}
//# sourceMappingURL=queued.js.map