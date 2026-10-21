import type { Request, Response } from "express";
import { isAdmin } from "../auth.js";
import { checkDownvote, DownvoteRefusedError, downvotePick, ZOTIFY_DOWNVOTES } from "../downvotes.js";
import { events } from "../events.js";
import { markBoosted } from "../queued.js";
import { getVenueQueue, queueEntries } from "../venueQueue.js";
import { castVotes, getVoteCapacity, markVoted } from "../votes.js";
import { hasScope } from "./auth.js";
import { parseVoteCount, requestSchool, requestVenue } from "./params.js";

// Votes on a pick (a song in a venue's Rockbot queue) from Zotify's Rockbot accounts. Anyone can upvote; only the school's admins
// can downvote, within the rules in downvotes.ts

const pickIdParam = (req: Request) => String(req.params.pickId);

/** Whether this request may downvote: the school's admins, and tokens with the admin scope */
const canDownvote = (res: Response) => hasScope(res, "admin") && isAdmin(res.locals.session.email, requestSchool(res).id);

/**
 * How many more votes Zotify's accounts could add to a pick: up is { total, voted, available }, where available is 0 once every
 * account has voted. For admins, down says whether it can be downvoted and why not if it can't; null for everyone else
 */
export async function pickVotes(req: Request, res: Response) {
    const pickId = pickIdParam(req);
    const venue = requestVenue(res);

    try {
        const [{ total, voted, available }, down] = await Promise.all([
            getVoteCapacity(venue, pickId),
            canDownvote(res) ? checkDownvote(venue, pickId).then(({ entry, ...check }) => ({ ...check, count: ZOTIFY_DOWNVOTES })) : null
        ]);

        res.json({ up: { total, voted, available }, down });
    } catch (error) {
        console.error(`Error checking votes for pick ${pickId} at ${venue}:`, error);
        res.status(502).json({ error: "Could not check this song's votes. Please try again." });
    }
}

/**
 * Body: { direction?, count?, songId?, overrideReason? }. Votes on a pick and checks the votes landed.
 *
 * Up (the default): count is how many accounts vote, all of them by default; a negative count means all but that many. songId,
 * from search results, lets later searches show the song as boosted.
 *
 * Down, admins only: count is 1 to ZOTIFY_DOWNVOTES accounts, all of them by default, if every rule allows it; 409 with the
 * reason if not. overrideReason gets past karma protection only, and is recorded
 */
export async function votePick(req: Request, res: Response) {
    const body = req.body ?? {};
    const pickId = pickIdParam(req);
    const venue = requestVenue(res);
    const direction = body.direction ?? "up";

    if (direction !== "up" && direction !== "down") {
        res.status(400).json({ error: 'direction must be "up" or "down"', code: "invalid_request" });
        return;
    }

    if (direction === "down") {
        await downvote(req, res);
        return;
    }

    const count = parseVoteCount(body.count);
    const songId = ["string", "number"].includes(typeof body.songId) ? String(body.songId) : undefined;

    if (count === null) {
        res.status(400).json({ error: "count must be a whole number", code: "invalid_request" });
        return;
    }

    try {
        // Only vote on picks that are really in this venue's queue
        const entry = queueEntries(await getVenueQueue(venue).queue).find(entry => entry.pickId === pickId);

        if (!entry) {
            res.status(404).json({ error: "That song isn't in the queue anymore", code: "not_found" });
            return;
        }

        // Mark first so the background top-up doesn't vote on it at the same time
        markVoted(venue, pickId);
        const votes = await castVotes(venue, pickId, entry, count);

        if (votes.requested && votes.confirmed === 0) {
            res.status(502).json({ ...votes, error: "None of the votes went through. Please try again." });
            return;
        }

        // The votes went through, so a cache failure shouldn't fail the request
        const boostedAt = await markBoosted(venue, {
            id: songId ?? entry.songId ?? `pick:${entry.pickId}`,
            pickId: entry.pickId,
            name: entry.name,
            artist: entry.artist,
            cover: entry.cover
        }).catch(error => {
            console.error(`Could not record boost for "${entry.name}":`, error);
            return Date.now();
        });

        events.emit("venueChanged", venue);
        res.json({ ...votes, boostedAt });
    } catch (error) {
        console.error(`Error voting for pick ${pickId} at ${venue}:`, error);
        res.status(502).json({ error: "Could not vote for this song. Please try again." });
    }
}

async function downvote(req: Request, res: Response) {
    const pickId = pickIdParam(req);
    const venue = requestVenue(res);
    const overrideReason = typeof req.body?.overrideReason === "string" ? req.body.overrideReason.trim() : undefined;
    const count = req.body?.count ?? ZOTIFY_DOWNVOTES;

    if (!canDownvote(res)) {
        res.status(403).json({ error: "Only admins can downvote, with the admin scope.", code: "forbidden" });
        return;
    }

    if (!Number.isInteger(count) || count < 1 || count > ZOTIFY_DOWNVOTES) {
        res.status(400).json({ error: `Downvote with 1 to ${ZOTIFY_DOWNVOTES} accounts.`, code: "invalid_request" });
        return;
    }

    if (overrideReason !== undefined && (overrideReason.length < 3 || overrideReason.length > 200)) {
        res.status(400).json({ error: "Give a short reason for the override (3 to 200 characters).", code: "invalid_request" });
        return;
    }

    try {
        const result = await downvotePick(venue, pickId, res.locals.session.email, overrideReason, count);
        events.emit("venueChanged", venue);
        res.json(result);
    } catch (error) {
        if (error instanceof DownvoteRefusedError) {
            res.status(409).json({ error: error.message, code: "downvote_refused", ...error.check });
            return;
        }

        console.error(`Error downvoting pick ${pickId} at ${venue}:`, error);
        res.status(502).json({ error: "Could not downvote this song. Please try again." });
    }
}
