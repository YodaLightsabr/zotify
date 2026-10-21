import { getRecentlyQueued } from "../queued.js";
import { describeVenueQueue, getVenueQueue, isFromZotify, queueEntries } from "../venueQueue.js";
import { refreshVotes } from "../votes.js";
import { parseVenue, queryParam } from "./params.js";
/** A venue's queue over HTTP. Pages get it live over the socket instead (see live.ts); this shares the same Rockbot fetch */
export async function venueQueue(req, res) {
    const venueName = parseVenue(queryParam(req, "venue"), res);
    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }
    try {
        const { queue: queuePromise, fetchedAt } = getVenueQueue(venueName);
        const [queue, queued] = await Promise.all([queuePromise, getRecentlyQueued(venueName)]);
        // Top up votes on Zotify's picks in the background so the response isn't held up
        refreshVotes(venueName, queueEntries(queue).filter(entry => isFromZotify(entry, queued)));
        res.json(await describeVenueQueue(venueName, queue, fetchedAt));
    }
    catch (error) {
        console.error(`Error loading the queue at ${venueName}:`, error);
        res.status(502).json({ error: "Could not load the queue. Please try again." });
    }
}
//# sourceMappingURL=venue-queue.js.map