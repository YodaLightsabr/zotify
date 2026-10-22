// Zotify Spaces: study rooms and their availability, from Springshare's LibCal sites (see libcal.ts). Everything about
// which sites and areas are included is here.
//
// LibCal, as of October 2026: each "location" (lid) has rooms, sorted into groups (gid). A location's public page,
// /spaces?lid=…&gid=…&c=0, lists its bookable rooms in its script (resources.push({ id: "eid_…", title, capacity, grouping,
// thumbnail… })) and names every location in a <select>. Availability comes from POST /spaces/availability/grid with lid, gid,
// eid=-1 and a start and end date (YYYY-MM-DD, end exclusive): every slot from now on for every room there, as
// { start, end, itemId, className }, in the site's timezone. No className means free; s-lc-eq-checkout is booked and
// s-lc-eq-r-unavailable (or -padding) can't be booked. Without a Referer header it answers 403. Slots that have started, and
// days past a room's booking window, aren't listed. The grid also lists rooms the public page doesn't (staff rooms,
// classrooms, equipment), which are left out

export interface SpaceArea {
    // LibCal's location and group IDs; gid 0 is every group at the location
    lid: number;
    gid: number;
    // Our ID for it, used in the API, like "langson"
    id: string;
    // Shown instead of LibCal's name, when that isn't clear on its own
    name?: string;
    // What people call it, like "Langson", for tight spots like the dashboard's footer
    shortName: string;
}

export interface SpaceSite {
    // Our ID for the site, which prefixes room IDs, like "lib-44696"
    id: string;
    name: string;
    url: string;
    areas: SpaceArea[];
}

export interface SpacesConfig {
    timezone: string;
    sites: SpaceSite[];
}

export const SPACES: Record<string, SpacesConfig> = {
    uci: {
        timezone: "America/Los_Angeles",
        sites: [
            {
                id: "lib",
                name: "UCI Libraries",
                url: "https://spaces.lib.uci.edu",
                areas: [
                    { lid: 6539, gid: 0, id: "langson", shortName: "Langson" },
                    { lid: 6579, gid: 0, id: "gateway", shortName: "Gateway" },
                    { lid: 6580, gid: 0, id: "science", shortName: "Science Library" },
                    { lid: 6581, gid: 0, id: "mrc", shortName: "Multimedia" },
                    { lid: 12189, gid: 0, id: "grunigen", shortName: "Grunigen" }
                ]
            },
            {
                id: "hsg",
                name: "UCI Student Housing",
                url: "https://spaces.hsg.uci.edu",
                areas: [
                    { lid: 7337, gid: 13002, id: "upper-mesa", name: "Mesa Court (Upper Mesa)", shortName: "Upper Mesa" },
                    { lid: 7337, gid: 53431, id: "oasis", name: "The Oasis Community Center", shortName: "Oasis" }
                ]
            }
        ]
    }
};

// Availability changes all the time, so it's barely cached: the same request within this long shares one answer from LibCal,
// which keeps a crowd of dashboards from multiplying requests
export const AVAILABILITY_CACHE_MS = 15_000;
// Rooms, names and descriptions hardly ever change
export const ROOMS_CACHE_MS = 6 * 60 * 60 * 1000;

// "Free now" counts rooms whose next free slot starts within this long. LibCal never lists a slot once it's started, so a
// room that's free right now shows as free from the next half hour
export const NOW_WINDOW_MS = 30 * 60 * 1000;
// How many days a room's own page shows
export const MAX_DAYS = 14;

// Being polite to LibCal
export const MAX_CONCURRENT_REQUESTS = 4;
export const REQUEST_TIMEOUT_MS = 15_000;
export const USER_AGENT = "ZotifySpaces/1.0 (+https://www.zotify.app)";
