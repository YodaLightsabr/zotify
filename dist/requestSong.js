import { getAccountsForVenue } from "./accounts.js";
import { recordPick } from "./history.js";
import { QueueSong } from "./playbook.js";
import { markQueued } from "./queued.js";
export class NoAccountsError extends Error {
    constructor() {
        super("No accounts available");
        this.name = "NoAccountsError";
    }
}
/**
 * Requests a song at a venue with one of our accounts, then records it as queued (for badges and cooldowns) and in the pick history.
 * Rockbot's errors are thrown as they are, e.g. RepeatLimitReachedError when it was played too recently
 */
export async function requestSong(venueName, song, requestedBy) {
    // Excludes the other venue's home account so it stays checked in there; QueueSong also votes with only these
    const accounts = await getAccountsForVenue(venueName);
    if (!accounts.length)
        throw new NoAccountsError();
    const pick = await new QueueSong(accounts, { song, venue: venueName }).run();
    const details = {
        id: song.id,
        pickId: String(pick.id),
        name: song.name,
        artist: song.artist,
        // Only keep real image URLs since this gets rendered back on the page
        cover: song.cover?.startsWith("https://") ? song.cover : undefined
    };
    // The song is already queued at this point, so a cache failure shouldn't fail the request
    const queuedAt = await markQueued(venueName, details).catch(error => {
        console.error(`Could not record queue time for "${song.name}":`, error);
        return Date.now();
    });
    await recordPick({
        pickId: details.pickId,
        songId: details.id,
        name: details.name,
        artist: details.artist,
        ...(details.cover ? { cover: details.cover } : {}),
        venue: venueName,
        requestedAt: queuedAt,
        requestedBy
    }).catch(error => console.error(`Could not add "${song.name}" to the pick history:`, error));
    return { pickId: details.pickId, queuedAt };
}
//# sourceMappingURL=requestSong.js.map