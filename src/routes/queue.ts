import type { Request, Response } from "express";
import { enqueue } from "../zotifyQueue.js";
import { parseVenue } from "./params.js";

/** Adds a song to Zotify's queue, which puts it into Rockbot's queue when there's room (see zotifyQueue.ts) */
export async function queue(req: Request, res: Response) {
    const body = req.body ?? {};
    const song = body.song;
    const venueName = parseVenue(body.venue, res);

    // Rockbot song IDs can come through as numbers, so accept either
    if (!["string", "number"].includes(typeof song?.id) || song.id === "") {
        res.status(400).json({ error: "Missing song ID" });
        return;
    }

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${body.venue}"` });
        return;
    }

    try {
        const { requestedAt, position } = enqueue(venueName, {
            id: String(song.id),
            name: String(song.name ?? ""),
            artist: String(song.artist ?? ""),
            cover: typeof song.cover === "string" ? song.cover : undefined
        }, res.locals.session?.email);

        res.json({ queuedAt: requestedAt, position });
    } catch (error) {
        console.error(`Error adding "${song.name}" to Zotify's queue at ${venueName}:`, error);
        res.status(500).json({ error: "Could not queue song. Please try again." });
    }
}
