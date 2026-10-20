import type { Request, Response } from "express";
import { isAdmin } from "../auth.js";
import { describeZotifyQueue, remove, reorder, ZotifyQueueError } from "../zotifyQueue.js";
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

function sendQueueError(res: Response, error: unknown, context: string) {
    if (error instanceof ZotifyQueueError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

/** Admin only. Body: { venue, ids }, every waiting song's ID in the new order */
export function reorderZotifyQueue(req: Request, res: Response) {
    const venueName = parseVenue(req.body?.venue);
    const ids = req.body?.ids;

    if (!venueName || !Array.isArray(ids) || !ids.every(id => Number.isInteger(id))) {
        res.status(400).json({ error: "Missing venue or song order" });
        return;
    }

    try {
        reorder(venueName, ids);
        res.json({ ok: true });
    } catch (error) {
        sendQueueError(res, error, `Error rearranging Zotify's queue at ${venueName}:`);
    }
}

/** Body: { id }. Takes a song out of Zotify's queue: your own, or anyone's for admins */
export function removeFromZotifyQueue(req: Request, res: Response) {
    const id = req.body?.id;

    if (!Number.isInteger(id)) {
        res.status(400).json({ error: "Missing song" });
        return;
    }

    const email: string = res.locals.session.email;

    try {
        remove(id, email, isAdmin(email));
        res.json({ ok: true });
    } catch (error) {
        sendQueueError(res, error, `Error removing song ${id} from Zotify's queue:`);
    }
}
