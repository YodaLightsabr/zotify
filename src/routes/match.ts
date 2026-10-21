import type { Request, Response } from "express";
import { findTrack } from "../trackMatch.js";
import { queryParam, requestVenue } from "./params.js";

/** Finds the Rockbot song for a track, e.g. from a Spotify playlist. match is null when it isn't on Rockbot; errors return 502 */
export async function match(req: Request, res: Response) {
    const title = queryParam(req, "title");
    const artist = queryParam(req, "artist");
    const venueName = requestVenue(res);

    if (!title || !artist) {
        res.status(400).json({ error: "Missing title or artist", code: "invalid_request" });
        return;
    }

    try {
        res.json(await findTrack(venueName, { title, artist }));
    } catch (error) {
        console.error(`Error finding "${title}" by ${artist} at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
