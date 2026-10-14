import { checkDownvote, DownvoteRefusedError, downvotePick, ZOTIFY_DOWNVOTES } from "../downvotes.js";
import { parseVenue, queryParam } from "./params.js";
/** Admin only. Whether a pick can be downvoted, and why not if it can't */
export async function downvoteCheck(req, res) {
    const pickId = queryParam(req, "pickId");
    const venueName = parseVenue(queryParam(req, "venue"));
    if (!pickId || !venueName) {
        res.status(400).json({ error: "Missing pick ID or venue" });
        return;
    }
    try {
        const { entry, ...check } = await checkDownvote(venueName, pickId);
        res.json({ ...check, count: ZOTIFY_DOWNVOTES });
    }
    catch (error) {
        console.error(`Error checking downvote for pick ${pickId} at ${venueName}:`, error);
        res.status(502).json({ error: "Could not check this song. Please try again." });
    }
}
/** Admin only. Body: { pickId, venue }. Downvotes a pick if every rule allows it; 409 with the reason if not */
export async function downvote(req, res) {
    const pickId = typeof req.body?.pickId === "string" || typeof req.body?.pickId === "number" ? String(req.body.pickId) : "";
    const venueName = parseVenue(req.body?.venue);
    if (!pickId || !venueName) {
        res.status(400).json({ error: "Missing pick ID or venue" });
        return;
    }
    try {
        res.json(await downvotePick(venueName, pickId, res.locals.session.email));
    }
    catch (error) {
        if (error instanceof DownvoteRefusedError) {
            res.status(409).json({ error: error.message, ...error.check });
            return;
        }
        console.error(`Error downvoting pick ${pickId} at ${venueName}:`, error);
        res.status(502).json({ error: "Could not downvote this song. Please try again." });
    }
}
//# sourceMappingURL=downvote.js.map