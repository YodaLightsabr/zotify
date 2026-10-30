import type { Request, Response } from "express";
import { playlistSavedAt } from "../library.js";
import { getPlaylistMatchJob, startPlaylistMatchJob } from "../playlistMatch.js";
import { getPlaylistQueueJob, startPlaylistQueueJob } from "../playlistQueue.js";
import { getPlaylist, getPlaylistFor, getPlaylistsFor, linkPlaylist, savePlaylist } from "../playlists.js";
import { fetchPlaylist, parsePlaylistId, SpotifyPlaylistUnavailableError } from "../spotify.js";
import { fetchPlaylistAs, getConnection } from "../spotifyApi.js";
import { requestVenue } from "./params.js";

const sessionEmail = (res: Response): string => res.locals.session.email;

/** Spotify playlist IDs are 22 letters and digits */
const playlistIdParam = (req: Request) => {
    const id = req.params.id;
    return typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
};

/**
 * Body: { url }, a Spotify playlist link (or its ID). Reads the playlist from Spotify, saves it and its tracks, and adds it to
 * your playlists. Responds with the playlist, as GET /v1/playlists/:id does. People who connected Spotify can add their own
 * private playlists too, and get every track of their own (Spotify's embed, used otherwise, stops at 100)
 */
export async function addPlaylist(req: Request, res: Response) {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const id = /^[A-Za-z0-9]{22}$/.test(url) ? url : parsePlaylistId(url);

    if (!id) {
        res.status(400).json({ error: "That doesn't look like a Spotify playlist link.", code: "invalid_request" });
        return;
    }

    const email = sessionEmail(res);
    const connected = !!getConnection(email);

    if (connected) {
        try {
            const playlist = await fetchPlaylistAs(email, id);
            savePlaylist(playlist, email, playlist.private);
            res.status(201).json(getPlaylist(id));
            return;
        } catch (error) {
            // Not one of theirs, so Spotify won't share its tracks: the embed still has public ones
            if (!(error instanceof SpotifyPlaylistUnavailableError)) console.error(`Could not read Spotify playlist ${id} as ${email}, trying its embed:`, error);
        }
    }

    try {
        const playlist = await fetchPlaylist(id);
        savePlaylist(playlist, email);
        res.status(201).json(getPlaylist(id));
    } catch (error) {
        if (error instanceof SpotifyPlaylistUnavailableError) {
            res.status(404).json({
                error: connected
                    ? "Couldn't read that playlist. It's private and isn't yours, or it doesn't exist. Spotify only lets Zotify read private playlists you made or collaborate on."
                    : "Couldn't read that playlist. It's private or doesn't exist. To open your own private playlists, connect Spotify on your Account page.",
                code: "not_found"
            });
            return;
        }

        // Spotify being down shouldn't stop people opening a playlist we already have
        if (getPlaylistFor(email, id)) {
            console.error(`Could not refresh Spotify playlist ${id}, using the saved copy:`, error);
            linkPlaylist(email, id);
            res.json(getPlaylist(id));
            return;
        }

        console.error(`Error reading Spotify playlist ${id}:`, error);
        res.status(502).json({ error: "Couldn't read that playlist from Spotify. Please try again." });
    }
}

/** The signed-in person's playlists, most recently opened first */
export function myPlaylists(_req: Request, res: Response) {
    res.json(getPlaylistsFor(sessionEmail(res)));
}

/**
 * A saved playlist and its tracks, and when you saved it to your Library. Opening one also links it to you, so shared links
 * show up in your playlists. Private playlists are only there for the people who added them
 */
export function playlist(req: Request, res: Response) {
    const id = playlistIdParam(req);
    const saved = id ? getPlaylistFor(sessionEmail(res), id) : null;

    if (!saved) {
        res.status(404).json({ error: "Zotify doesn't have that playlist. Add it first with its Spotify link.", code: "not_found" });
        return;
    }

    linkPlaylist(sessionEmail(res), saved.id);
    res.json({ ...saved, savedAt: playlistSavedAt(sessionEmail(res), saved.id) });
}

/**
 * ?fresh=1 to search again. Starts finding every track of the playlist on Rockbot at the venue, in the background, and answers
 * with the job; GET follows it. Each track gets its Rockbot match (or null), so apps can show what can be requested first
 */
export function matchPlaylist(req: Request, res: Response) {
    const id = playlistIdParam(req);
    const saved = id ? getPlaylistFor(sessionEmail(res), id) : null;

    if (!saved) {
        res.status(404).json({ error: "Zotify doesn't have that playlist. Add it first with its Spotify link.", code: "not_found" });
        return;
    }

    res.status(202).json(startPlaylistMatchJob(saved, requestVenue(res), req.query.fresh === "1"));
}

/** How finding the playlist's tracks at the venue is going, or null if nobody has started it in the last ten minutes */
export function playlistMatches(req: Request, res: Response) {
    const id = playlistIdParam(req);

    if (!id || !getPlaylistFor(sessionEmail(res), id)) {
        res.status(404).json({ error: "There's no playlist with that ID.", code: "not_found" });
        return;
    }

    res.json(getPlaylistMatchJob(id, requestVenue(res)));
}

/** Starts requesting every song in the playlist that can be requested at the venue, in the background. Answers with the job */
export function queuePlaylist(req: Request, res: Response) {
    const id = playlistIdParam(req);
    const saved = id ? getPlaylistFor(sessionEmail(res), id) : null;

    if (!saved) {
        res.status(404).json({ error: "Zotify doesn't have that playlist. Add it first with its Spotify link.", code: "not_found" });
        return;
    }

    res.status(202).json(startPlaylistQueueJob(saved, requestVenue(res), sessionEmail(res)));
}

/** How requesting the playlist at the venue is going, or null if nobody has started it lately */
export function playlistQueueStatus(req: Request, res: Response) {
    const id = playlistIdParam(req);

    if (!id || !getPlaylistFor(sessionEmail(res), id)) {
        res.status(404).json({ error: "There's no playlist with that ID.", code: "not_found" });
        return;
    }

    res.json(getPlaylistQueueJob(id, requestVenue(res)));
}
