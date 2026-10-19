import { findTrack } from "./trackMatch.js";
import { enqueue } from "./zotifyQueue.js";
// Finished jobs are kept for this long, so the playlist page can show how the last one went
const KEEP_FINISHED_MS = 60 * 60 * 1000;
// The latest job for each playlist at each venue. Only one runs at a time per playlist and venue
const jobs = new Map();
const jobKey = (playlistId, venue) => `${playlistId}:${venue}`;
export function getPlaylistQueueJob(playlistId, venue) {
    const job = jobs.get(jobKey(playlistId, venue));
    if (job?.finishedAt && Date.now() - job.finishedAt > KEEP_FINISHED_MS)
        return null;
    return job ?? null;
}
/** Starts queuing a playlist, or returns the job already doing it */
export function startPlaylistQueueJob(playlist, venue, email) {
    const running = getPlaylistQueueJob(playlist.id, venue);
    if (running && !running.finishedAt)
        return running;
    const job = {
        playlistId: playlist.id,
        venue,
        startedBy: email,
        startedAt: Date.now(),
        finishedAt: null,
        stoppedEarly: null,
        tracks: playlist.tracks.map(track => ({ title: track.title, artist: track.artist, outcome: "waiting" }))
    };
    jobs.set(jobKey(playlist.id, venue), job);
    runJob(job)
        .catch(error => {
        console.error(`Queuing playlist ${playlist.id} at ${venue} failed:`, error);
        job.stoppedEarly = "Something went wrong partway through.";
    })
        .finally(() => {
        for (const track of job.tracks)
            if (track.outcome === "waiting" || track.outcome === "working")
                track.outcome = "failed";
        job.finishedAt = Date.now();
    });
    return job;
}
async function runJob(job) {
    const seen = new Set();
    for (const track of job.tracks) {
        track.outcome = "working";
        await queueTrack(job.venue, track, seen, job.startedBy);
    }
}
/** Finds one track on Rockbot and adds it to Zotify's queue if it can be queued. Sets the track's outcome */
async function queueTrack(venue, track, seen, email) {
    let match;
    try {
        // Searches are cached, so tracks the playlist page already matched don't hit Rockbot again
        match = (await findTrack(venue, track)).match;
    }
    catch (error) {
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
    if (seen.has(song.id))
        return void (track.outcome = "duplicate");
    seen.add(song.id);
    if (!match.requestable)
        return void (track.outcome = "unavailable");
    if (match.status === "queued")
        return void (track.outcome = "already-queued");
    if (match.status === "cooldown")
        return void (track.outcome = "played-recently");
    // Into Zotify's queue, behind anything already waiting. It goes into Rockbot's queue when there's room
    enqueue(venue, song, email);
    track.outcome = "queued";
}
//# sourceMappingURL=playlistQueue.js.map