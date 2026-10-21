import type { Request, Response } from "express";
import { isAdmin } from "../auth.js";
import { clear, describeZotifyQueue, remove, reorder, ZotifyQueueError } from "../zotifyQueue.js";
import { hasScope } from "./auth.js";
import { requestSchool, requestVenue } from "./params.js";

/**
 * Zotify's queue at a venue: songs waiting for room in Rockbot's queue, front first, and songs that couldn't be put there even
 * after retrying. Who asked for each song is left out, apart from whether it was you
 */
export function zotifyQueue(_req: Request, res: Response) {
    res.json(describeZotifyQueue(requestVenue(res), res.locals.session.email));
}

function sendQueueError(res: Response, error: unknown, context: string) {
    if (error instanceof ZotifyQueueError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

/** Admin only. Body: { ids }, every waiting song's ID in the new order */
export function reorderZotifyQueue(req: Request, res: Response) {
    const venue = requestVenue(res);
    const ids = req.body?.ids;

    if (!Array.isArray(ids) || !ids.every(id => Number.isInteger(id))) {
        res.status(400).json({ error: "Missing the song order", code: "invalid_request" });
        return;
    }

    try {
        reorder(venue, ids);
        res.json(describeZotifyQueue(venue, res.locals.session.email));
    } catch (error) {
        sendQueueError(res, error, `Error rearranging Zotify's queue at ${venue}:`);
    }
}

/** Takes a song out of Zotify's queue: your own, or anyone's for admins */
export function removeFromZotifyQueue(req: Request, res: Response) {
    const id = Number(req.params.id);
    const email: string = res.locals.session.email;

    if (!Number.isInteger(id)) {
        res.status(404).json({ error: "That song isn't waiting in the queue anymore.", code: "not_found" });
        return;
    }

    try {
        // Tokens need the admin scope to remove other people's songs
        remove(id, requestVenue(res), email, hasScope(res, "admin") && isAdmin(email, requestSchool(res).id));
        res.status(204).end();
    } catch (error) {
        sendQueueError(res, error, `Error removing song ${id} from Zotify's queue:`);
    }
}

/** Admin only. Takes every waiting song out of Zotify's queue at the venue */
export function clearZotifyQueue(_req: Request, res: Response) {
    const venue = requestVenue(res);
    const removed = clear(venue);
    console.log(`${res.locals.session.email} cleared Zotify's queue at ${venue} (${removed} songs)`);
    res.json({ removed });
}
