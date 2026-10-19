import type { Request, Response } from "express";
import { getFailures, getWaiting } from "../zotifyQueue.js";
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

    const email = res.locals.session.email;
    const song = (row: ReturnType<typeof getWaiting>[number]) => ({
        id: row.id,
        songId: row.song_id,
        name: row.name,
        artist: row.artist,
        ...(row.cover ? { cover: row.cover } : {}),
        requestedAt: row.requested_at,
        mine: row.requested_by === email
    });

    res.json({
        waiting: getWaiting(venueName).map(song),
        failures: getFailures(venueName).map(row => ({ ...song(row), failedAt: row.failed_at, attempts: row.attempts, error: row.last_error }))
    });
}
