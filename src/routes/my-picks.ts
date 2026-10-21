import type { Request, Response } from "express";
import { getHistoryFor } from "../history.js";
import { getVenues } from "../schools.js";
import { requestSchool } from "./params.js";

/** The signed-in person's own picks at this school's venues, newest first. Who queued each one is left out, since it's always them */
export async function myPicks(_req: Request, res: Response) {
    const venues = new Set(getVenues(requestSchool(res).id).map(venue => venue.id));
    const picks = await getHistoryFor(res.locals.session.email);
    res.json(picks.filter(pick => venues.has(pick.venue)).map(({ requestedBy, ...pick }) => pick));
}
