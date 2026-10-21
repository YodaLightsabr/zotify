import type { NextFunction, Request, Response } from "express";
import type { VenueName } from "../accounts.js";
import { getSchool, getVenue, mainSchool, schoolForOrigin, type School } from "../schools.js";

/**
 * The school a request is about: the one in its path (/v1/schools/:school, or the school of /v1/venues/:venue), otherwise the
 * one whose site it came from, which decides things like how sign-in reads IDs
 */
export const requestSchool = (res: Response): School => res.locals.school ?? mainSchool();

/** Which school's site a request came from, by its Origin header. Requests from anywhere else count as the main school's */
export const schoolOfRequest = (req: Request) => schoolForOrigin(req.headers.origin) ?? mainSchool();

/** The venue in a request's path (see venueParam) */
export const requestVenue = (res: Response): VenueName => res.locals.venue;

/** For routes under /v1/venues/:venue: 404 for a venue that doesn't exist, otherwise it and its school go on res.locals */
export function venueParam(req: Request, res: Response, next: NextFunction) {
    const venue = getVenue(req.params.venue);

    if (!venue) {
        res.status(404).json({ error: `There's no venue "${req.params.venue}"`, code: "not_found" });
        return;
    }

    res.locals.venue = venue.id;
    res.locals.school = getSchool(venue.schoolId);
    next();
}

/** For routes under /v1/schools/:school: 404 for a school that doesn't exist, otherwise it goes on res.locals */
export function schoolParam(req: Request, res: Response, next: NextFunction) {
    const school = getSchool(String(req.params.school));

    if (!school) {
        res.status(404).json({ error: `There's no school "${req.params.school}"`, code: "not_found" });
        return;
    }

    res.locals.school = school;
    next();
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
