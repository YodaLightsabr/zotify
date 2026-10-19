import type { Request, Response } from "express";
import { describeZotifyQueue } from "../zotifyQueue.js";
import { parseVenue, queryParam } from "./params.js";

/**
 * ?venue=. Zotify's queue at a venue for signed-in people: songs waiting for room in Rockbot's queue, front first,
 * and songs that couldn't be put there even after retrying. Who asked for each song is left out
 */
export function zotifyQueue(req: Request, res: Response) {
    const venueName = parseVenue(queryParam(req, "venue"));

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }

    res.json(describeZotifyQueue(venueName, res.locals.session.email));
}
