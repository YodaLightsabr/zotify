import type { Request, Response } from "express";
import { getRecentlyQueued } from "../queued.js";
import { parseVenue, queryParam } from "./params.js";

export async function queued(req: Request, res: Response) {
    const venueName = parseVenue(queryParam(req, "venue"), res);

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }

    try {
        res.json(await getRecentlyQueued(venueName));
    } catch (error) {
        console.error(`Error loading queued songs at ${venueName}:`, error);
        res.status(500).json({ error: "Could not load queued songs" });
    }
}
