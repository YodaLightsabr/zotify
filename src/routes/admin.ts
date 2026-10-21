import type { Request, Response } from "express";
import { testAccountCodes } from "../auth.js";
import { snapshot } from "../db.js";
import { getHistory } from "../history.js";
import { getVenues } from "../schools.js";
import { getVersion } from "../version.js";
import { requestSchool } from "./params.js";

/** Whether each test account (like panteater) has an active login code. The code itself is only ever in the server console */
export async function adminTestAccounts(_req: Request, res: Response) {
    res.json(await testAccountCodes());
}

/** For anyone: the commit the API is running and when it was committed, e.g. to check a deploy went live. null if it can't be told */
export function publicVersion(_req: Request, res: Response) {
    const version = getVersion();
    res.json(version && { commit: version.commit, committedAt: version.committedAt });
}

/** Which commit the API is running, and when it was committed and deployed. null if it can't be told */
export function adminVersion(_req: Request, res: Response) {
    res.json(getVersion());
}

/** Every song queued through Zotify at the school's venues, newest first */
export async function adminHistory(_req: Request, res: Response) {
    const venues = new Set(getVenues(requestSchool(res).id).map(venue => venue.id));
    res.json((await getHistory()).filter(pick => venues.has(pick.venue)));
}

/** Everything Zotify stores, for the admin dashboard. Login codes and sessions are only ever stored as hashes */
export async function adminCache(_req: Request, res: Response) {
    res.json(snapshot());
}
