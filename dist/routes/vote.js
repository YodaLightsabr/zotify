import { events } from "../events.js";
import { castVotes, markVoted } from "../votes.js";
import { parseVenue, parseVoteCount } from "./params.js";
/**
 * Upvotes a pick with the venue's accounts and checks the votes landed, e.g. right after queuing it.
 * Body: { pickId, venue, count?, song? } where count is how many accounts vote (negative means all but that many)
 */
export async function vote(req, res) {
    const body = req.body ?? {};
    const pickId = body.pickId;
    const venueName = parseVenue(body.venue, res);
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
    // Only used for log messages
    const song = { name: String(body.song?.name ?? `pick ${pickId}`), artist: String(body.song?.artist ?? "") };
    try {
        // Mark first so the background top-up doesn't vote on it at the same time
        markVoted(venueName, String(pickId));
        const result = await castVotes(venueName, String(pickId), song, count);
        if (result.requested && result.confirmed === 0) {
            res.status(502).json({ ...result, error: "None of the votes went through. Please try again." });
            return;
        }
        events.emit("venueChanged", venueName);
        res.json(result);
    }
    catch (error) {
        console.error(`Error voting for pick ${pickId} at ${venueName}:`, error);
        res.status(502).json({ error: "Could not vote for this song. Please try again." });
    }
}
//# sourceMappingURL=vote.js.map