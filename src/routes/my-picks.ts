import type { Request, Response } from "express";
import { getHistoryFor } from "../history.js";
import { getVenues } from "../schools.js";
import { queryParam } from "./params.js";

/**
 * ?school=. The signed-in person's own picks, newest first, at one school's venues or at all of them. Who queued each one is
 * left out, since it's always them
 */
export async function myPicks(req: Request, res: Response) {
    const school = queryParam(req, "school");
    const venues = school ? new Set(getVenues(school).map(venue => venue.id)) : null;
    const picks = await getHistoryFor(res.locals.session.email);
    res.json(picks.filter(pick => !venues || venues.has(pick.venue)).map(({ requestedBy, ...pick }) => pick));
}
