import type { Request, Response } from "express";
import { markBoosted } from "../queued.js";
import { getVenueQueue, queueEntries } from "../venueQueue.js";
import { castVotes } from "../votes.js";
import { parseVenue, parseVoteCount } from "./params.js";

/** Upvotes a song already in the queue from every account allowed at this venue */
export async function boost(req: Request, res: Response) {
    const body = req.body ?? {};
    const pickId = body.pickId;
    // The song's ID from search results, so later searches can tell it was boosted
    const songId = ["string", "number"].includes(typeof body.songId) ? String(body.songId) : undefined;
    const venueName = parseVenue(body.venue);
    // How many accounts upvote it; all of them by default
    const count = parseVoteCount(body.count);

    if (!["string", "number"].includes(typeof pickId) || pickId === "") {
        res.status(400).json({ error: "Missing pick ID" });
        return;
    }

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${body.venue}"` });
        return;
    }

    if (count === null) {
        res.status(400).json({ error: "count must be a whole number" });
        return;
    }

    try {
        // Only boost picks that are really in this venue's queue
        const queue = await getVenueQueue(venueName).queue;
        const entry = queueEntries(queue).find(entry => entry.pickId === String(pickId));

        if (!entry) {
            res.status(404).json({ error: "That song isn't in the queue anymore" });
            return;
        }

        const votes = await castVotes(venueName, entry.pickId, entry, count);

        if (votes.requested && votes.confirmed === 0) {
            res.status(502).json({ error: "None of the votes went through. Please try again." });
            return;
        }

        // The votes went through, so a cache failure shouldn't fail the request
        const boostedAt = await markBoosted(venueName, {
            id: songId ?? entry.songId ?? `pick:${entry.pickId}`,
            pickId: entry.pickId,
            name: entry.name,
            artist: entry.artist,
            cover: entry.cover
        }).catch(error => {
            console.error(`Could not record boost for "${entry.name}":`, error);
            return Date.now();
        });

        res.json({ ...votes, boostedAt });
    } catch (error) {
        console.error(`Error boosting pick ${pickId} at ${venueName}:`, error);
        res.status(502).json({ error: "Could not boost this song. Please try again." });
    }
}
