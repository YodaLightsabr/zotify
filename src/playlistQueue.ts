import type { VenueName } from "./accounts.js";
import { events } from "./events.js";
import type { StoredPlaylist } from "./playlists.js";
import { findTrack } from "./trackMatch.js";
import { enqueue } from "./zotifyQueue.js";

// Queues a whole playlist at a venue in the background, in playlist order, like pressing Queue on each.
// Each track is looked up on Rockbot and added to Zotify's queue; tracks that can't be queued are skipped with a reason

export type TrackOutcome =
    | "waiting"
    | "working"
    // Added to Zotify's queue
    | "queued"
    // Rockbot has no match for it
    | "not-found"
    // On Rockbot, but not requestable at this venue
    | "unavailable"
    // Already waiting in the venue's queue
    | "already-queued"
    // Rockbot's repeat limit, or Zotify queued it in the last two hours
    | "played-recently"
    // Another track in the playlist matched the same song
    | "duplicate"
    | "failed";

export interface TrackResult {
    title: string;
    artist: string;
    outcome: TrackOutcome;
    // The Rockbot song it matched
    song?: { id: string, name: string, artist: string, cover?: string };
    error?: string;
}

export interface PlaylistQueueJob {
    playlistId: string;
    venue: VenueName;
    startedBy: string;
    startedAt: number;
    finishedAt: number | null;
    // Why it stopped early, if it did
    stoppedEarly: string | null;
    tracks: TrackResult[];
}

// Finished jobs are kept for this long, so the playlist page can show how the last one went
const KEEP_FINISHED_MS = 60 * 60 * 1000;

// The latest job for each playlist at each venue. Only one runs at a time per playlist and venue
const jobs = new Map<string, PlaylistQueueJob>();
const jobKey = (playlistId: string, venue: VenueName) => `${playlistId}:${venue}`;

export function getPlaylistQueueJob(playlistId: string, venue: VenueName) {
    const job = jobs.get(jobKey(playlistId, venue));
    if (job?.finishedAt && Date.now() - job.finishedAt > KEEP_FINISHED_MS) return null;
    return job ?? null;
}

/** Starts queuing a playlist, or returns the job already doing it */
export function startPlaylistQueueJob(playlist: StoredPlaylist, venue: VenueName, email: string) {
    const running = getPlaylistQueueJob(playlist.id, venue);
    if (running && !running.finishedAt) return running;

    const job: PlaylistQueueJob = {
        playlistId: playlist.id,
        venue,
        startedBy: email,
        startedAt: Date.now(),
        finishedAt: null,
        stoppedEarly: null,
        tracks: playlist.tracks.map(track => ({ title: track.title, artist: track.artist, outcome: "waiting" }))
    };

    jobs.set(jobKey(playlist.id, venue), job);
    events.emit("playlistJobChanged", job);

    runJob(job)
        .catch(error => {
            console.error(`Queuing playlist ${playlist.id} at ${venue} failed:`, error);
            job.stoppedEarly = "Something went wrong partway through.";
        })
        .finally(() => {
            for (const track of job.tracks) if (track.outcome === "waiting" || track.outcome === "working") track.outcome = "failed";
            job.finishedAt = Date.now();
            events.emit("playlistJobChanged", job);
        });

    return job;
}

async function runJob(job: PlaylistQueueJob) {
    const seen = new Set<string>();

    for (const track of job.tracks) {
        track.outcome = "working";
        await queueTrack(job.venue, track, seen, job.startedBy);
        events.emit("playlistJobChanged", job);
    }
}

/** Finds one track on Rockbot and adds it to Zotify's queue if it can be queued. Sets the track's outcome */
async function queueTrack(venue: VenueName, track: TrackResult, seen: Set<string>, email: string) {
    let match;

    try {
        // Searches are cached, so tracks the playlist page already matched don't hit Rockbot again
        match = (await findTrack(venue, track)).match;
    } catch (error) {
        console.error(`Could not search for "${track.title}" by ${track.artist} at ${venue}:`, error);
        track.outcome = "failed";
        track.error = "The search failed.";
        return;
    }

    if (!match) {
        track.outcome = "not-found";
        return;
    }

    const song = { id: match.id, name: match.name, artist: match.artist, ...(match.cover ? { cover: match.cover } : {}) };
    track.song = song;

    if (seen.has(song.id)) return void (track.outcome = "duplicate");
    seen.add(song.id);

    if (!match.requestable) return void (track.outcome = "unavailable");
    if (match.status === "queued") return void (track.outcome = "already-queued");
    if (match.status === "cooldown") return void (track.outcome = "played-recently");

    // Into Zotify's queue, behind anything already waiting. It goes into Rockbot's queue when there's room
    enqueue(venue, song, email);
    track.outcome = "queued";
}
