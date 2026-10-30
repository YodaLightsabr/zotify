import type { Request, Response } from "express";
import {
    getLibraryPlaylists, getLibrarySongs, removePlaylistFromLibrary, removeSong, saveMatches, savePlaylistToLibrary, saveSong
} from "../library.js";
import { startPlaylistMatchJob } from "../playlistMatch.js";
import { getPlaylistFor } from "../playlists.js";
import { requestVenue } from "./params.js";

const sessionEmail = (res: Response): string => res.locals.session.email;

// Rockbot song IDs (digits, so far); Spotify playlist IDs are 22 letters and digits
const songIdParam = (req: Request) => typeof req.params.songId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(req.params.songId) ? req.params.songId : null;
const playlistIdParam = (req: Request) => typeof req.params.id === "string" && /^[A-Za-z0-9]{22}$/.test(req.params.id) ? req.params.id : null;

/** Your saved songs, most recently saved first, including ones that can't be requested anywhere right now */
export function librarySongs(_req: Request, res: Response) {
    res.json(getLibrarySongs(sessionEmail(res)));
}

/** Saves a song to your Library by hand. It has to be a Rockbot song Zotify has seen, from a search or a playlist */
export function saveSongRoute(req: Request, res: Response) {
    const id = songIdParam(req);

    if (!id || !saveSong(sessionEmail(res), id)) {
        res.status(404).json({ error: "Zotify doesn't know that song. Search for it first, then save it from the results.", code: "not_found" });
        return;
    }

    res.status(204).end();
}

/** Takes a song out of your Library. Your History keeps every time you requested it */
export function removeSongRoute(req: Request, res: Response) {
    const id = songIdParam(req);

    if (!id || !removeSong(sessionEmail(res), id)) {
        res.status(404).json({ error: "That song isn't in your Library.", code: "not_found" });
        return;
    }

    res.status(204).end();
}

/** Your saved playlists, most recently saved first */
export function libraryPlaylists(_req: Request, res: Response) {
    res.json(getLibraryPlaylists(sessionEmail(res)));
}

/**
 * Saves a playlist to your Library, and starts finding its tracks on Rockbot at the venue. The ones Rockbot has are added to
 * your Library as they're found (see library.ts), and again whenever the playlist is looked up later
 */
export function savePlaylistRoute(req: Request, res: Response) {
    const id = playlistIdParam(req);
    const saved = id ? getPlaylistFor(sessionEmail(res), id) : null;

    if (!saved) {
        res.status(404).json({ error: "Zotify doesn't have that playlist. Add it first with its Spotify link.", code: "not_found" });
        return;
    }

    const email = sessionEmail(res);
    savePlaylistToLibrary(email, saved.id);

    // A job that already finished won't announce itself again, so its songs are saved now
    const job = startPlaylistMatchJob(saved, requestVenue(res));
    if (job.finishedAt) saveMatches(job, email);

    res.json(getLibraryPlaylists(email).find(playlist => playlist.id === saved.id));
}

/** Takes a playlist out of your Library. The songs it added stay until you remove them */
export function removePlaylistRoute(req: Request, res: Response) {
    const id = playlistIdParam(req);

    if (!id || !removePlaylistFromLibrary(sessionEmail(res), id)) {
        res.status(404).json({ error: "That playlist isn't in your Library.", code: "not_found" });
        return;
    }

    res.status(204).end();
}
