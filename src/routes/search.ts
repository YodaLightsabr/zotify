import type { Request, Response } from "express";
import { searchSongs } from "../songSearch.js";
import { queryParam, requestVenue } from "./params.js";

/** ?q=. Searches Rockbot at a venue, with each song's queue status and whether another of the school's venues has it */
export async function search(req: Request, res: Response) {
    const query = queryParam(req, "q");
    const venueName = requestVenue(res);

    if (!query) {
        res.status(400).json({ error: "Missing search query", code: "invalid_request" });
        return;
    }

    try {
        const { songs, cacheHit } = await searchSongs(venueName, query);
        res.set("X-Cache", cacheHit ? "HIT" : "MISS").json(songs);
    } catch (error) {
        console.error(`Error searching for "${query}" at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
