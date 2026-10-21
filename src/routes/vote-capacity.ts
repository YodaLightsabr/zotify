import type { Request, Response } from "express";
import { getVoteCapacity } from "../votes.js";
import { parseVenue, queryParam } from "./params.js";

/** How many more votes our accounts could add to a pick: { total, voted, available }. available is 0 once every account has voted */
export async function voteCapacity(req: Request, res: Response) {
    const pickId = queryParam(req, "pickId");
    const venueName = parseVenue(queryParam(req, "venue"), res);

    if (!pickId) {
        res.status(400).json({ error: "Missing pick ID" });
        return;
    }

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }

    try {
        const { total, voted, available } = await getVoteCapacity(venueName, pickId);
        res.json({ total, voted, available });
    } catch (error) {
        console.error(`Error checking votes for pick ${pickId} at ${venueName}:`, error);
        res.status(502).json({ error: "Could not check this song's votes. Please try again." });
    }
}
