import { getRecentlyQueued } from "../queued.js";
import { getVenueQueue, isFromZotify, queueEntries } from "../venueQueue.js";
import { refreshVotes } from "../votes.js";
import { parseVenue, queryParam } from "./params.js";
export async function venueQueue(req, res) {
    const venueName = parseVenue(queryParam(req, "venue"));
    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }
    try {
        const { queue: queuePromise, fetchedAt } = getVenueQueue(venueName);
        const [queue, queued] = await Promise.all([queuePromise, getRecentlyQueued(venueName)]);
        const mark = (entry) => ({ ...entry, zotify: isFromZotify(entry, queued) });
        // Top up votes on Zotify's picks in the background so the response isn't held up
        refreshVotes(venueName, queueEntries(queue).filter(entry => isFromZotify(entry, queued)));
        // Account for time passed since the shared fetch
        const elapsed = Math.floor((Date.now() - fetchedAt) / 1000);
        const nowPlaying = queue.nowPlaying && {
            ...mark(queue.nowPlaying),
            secondsRemaining: queue.nowPlaying.secondsRemaining !== undefined
                ? Math.max(0, queue.nowPlaying.secondsRemaining - elapsed)
                : undefined
        };
        res.json({
            nowPlaying,
            onDeck: queue.onDeck.map(mark),
            comingUp: queue.comingUp.map(mark)
        });
    }
    catch (error) {
        console.error(`Error loading the queue at ${venueName}:`, error);
        res.status(502).json({ error: "Could not load the queue. Please try again." });
    }
}
//# sourceMappingURL=venue-queue.js.map