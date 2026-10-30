import { db, transaction } from "./db.js";
import type { SpotifyPlaylist, SpotifyTrack } from "./spotify.js";

// Spotify playlists people have pasted, with their tracks, and who has opened each one. Private ones (read through someone's
// own Spotify) can only be opened by people who added them, so a link to one doesn't show its tracks to anyone else

export interface StoredPlaylist {
    id: string;
    name: string;
    owner?: string;
    mayBeTruncated: boolean;
    private: boolean;
    // Its cover from Spotify, if one's been looked up (see spotifyArt.ts)
    image?: string;
    // When the tracks were last read from Spotify
    fetchedAt: number;
    // Tracks have their album art, once it's been looked up
    tracks: (SpotifyTrack & { image?: string })[];
}

interface PlaylistRow { id: string, name: string, owner: string | null, may_be_truncated: number, private: number, image: string | null, fetched_at: number }
interface TrackRow { title: string, artist: string, duration_ms: number | null, uri: string | null, image: string | null }

const upsertPlaylist = db.prepare(`
    INSERT INTO playlists (id, name, owner, may_be_truncated, private, image, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, owner = excluded.owner, may_be_truncated = excluded.may_be_truncated,
        private = excluded.private, image = COALESCE(excluded.image, playlists.image), fetched_at = excluded.fetched_at
`);
const deleteTracks = db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?");
const insertTrack = db.prepare("INSERT INTO playlist_tracks (playlist_id, position, title, artist, duration_ms, uri) VALUES (?, ?, ?, ?, ?, ?)");
// Keeps when they first added it, and updates when they last opened it
const linkUser = db.prepare(`
    INSERT INTO user_playlists (email, playlist_id, added_at, opened_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (email, playlist_id) DO UPDATE SET opened_at = excluded.opened_at
`);
const selectPlaylist = db.prepare("SELECT * FROM playlists WHERE id = ?");
const selectLink = db.prepare("SELECT 1 FROM user_playlists WHERE email = ? AND playlist_id = ?");
const selectTracks = db.prepare(`
    SELECT playlist_tracks.title, playlist_tracks.artist, playlist_tracks.duration_ms, playlist_tracks.uri, spotify_art.image
    FROM playlist_tracks LEFT JOIN spotify_art ON spotify_art.uri = playlist_tracks.uri
    WHERE playlist_tracks.playlist_id = ? ORDER BY playlist_tracks.position
`);
const selectFor = db.prepare(`
    SELECT playlists.*, user_playlists.added_at, user_playlists.opened_at,
        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) AS track_count
    FROM user_playlists JOIN playlists ON playlists.id = user_playlists.playlist_id
    WHERE user_playlists.email = ? ORDER BY user_playlists.opened_at DESC
`);

/** Saves a playlist just read from Spotify, replacing its old tracks, and links it to the person who pasted it */
export function savePlaylist(playlist: SpotifyPlaylist, email: string, isPrivate = false) {
    const now = Date.now();

    transaction(() => {
        upsertPlaylist.run(playlist.id, playlist.name, playlist.owner ?? null, playlist.mayBeTruncated ? 1 : 0, isPrivate ? 1 : 0, playlist.image ?? null, now);
        deleteTracks.run(playlist.id);
        playlist.tracks.forEach((track, position) =>
            insertTrack.run(playlist.id, position, track.title, track.artist, track.durationMs ?? null, track.uri ?? null));
        linkUser.run(email, playlist.id, now, now);
    });
}

/** Links a saved playlist to someone opening it, e.g. from a shared link */
export function linkPlaylist(email: string, playlistId: string) {
    const now = Date.now();
    linkUser.run(email, playlistId, now, now);
}

export function getPlaylist(id: string): StoredPlaylist | null {
    const row = selectPlaylist.get(id) as PlaylistRow | undefined;
    if (!row) return null;

    const tracks = (selectTracks.all(id) as unknown as TrackRow[]).map(track => ({
        title: track.title,
        artist: track.artist,
        ...(track.duration_ms !== null ? { durationMs: track.duration_ms } : {}),
        ...(track.uri ? { uri: track.uri } : {}),
        ...(track.image ? { image: track.image } : {})
    }));

    return {
        id: row.id,
        name: row.name,
        ...(row.owner ? { owner: row.owner } : {}),
        mayBeTruncated: !!row.may_be_truncated,
        private: !!row.private,
        ...(row.image ? { image: row.image } : {}),
        fetchedAt: row.fetched_at,
        tracks
    };
}

/** A saved playlist, if this person may open it: any public one, or a private one they added themselves */
export function getPlaylistFor(email: string, id: string): StoredPlaylist | null {
    const playlist = getPlaylist(id);
    if (!playlist || (playlist.private && !selectLink.get(email, id))) return null;
    return playlist;
}

/** Someone's playlists, most recently opened first, without their tracks */
export function getPlaylistsFor(email: string) {
    return (selectFor.all(email) as any[]).map(row => ({
        id: row.id as string,
        name: row.name as string,
        ...(row.owner ? { owner: row.owner as string } : {}),
        ...(row.image ? { image: row.image as string } : {}),
        trackCount: row.track_count as number,
        addedAt: row.added_at as number,
        openedAt: row.opened_at as number
    }));
}
