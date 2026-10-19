import type { VenueName } from "./accounts.js";
import { RockbotClient } from "./client.js";
import { db } from "./db.js";
import { events } from "./events.js";
import { getRecentlyQueued } from "./queued.js";
import { NoAccountsError, requestSong, type RequestedSong } from "./requestSong.js";
import { getVenueQueue, isFromZotify, queueEntries } from "./venueQueue.js";
import { castVotes, markVoted } from "./votes.js";

// Zotify's own queue. Every song people queue waits here first, in order, and is only requested on Rockbot once fewer than
// MAX_IN_ROCKBOT of Zotify's songs are waiting there. live.ts runs processSoon after each poll of Rockbot's queue. Keeping only a few in Rockbot at once keeps cooldowns short and
// keeps Zotify's songs in the order people asked for them.

export const MAX_IN_ROCKBOT = 3;
// The first try plus two retries
const MAX_ATTEMPTS = 3;
// How long to wait before each retry. The song at the front holds its place meanwhile, so order is kept
const RETRY_DELAYS_MS = [30_000, 60_000];
// Songs we just requested may not show in Rockbot's queue straight away, so count them as waiting there for this long
const UNSEEN_PICK_MS = 2 * 60_000;
// Failures are shown on the homepage for this long
const SHOW_FAILURES_MS = 2 * 60 * 60_000;

interface QueueRow {
    id: number;
    venue: VenueName;
    song_id: string;
    name: string;
    artist: string;
    cover: string | null;
    requested_by: string | null;
    requested_at: number;
    status: "waiting" | "released" | "failed";
    attempts: number;
    last_error: string | null;
    next_attempt_at: number | null;
    pick_id: string | null;
    released_at: number | null;
    failed_at: number | null;
}

const insert = db.prepare("INSERT INTO zotify_queue (venue, song_id, name, artist, cover, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const selectWaiting = db.prepare("SELECT * FROM zotify_queue WHERE venue = ? AND status = 'waiting' ORDER BY id");
const selectWaitingSong = db.prepare("SELECT * FROM zotify_queue WHERE venue = ? AND status = 'waiting' AND song_id = ?");
const selectRecentReleases = db.prepare("SELECT pick_id FROM zotify_queue WHERE venue = ? AND status = 'released' AND released_at > ?");
const selectFailures = db.prepare("SELECT * FROM zotify_queue WHERE venue = ? AND status = 'failed' AND failed_at > ? ORDER BY failed_at DESC");
const markReleased = db.prepare("UPDATE zotify_queue SET status = 'released', pick_id = ?, released_at = ?, attempts = attempts + 1 WHERE id = ?");
const markRetry = db.prepare("UPDATE zotify_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?");
const markFailed = db.prepare("UPDATE zotify_queue SET status = 'failed', attempts = ?, last_error = ?, failed_at = ? WHERE id = ?");

/** Songs waiting in Zotify's queue at a venue, front first */
export function getWaiting(venue: VenueName) {
    return selectWaiting.all(venue) as unknown as QueueRow[];
}

/** Songs that couldn't be put into Rockbot's queue even after retrying, newest first */
export function getFailures(venue: VenueName) {
    return selectFailures.all(venue, Date.now() - SHOW_FAILURES_MS) as unknown as QueueRow[];
}

/** Adds a song to the back of Zotify's queue, unless it's already waiting there. Returns its place in line, starting at 1 */
export function enqueue(venue: VenueName, song: RequestedSong, requestedBy?: string) {
    const existing = selectWaitingSong.get(venue, song.id) as QueueRow | undefined;

    if (!existing) {
        // Only keep real image URLs since this gets rendered back on the page
        const cover = song.cover?.startsWith("https://") ? song.cover : null;
        insert.run(venue, song.id, song.name, song.artist, cover, requestedBy ?? null, Date.now());
    }

    const waiting = getWaiting(venue);
    const entry = waiting.find(row => row.song_id === song.id)!;

    // The queue changed, so see whether it can go into Rockbot right away
    if (!existing) events.emit("zotifyQueueChanged", venue);
    processSoon(venue);

    return { requestedAt: entry.requested_at, position: waiting.indexOf(entry) + 1, alreadyWaiting: !!existing };
}

// Picks we requested that have since shown up in Rockbot's queue. Once seen, a pick that's gone has played or been removed
const seenPicks = new Set<string>();

/**
 * How many of Zotify's songs are waiting in Rockbot's queue (not counting the one playing). Uses the live poller's latest fetch
 * when it's recent, so this doesn't add requests to Rockbot; picks Rockbot isn't showing yet are counted separately below
 */
async function zotifySongsInRockbot(venue: VenueName) {
    const [queue, queued] = await Promise.all([getVenueQueue(venue).queue, getRecentlyQueued(venue)]);
    const waiting = [...queue.onDeck, ...queue.comingUp].filter(entry => isFromZotify(entry, queued)).length;

    // Picks we requested moments ago that Rockbot isn't showing yet
    const shown = new Set(queueEntries(queue).map(entry => entry.pickId));
    const recent = (selectRecentReleases.all(venue, Date.now() - UNSEEN_PICK_MS) as { pick_id: string }[]).map(row => row.pick_id);
    for (const pickId of recent) if (shown.has(pickId)) seenPicks.add(pickId);
    const unseen = recent.filter(pickId => !seenPicks.has(pickId)).length;

    // Forget picks too old to matter
    for (const pickId of seenPicks) if (!recent.includes(pickId)) seenPicks.delete(pickId);

    return waiting + unseen;
}

function describeError(error: unknown) {
    if (error instanceof RockbotClient.Errors.RepeatLimitReachedError) return "Rockbot says it was played too recently.";
    if (error instanceof RockbotClient.Errors.PickLimitReachedError) return "Every account has hit its pick limit.";
    if (error instanceof NoAccountsError) return "No accounts were available.";
    return error instanceof Error && error.message ? error.message : "Rockbot wouldn't take the request.";
}

/** Requests one waiting song on Rockbot, then upvotes it with every account in the background */
async function release(row: QueueRow) {
    const song = { id: row.song_id, name: row.name, artist: row.artist, ...(row.cover ? { cover: row.cover } : {}) };
    const { pickId } = await requestSong(row.venue, song, row.requested_by ?? undefined);

    markReleased.run(pickId, Date.now(), row.id);
    events.emit("zotifyQueueChanged", row.venue);
    events.emit("venueChanged", row.venue);

    // Mark first so the periodic top-up doesn't vote on it at the same time. The song is in Rockbot's queue whatever happens here
    markVoted(row.venue, pickId);
    castVotes(row.venue, pickId, song).catch(error => console.error(`Could not vote for "${song.name}" from Zotify's queue:`, error));
}

/** Moves songs from the front of Zotify's queue into Rockbot's while there's room, in order */
async function processVenue(venue: VenueName) {
    const waiting = getWaiting(venue);
    if (!waiting.length) return;

    // The front song is waiting to be retried, and nothing behind it goes first
    if (waiting[0].next_attempt_at && waiting[0].next_attempt_at > Date.now()) return;

    let room = MAX_IN_ROCKBOT - await zotifySongsInRockbot(venue);

    for (const row of waiting) {
        if (room <= 0) break;
        if (row.next_attempt_at && row.next_attempt_at > Date.now()) break;

        try {
            await release(row);
            room--;
        } catch (error) {
            const attempts = row.attempts + 1;
            const reason = describeError(error);
            // Retrying can't help with a repeat limit, so that fails straight away
            const giveUp = attempts >= MAX_ATTEMPTS || error instanceof RockbotClient.Errors.RepeatLimitReachedError;

            if (giveUp) {
                console.error(`Giving up on "${row.name}" from Zotify's queue at ${venue} after ${attempts} attempt(s):`, error);
                markFailed.run(attempts, reason, Date.now(), row.id);
                events.emit("zotifyQueueChanged", venue);
                // The next song can take its place
                continue;
            }

            console.warn(`Couldn't put "${row.name}" into Rockbot's queue at ${venue} (attempt ${attempts}), retrying:`, error);
            markRetry.run(attempts, reason, Date.now() + RETRY_DELAYS_MS[attempts - 1], row.id);
            break;
        }
    }
}

// One run at a time per venue. A request for another run while one is going makes it go round again afterwards
const running = new Set<VenueName>();
const again = new Set<VenueName>();

/** Checks the venue's queues in the background */
export function processSoon(venue: VenueName) {
    if (running.has(venue)) {
        again.add(venue);
        return;
    }

    running.add(venue);

    (async () => {
        do {
            again.delete(venue);
            await processVenue(venue).catch(error => console.error(`Error moving Zotify's queue into Rockbot at ${venue}:`, error));
        } while (again.has(venue));
    })().finally(() => running.delete(venue));
}

/** What a signed-in person sees of Zotify's queue at a venue. Who asked for each song is left out, apart from whether it was them */
export function describeZotifyQueue(venue: VenueName, email: string | null) {
    const song = (row: QueueRow) => ({
        id: row.id,
        songId: row.song_id,
        name: row.name,
        artist: row.artist,
        ...(row.cover ? { cover: row.cover } : {}),
        requestedAt: row.requested_at,
        mine: !!email && row.requested_by === email
    });

    return {
        waiting: getWaiting(venue).map(song),
        failures: getFailures(venue).map(row => ({ ...song(row), failedAt: row.failed_at, attempts: row.attempts, error: row.last_error }))
    };
}
