import { db } from "./db.js";
import type { StoredPlaylist } from "./playlists.js";
import { lookupAccount, playlistCover, SpotifyApiError, trackArt } from "./spotifyApi.js";

// Playlist covers and album art from Spotify's API, looked up as the site admin whose Spotify is connected (lookupAccount),
// since Spotify's Development Mode won't let everyone connect their own. Covers also come from Spotify's embed when a playlist
// is read (spotify.ts), which covers Spotify's own playlists that its API won't show apps in Development Mode. Album art is kept by Spotify track, so it outlasts
// a playlist's tracks being read again, and each track is only looked up once. Without a connected site admin, playlists
// just go without

// Lookups at once, to go easy on Spotify
const CONCURRENCY = 5;
// Album art looked up per pass; longer playlists get the rest the next time they're opened
const MAX_TRACKS_PER_PASS = 250;
// How often a playlist's cover is looked up again, in case it changed
const COVER_TTL_MS = 24 * 60 * 60 * 1000;

const selectCoverCheck = db.prepare("SELECT image_checked_at FROM playlists WHERE id = ?");
// The embed's cover stays when the API has none
const saveCover = db.prepare("UPDATE playlists SET image = COALESCE(?, image), image_checked_at = ? WHERE id = ?");
const selectMissingArt = db.prepare(`
    SELECT DISTINCT playlist_tracks.uri FROM playlist_tracks
    LEFT JOIN spotify_art ON spotify_art.uri = playlist_tracks.uri
    WHERE playlist_tracks.playlist_id = ? AND playlist_tracks.uri LIKE 'spotify:track:%' AND spotify_art.uri IS NULL
    ORDER BY playlist_tracks.position LIMIT ?
`);
const saveArt = db.prepare("INSERT OR REPLACE INTO spotify_art (uri, image, fetched_at) VALUES (?, ?, ?)");

// Playlists being looked up now, so opening one twice doesn't look everything up twice
const running = new Map<string, Promise<void>>();

/** Looks up a playlist's cover and its tracks' album art, if it's missing. Never throws */
export function addArt(playlist: StoredPlaylist) {
    const existing = running.get(playlist.id);
    if (existing) return existing;

    const job = lookUp(playlist.id)
        .catch(error => console.error(`Could not look up art for playlist ${playlist.id}:`, error))
        .finally(() => running.delete(playlist.id));

    running.set(playlist.id, job);
    return job;
}

/** addArt, waiting at most ms for it, so pages can show what's ready while the rest carries on */
export async function addArtWithin(playlist: StoredPlaylist, ms: number) {
    await Promise.race([addArt(playlist), new Promise(resolve => setTimeout(resolve, ms))]);
}

async function lookUp(playlistId: string) {
    const email = lookupAccount();
    if (!email) return;

    const checkedAt = (selectCoverCheck.get(playlistId) as { image_checked_at: number | null } | undefined)?.image_checked_at ?? 0;

    if (Date.now() - checkedAt > COVER_TTL_MS) {
        try {
            saveCover.run(await playlistCover(email, playlistId), Date.now(), playlistId);
        } catch (error) {
            // Private playlists that aren't the admin's have no cover to share
            if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) saveCover.run(null, Date.now(), playlistId);
            else throw error;
        }
    }

    const uris = (selectMissingArt.all(playlistId, MAX_TRACKS_PER_PASS) as { uri: string }[]).map(row => row.uri);
    let next = 0;
    let stopped = false;

    const worker = async () => {
        while (next < uris.length && !stopped) {
            const uri = uris[next++];

            try {
                saveArt.run(uri, await trackArt(email, uri.slice("spotify:track:".length)), Date.now());
            } catch (error) {
                // A track Spotify doesn't have anymore has no art; anything else (like the admin's connection ending) stops this pass
                if (error instanceof SpotifyApiError && (error.status === 404 || error.status === 400)) saveArt.run(uri, null, Date.now());
                else {
                    stopped = true;
                    throw error;
                }
            }
        }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uris.length) }, worker));
}
