export const VENUES = ["anteatery", "brandywine"];
/** A venue from a request, defaulting to Anteatery. Null when it isn't one we know */
export function parseVenue(value) {
    const venue = value ?? "anteatery";
    return VENUES.includes(venue) ? venue : null;
}
/** How many accounts should vote, from a request body. Undefined means all of them; null means it wasn't a whole number */
export function parseVoteCount(value) {
    if (value === undefined || value === null)
        return undefined;
    return Number.isInteger(value) ? value : null;
}
/** A query string parameter, trimmed. Undefined when missing, empty or repeated */
export function queryParam(req, name) {
    const value = req.query[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
//# sourceMappingURL=params.js.map