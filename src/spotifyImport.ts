import type { VenueName } from "./accounts.js";
import { saveLikedSongs, saveMatches, savePlaylistToLibrary } from "./library.js";
import { startPlaylistMatchJob } from "./playlistMatch.js";
import { getPlaylist, savePlaylist } from "./playlists.js";
import { fetchPlaylist, SpotifyPlaylistUnavailableError } from "./spotify.js";
import { fetchPlaylistAs, getLikedSongs } from "./spotifyApi.js";
import { findTrack } from "./trackMatch.js";

// Importing someone's Spotify library into their Zotify Library, in the background: the playlists they pick, each saved to
// their Library like "Save to Library" does, and their liked songs. Every track is looked for on Rockbot at one venue, and the
// ones Rockbot has are saved, whether or not they can be requested there. Like the other jobs, it lives in memory, one per person

// Rockbot is searched for every liked song, so only the most recent are imported
export const MAX_LIKED = 500;
// Searches at once, to go easy on Rockbot, like playlistMatch.ts
const CONCURRENCY = 4;
// A finished import is kept this long, so the page can show how it went
const KEEP_FINISHED_MS = 60 * 60 * 1000;

export interface ImportItem {
    kind: "liked" | "playlist";
    // The Spotify playlist's ID, for playlists
    id: string | null;
    name: string;
    state: "waiting" | "reading" | "finding" | "done" | "failed";
    // How many tracks it has, how many have been looked for on Rockbot, and how many Rockbot had
    tracks: number;
    done: number;
    found: number;
    error: string | null;
}

export interface SpotifyImport {
    venue: VenueName;
    startedAt: number;
    finishedAt: number | null;
    items: ImportItem[];
}

const jobs = new Map<string, SpotifyImport>();

export function getImport(email: string) {
    const job = jobs.get(email);
    if (job?.finishedAt && Date.now() - job.finishedAt > KEEP_FINISHED_MS) {
        jobs.delete(email);
        return null;
    }
    return job ?? null;
}

/** Starts importing. Throws if one is already running for them */
export function startImport(email: string, venue: VenueName, choices: { liked: boolean, playlists: { id: string, name: string }[] }) {
    const running = getImport(email);
    if (running && !running.finishedAt) throw new Error("An import is already running.");

    const item = (kind: ImportItem["kind"], id: string | null, name: string): ImportItem =>
        ({ kind, id, name, state: "waiting", tracks: 0, done: 0, found: 0, error: null });

    const job: SpotifyImport = {
        venue,
        startedAt: Date.now(),
        finishedAt: null,
        items: [
            ...(choices.liked ? [item("liked", null, "Liked songs")] : []),
            ...choices.playlists.map(playlist => item("playlist", playlist.id, playlist.name))
        ]
    };

    jobs.set(email, job);
    run(email, job)
        .catch(error => console.error(`Importing ${email}'s Spotify library failed:`, error))
        .finally(() => {
            for (const entry of job.items) if (entry.state !== "done" && entry.state !== "failed") Object.assign(entry, { state: "failed", error: "Stopped early" });
            job.finishedAt = Date.now();
            console.log(`Imported ${email}'s Spotify library: ${job.items.map(entry => `${entry.name} ${entry.found}/${entry.tracks}`).join(", ")}`);
        });

    return job;
}

async function run(email: string, job: SpotifyImport) {
    for (const item of job.items) {
        try {
            if (item.kind === "liked") await importLiked(email, job.venue, item);
            else await importPlaylist(email, job.venue, item);
            item.state = "done";
        } catch (error) {
            console.error(`Could not import ${item.name} for ${email}:`, error);
            item.state = "failed";
            item.error = error instanceof SpotifyPlaylistUnavailableError ? "Spotify wouldn't share it" : "Something went wrong";
        }
    }
}

async function importLiked(email: string, venue: VenueName, item: ImportItem) {
    item.state = "reading";
    const tracks = await getLikedSongs(email, MAX_LIKED);
    item.tracks = tracks.length;
    item.state = "finding";

    const found: (string | null)[] = tracks.map(() => null);
    let next = 0;

    const worker = async () => {
        while (next < tracks.length) {
            const i = next++;
            try {
                found[i] = (await findTrack(venue, tracks[i])).match?.id ?? null;
            } catch (error) {
                console.error(`Could not search for "${tracks[i].title}" by ${tracks[i].artist} at ${venue}:`, error);
            }
            item.done++;
            if (found[i]) item.found++;
        }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker));
    saveLikedSongs(email, found.filter((id): id is string => !!id));
}

async function importPlaylist(email: string, venue: VenueName, item: ImportItem) {
    const id = item.id!;
    item.state = "reading";

    // Their own playlists come through their Spotify, private ones included; others only if they're public
    try {
        const playlist = await fetchPlaylistAs(email, id);
        savePlaylist(playlist, email, playlist.private);
    } catch (error) {
        if (!(error instanceof SpotifyPlaylistUnavailableError)) throw error;
        savePlaylist(await fetchPlaylist(id), email);
    }

    const saved = getPlaylist(id)!;
    item.name = saved.name;
    item.tracks = saved.tracks.length;
    savePlaylistToLibrary(email, id);

    // The same job the playlist page's "Save to Library" starts, followed until it's done
    item.state = "finding";
    const match = startPlaylistMatchJob(saved, venue);

    while (!match.finishedAt) {
        item.done = match.tracks.filter(track => track.state !== "waiting").length;
        item.found = match.tracks.filter(track => track.match && !track.duplicate).length;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    item.done = match.tracks.length;
    item.found = new Set(match.tracks.flatMap(track => track.match ? [track.match.id] : [])).size;
    // Saving the playlist already saves what the job finds, but a job that had finished before doesn't announce itself again
    saveMatches(match, email);
}
