import type { Request, Response } from "express";
import { RockbotClient } from "../client.js";
import { getRecentlyQueued } from "../queued.js";
import { getVenue } from "../schools.js";
import { describeVenueQueue, getVenueQueue, isFromZotify, queueEntries } from "../venueQueue.js";
import { refreshVotes } from "../votes.js";
import { requestVenue } from "./params.js";

/** A venue's queue over HTTP. Pages get it live over the socket instead (see live.ts); this shares the same Rockbot fetch */
export async function venueQueue(_req: Request, res: Response) {
    const venueName = requestVenue(res);

    try {
        const { queue: queuePromise, fetchedAt } = getVenueQueue(venueName);
        const [queue, queued] = await Promise.all([queuePromise, getRecentlyQueued(venueName)]);

        // Top up votes on Zotify's picks in the background so the response isn't held up
        refreshVotes(venueName, queueEntries(queue).filter(entry => isFromZotify(entry, queued)));

        res.json(await describeVenueQueue(venueName, queue, fetchedAt));
    } catch (error) {
        if (error instanceof RockbotClient.Errors.VenueUnavailableError) {
            res.status(503).json({ error: `${getVenue(venueName)?.name ?? "This venue"} isn't taking requests right now.`, unavailable: true, code: "venue_unavailable" });
            return;
        }

        console.error(`Error loading the queue at ${venueName}:`, error);
        res.status(502).json({ error: "Could not load the queue. Please try again." });
    }
}
