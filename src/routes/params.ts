import type { Request } from "express";
import type { VenueName } from "../accounts.js";

export const VENUES = ["anteatery", "brandywine"] as const satisfies readonly VenueName[];

/** A venue from a request, defaulting to Anteatery. Null when it isn't one we know */
export function parseVenue(value: unknown): VenueName | null {
    const venue = value ?? "anteatery";
    return VENUES.includes(venue as VenueName) ? venue as VenueName : null;
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
