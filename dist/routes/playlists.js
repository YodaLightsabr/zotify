import { getPlaylistQueueJob, startPlaylistQueueJob } from "../playlistQueue.js";
import { getPlaylist, getPlaylistsFor, linkPlaylist, savePlaylist } from "../playlists.js";
import { fetchPlaylist, parsePlaylistId, SpotifyPlaylistUnavailableError } from "../spotify.js";
import { parseVenue, queryParam } from "./params.js";
const sessionEmail = (res) => res.locals.session.email;
/** Spotify playlist IDs are 22 letters and digits */
const playlistIdParam = (req) => {
    const id = req.params.id;
    return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
};
/**
 * Body: { url }, a pasted Spotify playlist link. Reads the playlist from Spotify, saves it and its tracks, and links it to
 * whoever pasted it. Responds with where the frontend should go to see it: { id, name, redirect }
 */
export async function addPlaylist(req, res) {
    const id = parsePlaylistId(typeof req.body?.url === "string" ? req.body.url : "");
    if (!id) {
        res.status(400).json({ error: "That doesn't look like a Spotify playlist link." });
        return;
    }
    try {
        const playlist = await fetchPlaylist(id);
        savePlaylist(playlist, sessionEmail(res));
        res.json({ id, name: playlist.name, redirect: `/playlist/${id}` });
    }
    catch (error) {
        if (error instanceof SpotifyPlaylistUnavailableError) {
            res.status(404).json({ error: "Couldn't read that playlist. It's private or doesn't exist. Only public playlists work for now." });
            return;
        }
        // Spotify being down shouldn't stop people opening a playlist we already have
        if (getPlaylist(id)) {
            console.error(`Could not refresh Spotify playlist ${id}, using the saved copy:`, error);
            linkPlaylist(sessionEmail(res), id);
            res.json({ id, redirect: `/playlist/${id}` });
            return;
        }
        console.error(`Error reading Spotify playlist ${id}:`, error);
        res.status(502).json({ error: "Couldn't read that playlist from Spotify. Please try again." });
    }
}
/** The signed-in person's playlists, most recently opened first */
export function myPlaylists(_req, res) {
    res.json(getPlaylistsFor(sessionEmail(res)));
}
/** A saved playlist and its tracks. Opening one also links it to you, so shared links show up in your playlists */
export function playlist(req, res) {
    const id = playlistIdParam(req);
    const saved = id ? getPlaylist(id) : null;
    if (!saved) {
        res.status(404).json({ error: "We don't have that playlist. Paste its Spotify link into the search box to add it." });
        return;
    }
    linkPlaylist(sessionEmail(res), saved.id);
    res.json(saved);
}
/** Body: { venue }. Starts queuing every song in the playlist that can be queued at the venue, in the background */
export function queuePlaylist(req, res) {
    const id = playlistIdParam(req);
    const venue = parseVenue(req.body?.venue);
    const saved = id ? getPlaylist(id) : null;
    if (!saved) {
        res.status(404).json({ error: "We don't have that playlist." });
        return;
    }
    if (!venue) {
        res.status(400).json({ error: `Unknown venue "${req.body?.venue}"` });
        return;
    }
    res.json(startPlaylistQueueJob(saved, venue, sessionEmail(res)));
}
/** ?venue=. How queuing the playlist there is going, or null if nobody has started it lately */
export function playlistQueueStatus(req, res) {
    const id = playlistIdParam(req);
    const venue = parseVenue(queryParam(req, "venue"));
    if (!id || !venue) {
        res.status(400).json({ error: "Missing playlist or venue" });
        return;
    }
    res.json(getPlaylistQueueJob(id, venue));
}
//# sourceMappingURL=playlists.js.map