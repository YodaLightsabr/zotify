import type { Request, Response } from "express";
import { getSong } from "../searchCache.js";
import { enqueue } from "../zotifyQueue.js";
import { requestVenue } from "./params.js";

/**
 * Body: { songId }, a song from search results. Adds it to Zotify's queue at the venue, which puts it into Rockbot's queue when
 * there's room (see zotifyQueue.ts). Zotify's pages also send the song's name, artist and cover, as { song }, which is used
 * when the song isn't saved yet
 */
export function requestSong(req: Request, res: Response) {
    const body = req.body ?? {};
    // Rockbot song IDs can come through as numbers, so accept either
    const raw = body.songId ?? body.song?.id;
    const id = ["string", "number"].includes(typeof raw) && raw !== "" ? String(raw) : null;
    const venue = requestVenue(res);

    if (!id) {
        res.status(400).json({ error: "Missing songId", code: "invalid_request" });
        return;
    }

    const saved = getSong(id);
    const song = saved ?? (typeof body.song?.name === "string" && body.song.name
        ? { id, name: body.song.name, artist: String(body.song.artist ?? ""), cover: typeof body.song.cover === "string" ? body.song.cover : undefined }
        : null);

    if (!song) {
        res.status(404).json({ error: "Zotify doesn't know that song. Search for it first, then request it from the results.", code: "not_found" });
        return;
    }

    try {
        const { requestedAt, position, alreadyWaiting } = enqueue(venue, song, res.locals.session.email);
        res.status(alreadyWaiting ? 200 : 201).json({ requestedAt, position, alreadyWaiting });
    } catch (error) {
        console.error(`Error adding "${song.name}" to Zotify's queue at ${venue}:`, error);
        res.status(500).json({ error: "Could not queue song. Please try again." });
    }
}
