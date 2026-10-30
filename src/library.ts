import { db, transaction } from "./db.js";
import { events } from "./events.js";
import type { PlaylistMatchJob } from "./playlistMatch.js";
import type { RequestedSong } from "./requestSong.js";

// Everyone's Library: the Rockbot songs they've requested, saved by hand, found in a playlist they saved, or imported from their
// Spotify likes (spotifyImport.ts), and the playlists
// they saved. Songs are kept whether or not they can be requested anywhere right now; song_availability says where they can
// be, and pages hide the ones that can't be played at the venue they're showing

export type LibrarySource = "requested" | "saved" | "playlist" | "liked";

export interface LibrarySong {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    savedAt: number;
    source: LibrarySource;
    // The saved playlist it came from, for source "playlist"
    playlist?: { id: string, name: string };
    // How many times you've requested it through Zotify, and when you last did
    requests: number;
    lastRequestedAt: number | null;
    // Whether it could be requested at each venue the last time it came up there. Venues it's never come up at are left out
    availability: Record<string, boolean>;
}

interface SongRow {
    song_id: string;
    name: string;
    artist: string;
    cover: string | null;
    saved_at: number;
    source: LibrarySource;
    playlist_id: string | null;
    playlist_name: string | null;
    requests: number;
    last_requested_at: number | null;
}

// Requesting or saving by hand brings back a song that was taken out, as if saved anew. A song already there keeps how it got there
const saveExplicitly = db.prepare(`
    INSERT INTO library_songs (email, song_id, saved_at, source) VALUES (?, ?, ?, ?)
    ON CONFLICT (email, song_id) DO UPDATE SET
        saved_at = CASE WHEN removed_at IS NULL THEN saved_at ELSE excluded.saved_at END,
        source = CASE WHEN removed_at IS NULL THEN source ELSE excluded.source END,
        playlist_id = CASE WHEN removed_at IS NULL THEN playlist_id ELSE NULL END,
        removed_at = NULL
`);
// Playlists only add songs that were never in the Library, so ones taken out by hand stay out
const saveFromPlaylist = db.prepare(`
    INSERT INTO library_songs (email, song_id, saved_at, source, playlist_id) VALUES (?, ?, ?, 'playlist', ?)
    ON CONFLICT (email, song_id) DO NOTHING
`);
// Imported likes, like playlists, only add songs that were never in the Library
const saveLiked = db.prepare(`
    INSERT INTO library_songs (email, song_id, saved_at, source) VALUES (?, ?, ?, 'liked')
    ON CONFLICT (email, song_id) DO NOTHING
`);
const markRemoved = db.prepare("UPDATE library_songs SET removed_at = ? WHERE email = ? AND song_id = ? AND removed_at IS NULL");
// Songs requested without being searched for first come with the details the page sent; a search's details always win
const keepSong = db.prepare("INSERT OR IGNORE INTO songs (id, name, artist, cover) VALUES (?, ?, ?, ?)");
const songExists = db.prepare("SELECT 1 FROM songs WHERE id = ?");

const selectSongs = db.prepare(`
    SELECT library_songs.song_id, songs.name, songs.artist, songs.cover, library_songs.saved_at, library_songs.source,
        library_songs.playlist_id, playlists.name AS playlist_name,
        (SELECT COUNT(*) FROM pick_history WHERE requested_by = library_songs.email AND song_id = library_songs.song_id) AS requests,
        (SELECT MAX(requested_at) FROM pick_history WHERE requested_by = library_songs.email AND song_id = library_songs.song_id) AS last_requested_at
    FROM library_songs
    JOIN songs ON songs.id = library_songs.song_id
    LEFT JOIN playlists ON playlists.id = library_songs.playlist_id
    WHERE library_songs.email = ? AND library_songs.removed_at IS NULL
    ORDER BY library_songs.saved_at DESC
`);
const selectAvailability = db.prepare(`
    SELECT song_availability.song_id, song_availability.venue, song_availability.requestable
    FROM song_availability JOIN library_songs ON library_songs.song_id = song_availability.song_id
    WHERE library_songs.email = ? AND library_songs.removed_at IS NULL
`);

const savePlaylistLink = db.prepare(`
    INSERT INTO user_playlists (email, playlist_id, added_at, opened_at, saved_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (email, playlist_id) DO UPDATE SET saved_at = COALESCE(user_playlists.saved_at, excluded.saved_at)
`);
const unsavePlaylist = db.prepare("UPDATE user_playlists SET saved_at = NULL WHERE email = ? AND playlist_id = ? AND saved_at IS NOT NULL");
const selectPlaylistSavedAt = db.prepare("SELECT saved_at FROM user_playlists WHERE email = ? AND playlist_id = ?");
const recordPlaylistSong = db.prepare(`
    INSERT INTO playlist_songs (playlist_id, song_id, found_at) VALUES (?, ?, ?)
    ON CONFLICT (playlist_id, song_id) DO UPDATE SET found_at = excluded.found_at
`);
const selectSavers = db.prepare("SELECT email FROM user_playlists WHERE playlist_id = ? AND saved_at IS NOT NULL");
const selectPlaylists = db.prepare(`
    SELECT playlists.id, playlists.name, playlists.owner, playlists.image, user_playlists.saved_at,
        (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = playlists.id) AS track_count,
        (SELECT COUNT(*) FROM playlist_songs JOIN library_songs ON library_songs.song_id = playlist_songs.song_id
            WHERE playlist_songs.playlist_id = playlists.id AND library_songs.email = user_playlists.email AND library_songs.removed_at IS NULL) AS song_count
    FROM user_playlists JOIN playlists ON playlists.id = user_playlists.playlist_id
    WHERE user_playlists.email = ? AND user_playlists.saved_at IS NOT NULL
    ORDER BY user_playlists.saved_at DESC
`);

/** Adds a song someone requested to their Library */
export function saveRequestedSong(email: string, song: RequestedSong) {
    transaction(() => {
        keepSong.run(song.id, song.name, song.artist, song.cover?.startsWith("https://") ? song.cover : null);
        saveExplicitly.run(email, song.id, Date.now(), "requested");
    });
}

/** Saves a song by hand. False when Zotify has never seen it on Rockbot, since the Library only keeps Rockbot songs */
export function saveSong(email: string, songId: string) {
    if (!songExists.get(songId)) return false;
    saveExplicitly.run(email, songId, Date.now(), "saved");
    return true;
}

/** Adds songs found from someone's Spotify likes, most recently liked first. Songs must already be in songs, from a search */
export function saveLikedSongs(email: string, songIds: string[]) {
    const now = Date.now();
    transaction(() => [...new Set(songIds)].forEach((id, i) => saveLiked.run(email, id, now - i)));
}

/** Takes a song out of someone's Library. False if it wasn't there */
export function removeSong(email: string, songId: string) {
    return Number(markRemoved.run(Date.now(), email, songId).changes) > 0;
}

/** Someone's saved songs, most recently saved first, with where each can be requested */
export function getLibrarySongs(email: string): LibrarySong[] {
    const availability = new Map<string, Record<string, boolean>>();

    for (const row of selectAvailability.all(email) as { song_id: string, venue: string, requestable: number }[]) {
        availability.set(row.song_id, { ...availability.get(row.song_id), [row.venue]: !!row.requestable });
    }

    return (selectSongs.all(email) as unknown as SongRow[]).map(row => ({
        id: row.song_id,
        name: row.name,
        artist: row.artist,
        ...(row.cover ? { cover: row.cover } : {}),
        savedAt: row.saved_at,
        source: row.source,
        ...(row.playlist_id && row.playlist_name ? { playlist: { id: row.playlist_id, name: row.playlist_name } } : {}),
        requests: row.requests,
        lastRequestedAt: row.last_requested_at,
        availability: availability.get(row.song_id) ?? {}
    }));
}

/** When someone saved a playlist to their Library, or null if they haven't */
export function playlistSavedAt(email: string, playlistId: string): number | null {
    return (selectPlaylistSavedAt.get(email, playlistId) as { saved_at: number | null } | undefined)?.saved_at ?? null;
}

/** Saves a playlist to someone's Library. Its songs follow once they've been found on Rockbot (see saveMatches) */
export function savePlaylistToLibrary(email: string, playlistId: string) {
    const now = Date.now();
    savePlaylistLink.run(email, playlistId, now, now, now);
}

/** Takes a playlist out of someone's Library. The songs it added stay, since they're in the Library on their own */
export function removePlaylistFromLibrary(email: string, playlistId: string) {
    return Number(unsavePlaylist.run(email, playlistId).changes) > 0;
}

/** Someone's saved playlists, most recently saved first */
export function getLibraryPlaylists(email: string) {
    return (selectPlaylists.all(email) as any[]).map(row => ({
        id: row.id as string,
        name: row.name as string,
        ...(row.owner ? { owner: row.owner as string } : {}),
        ...(row.image ? { image: row.image as string } : {}),
        trackCount: row.track_count as number,
        // How many of its tracks are in your Library: the ones found on Rockbot that you haven't taken out
        songCount: row.song_count as number,
        savedAt: row.saved_at as number
    }));
}

/**
 * Records the songs a playlist matched on Rockbot, and adds them to the Library of everyone who saved it, or only to one
 * person's. Songs that can't be requested anywhere are kept too, in case that changes; tracks Rockbot doesn't have at all aren't
 */
export function saveMatches(job: PlaylistMatchJob, onlyEmail?: string) {
    keepPlaylistSongs(job.playlistId, job.tracks.flatMap(track => track.match ? [track.match.id] : []), onlyEmail);
}

/** The same for songs found one at a time, like the playlist page does. Songs must already be in songs, from a search */
export function keepPlaylistSongs(playlistId: string, found: string[], onlyEmail?: string) {
    const emails = onlyEmail ? [onlyEmail] : (selectSavers.all(playlistId) as { email: string }[]).map(row => row.email);
    const songIds = [...new Set(found)];
    const now = Date.now();

    transaction(() => {
        for (const id of songIds) recordPlaylistSong.run(playlistId, id, now);
        // Earlier tracks get later times, so the Library lists the playlist in its own order
        for (const email of emails) songIds.forEach((id, i) => saveFromPlaylist.run(email, id, now - i, playlistId));
    });
}

// Whenever anyone finds a playlist's songs, at any venue, they're kept, and the people who saved it get any that are new
events.on("playlistMatched", job => {
    try {
        saveMatches(job);
    } catch (error) {
        console.error(`Could not save playlist ${job.playlistId}'s songs to Libraries:`, error);
    }
});

// Libraries started out as everyone's pick history, once
if (!db.prepare("SELECT 1 FROM meta WHERE key = 'libraryBackfilled'").get()) {
    transaction(() => {
        db.exec(`
            INSERT OR IGNORE INTO songs (id, name, artist, cover)
                SELECT song_id, name, artist, cover FROM pick_history GROUP BY song_id;
            INSERT OR IGNORE INTO library_songs (email, song_id, saved_at, source)
                SELECT requested_by, song_id, MIN(requested_at), 'requested' FROM pick_history
                WHERE requested_by IS NOT NULL GROUP BY requested_by, song_id;
            INSERT INTO song_availability (song_id, venue, requestable, checked_at)
                SELECT CAST(json_extract(result.value, '$.id') AS TEXT), searches.venue, json_extract(result.value, '$.requestable'), searches.cached_at
                FROM searches, json_each(searches.results) AS result WHERE true
                ON CONFLICT (song_id, venue) DO UPDATE SET requestable = excluded.requestable, checked_at = excluded.checked_at
                WHERE excluded.checked_at >= song_availability.checked_at;
        `);
        const { count } = db.prepare("SELECT COUNT(*) AS count FROM library_songs").get() as { count: number };
        db.prepare("INSERT INTO meta (key, value) VALUES ('libraryBackfilled', ?)").run(JSON.stringify({ at: Date.now(), songs: count }));
        console.log(`Started everyone's Library from their pick history: ${count} songs`);
    });
}
