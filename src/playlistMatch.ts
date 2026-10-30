import type { VenueName } from "./accounts.js";
import { events } from "./events.js";
import type { StoredPlaylist } from "./playlists.js";
import { findTrack } from "./trackMatch.js";

// Finds every track of a playlist on Rockbot at a venue, in the background, so a page or app can show what's there before
// anyone requests anything. A big playlist takes longer than one request should (searches go to Rockbot), so like "queue
// all" (playlistQueue.ts) it's a job to start and check on. Searches are cached, so queuing the playlist afterwards is quick

type Match = NonNullable<Awaited<ReturnType<typeof findTrack>>["match"]>;

export interface TrackMatch {
    title: string;
    artist: string;
    uri?: string;
    state: "waiting" | "done" | "failed";
    // The Rockbot song, with its queue status and whether it can be requested here; null when Rockbot doesn't have it
    match: Match | null;
    // An earlier track in the playlist matched the same song
    duplicate: boolean;
}

export interface PlaylistMatchJob {
    playlistId: string;
    venue: VenueName;
    startedAt: number;
    finishedAt: number | null;
    tracks: TrackMatch[];
}

// Searches at once, to go easy on Rockbot (the website's playlist page used to do the same from the browser)
const CONCURRENCY = 4;
// A finished job is kept this long, so leaving and coming back doesn't search again
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const jobs = new Map<string, PlaylistMatchJob>();
const jobKey = (playlistId: string, venue: VenueName) => `${playlistId}:${venue}`;

export function getPlaylistMatchJob(playlistId: string, venue: VenueName) {
    const job = jobs.get(jobKey(playlistId, venue));
    if (job?.finishedAt && Date.now() - job.finishedAt > KEEP_FINISHED_MS) {
        jobs.delete(jobKey(playlistId, venue));
        return null;
    }
    return job ?? null;
}

/** Starts matching a playlist's tracks, or returns the job already doing it. fresh starts over even if a recent one finished */
export function startPlaylistMatchJob(playlist: StoredPlaylist, venue: VenueName, fresh = false) {
    const existing = getPlaylistMatchJob(playlist.id, venue);
    if (existing && (!existing.finishedAt || !fresh)) return existing;

    const job: PlaylistMatchJob = {
        playlistId: playlist.id,
        venue,
        startedAt: Date.now(),
        finishedAt: null,
        tracks: playlist.tracks.map(track => ({ title: track.title, artist: track.artist, uri: track.uri, state: "waiting", match: null, duplicate: false }))
    };

    jobs.set(jobKey(playlist.id, venue), job);
    runJob(job)
        .catch(error => console.error(`Matching playlist ${playlist.id} at ${venue} failed:`, error))
        .finally(() => {
            for (const track of job.tracks) if (track.state === "waiting") track.state = "failed";

            // Later tracks that matched the same song as an earlier one
            const seen = new Set<string>();
            for (const track of job.tracks) {
                if (!track.match) continue;
                track.duplicate = seen.has(track.match.id);
                seen.add(track.match.id);
            }

            job.finishedAt = Date.now();
            events.emit("playlistMatched", job);
        });

    return job;
}

async function runJob(job: PlaylistMatchJob) {
    let next = 0;

    const worker = async () => {
        while (next < job.tracks.length) {
            const track = job.tracks[next++];
            try {
                track.match = (await findTrack(job.venue, track)).match;
                track.state = "done";
            } catch (error) {
                console.error(`Could not search for "${track.title}" by ${track.artist} at ${job.venue}:`, error);
                track.state = "failed";
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, job.tracks.length) }, worker));
}
