import type { Request, Response } from "express";
import type { VenueName } from "../accounts.js";
import { getVenues, mainSchool, schoolForOrigin, type School } from "../schools.js";

/** The school a request is for, from the frontend it came from (see attachSchool in server.ts) */
export const requestSchool = (res: Response): School => res.locals.school ?? mainSchool();

/** Which school's site a request came from, by its Origin header. Requests from anywhere else count as the main school's */
export const schoolOfRequest = (req: Request) => schoolForOrigin(req.headers.origin) ?? mainSchool();

/**
 * A venue from a request, defaulting to the school's first. Null when it isn't one of the school's venues, so one school's
 * site can't reach another's
 */
export function parseVenue(value: unknown, res: Response): VenueName | null {
    const venues = getVenues(requestSchool(res).id);
    if (value === undefined || value === null) return venues[0]?.id ?? null;
    return venues.some(venue => venue.id === value) ? value as VenueName : null;
}

/** How many accounts should vote, from a request body. Undefined means all of them; null means it wasn't a whole number */
export function parseVoteCount(value: unknown): number | undefined | null {
    if (value === undefined || value === null) return undefined;
    return Number.isInteger(value) ? value as number : null;
}

/** A query string parameter, trimmed. Undefined when missing, empty or repeated */
export function queryParam(req: Request, name: string): string | undefined {
    const value = req.query[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
