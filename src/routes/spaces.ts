import type { Request, Response } from "express";
import {
    getAvailability, getRooms, isoIn, parseDate, plainFree, plainSlot, spacesConfig, timeOn, type AreaError, type Room
} from "../spaces/availability.js";
import { MAX_DAYS, NOW_WINDOW_MS, SPACES, type SpacesConfig } from "../spaces/config.js";
import { addDays } from "../meals/sync.js";
import { getSchool } from "../schools.js";
import { queryParam } from "./params.js";

// Zotify Spaces: a public, read-only API for study rooms and when they're free, from the libraries' and housing's LibCal
// sites (see src/spaces/). Availability changes by the minute, so it's fetched from LibCal for almost every request and
// never cached by browsers
//
//   GET /v1/spaces                              schools with study spaces
//   GET /v1/spaces/:school                      locations and rooms: capacity, description, photo, where to book
//   GET /v1/spaces/:school/now                  rooms free now (from the next half hour), and soon, with how long for
//   GET /v1/spaces/:school/availability         every room's slots on a day (?date=)
//   GET /v1/spaces/:school/free                 rooms free for a whole stretch (?date=&from=14:00&to=16:00)
//   GET /v1/spaces/:school/rooms/:room          one room's slots over the next few days (?days=)
//
// Rooms can be narrowed with ?capacity= (at least that many people) and ?location= (IDs, comma-separated)

// How far ahead "soon" looks
const SOON_MS = 2 * 60 * 60 * 1000;

const live = (res: Response) => res.set("Cache-Control", "no-cache");

/** The school's config, or a 404 */
function schoolFor(req: Request, res: Response) {
    const id = String(req.params.school ?? "").toLowerCase();
    const config = spacesConfig(id);
    if (!config) res.status(404).json({ error: `There's no school "${id}" on Zotify Spaces.`, code: "not_found" });
    return config ? { id, config } : null;
}

/** ?capacity= and ?location= as a filter, or an error message */
function roomFilter(req: Request): ((room: Room) => boolean) | string {
    const capacity = queryParam(req, "capacity");
    const locations = queryParam(req, "location")?.toLowerCase().split(",").map(location => location.trim()).filter(Boolean);
    const least = capacity === undefined ? 0 : Number(capacity);

    if (!Number.isInteger(least) || least < 0) return "capacity must be a whole number of people.";
    return room => room.capacity >= least && (!locations?.length || locations.includes(room.location));
}

/** Answers with the availability, or 502 when LibCal couldn't answer for any of it */
function send(res: Response, body: Record<string, unknown>, errors: AreaError[], anything: boolean) {
    live(res);
    if (!anything && errors.length) {
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment.", errors });
        return;
    }
    res.json({ ...body, errors });
}

export function spacesIndex(_req: Request, res: Response) {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({
        schools: Object.entries(SPACES).map(([id, config]) => ({
            id,
            name: getSchool(id)?.name ?? id,
            timezone: config.timezone,
            sites: config.sites.map(site => ({ id: site.id, name: site.name, url: site.url }))
        }))
    });
}

/** Every location and room. Descriptions fill in over the first minute after the API starts */
export async function spacesSchool(req: Request, res: Response) {
    const found = schoolFor(req, res);
    if (!found) return;

    try {
        const { rooms, errors } = await getRooms(found.id, found.config);
        const locations = locationsOf(found.config, rooms);

        res.set("Cache-Control", "public, max-age=300");
        res.json({ school: found.id, timezone: found.config.timezone, locations, rooms, errors });
    } catch (error) {
        console.error("Couldn't load study spaces:", error);
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment." });
    }
}

function locationsOf(config: SpacesConfig, rooms: Room[]) {
    return config.sites.flatMap(site => site.areas.map(area => {
        const here = rooms.filter(room => room.location === area.id);
        return { id: area.id, name: here[0]?.locationName ?? area.name ?? area.id, shortName: area.shortName, site: site.id, siteName: site.name, url: site.url, rooms: here.length };
    }));
}

/**
 * Rooms free now: their next free stretch starts within NOW_WINDOW_MS (LibCal never lists a slot that's started), longest
 * first. soon lists rooms whose next free stretch starts within two hours
 */
export async function spacesNow(req: Request, res: Response) {
    const found = schoolFor(req, res);
    if (!found) return;
    const filter = roomFilter(req);
    if (typeof filter === "string") return void res.status(400).json({ error: filter, code: "invalid_request" });

    const { timezone } = found.config;
    const today = parseDate("today", timezone)!;
    const now = Date.now();

    try {
        // Tomorrow too, so stretches that run past midnight are whole
        const { availability, errors } = await getAvailability(found.id, found.config, today, addDays(today, 2), filter);

        const next = availability.flatMap(({ room, free }) => {
            const stretch = free.find(candidate => candidate.endMs > now);
            return stretch ? [{ room, stretch }] : [];
        });

        const describe = ({ room, stretch }: (typeof next)[number]) => ({
            ...room,
            freeFrom: stretch.start,
            freeUntil: stretch.end,
            minutes: Math.round((stretch.endMs - Math.max(now, stretch.startMs)) / 60_000),
            startsInMinutes: Math.max(0, Math.round((stretch.startMs - now) / 60_000))
        });

        const freeNow = next.filter(({ stretch }) => stretch.startMs <= now + NOW_WINDOW_MS).map(describe)
            .sort((a, b) => b.minutes - a.minutes);
        const soon = next.filter(({ stretch }) => stretch.startMs > now + NOW_WINDOW_MS && stretch.startMs <= now + SOON_MS).map(describe)
            .sort((a, b) => a.startsInMinutes - b.startsInMinutes || b.minutes - a.minutes);

        send(res, { at: isoIn(now, timezone), rooms: freeNow, soon }, errors, availability.length > 0);
    } catch (error) {
        console.error("Couldn't load study space availability:", error);
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment." });
    }
}

/** Every room's slots on one day: ?date= is today (the default), tomorrow, or YYYY-MM-DD */
export async function spacesDay(req: Request, res: Response) {
    const found = schoolFor(req, res);
    if (!found) return;
    const filter = roomFilter(req);
    if (typeof filter === "string") return void res.status(400).json({ error: filter, code: "invalid_request" });

    const date = parseDate(queryParam(req, "date"), found.config.timezone);
    if (!date) return void res.status(400).json({ error: "Use a date like 2026-10-21, or today or tomorrow.", code: "invalid_request" });

    try {
        const { availability, errors } = await getAvailability(found.id, found.config, date, addDays(date, 1), filter);
        send(res, {
            date,
            rooms: availability.map(({ room, slots, free }) => ({ ...room, slots: slots.map(plainSlot), free: free.map(plainFree) }))
        }, errors, availability.length > 0);
    } catch (error) {
        console.error("Couldn't load study space availability:", error);
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment." });
    }
}

/** Rooms free for the whole of ?from= to ?to= (like 14:00 and 16:00) on ?date=, with the free stretch that covers it */
export async function spacesFree(req: Request, res: Response) {
    const found = schoolFor(req, res);
    if (!found) return;
    const filter = roomFilter(req);
    if (typeof filter === "string") return void res.status(400).json({ error: filter, code: "invalid_request" });

    const { timezone } = found.config;
    const date = parseDate(queryParam(req, "date"), timezone);
    const from = date && timeOn(date, queryParam(req, "from") ?? "", timezone);
    const to = date && timeOn(date, queryParam(req, "to") ?? "", timezone);

    if (!date) return void res.status(400).json({ error: "Use a date like 2026-10-21, or today or tomorrow.", code: "invalid_request" });
    if (!from || !to || to <= from) return void res.status(400).json({ error: "Send from and to as times like 14:00 and 16:00, with to after from.", code: "invalid_request" });

    try {
        // The next day too, for stretches that run past midnight
        const { availability, errors } = await getAvailability(found.id, found.config, date, addDays(date, 2), filter);
        const rooms = availability.flatMap(({ room, free }) => {
            const stretch = free.find(candidate => candidate.startMs <= from && candidate.endMs >= to);
            return stretch ? [{ ...room, freeFrom: stretch.start, freeUntil: stretch.end, minutes: stretch.minutes }] : [];
        });

        send(res, { date, from: isoIn(from, timezone), to: isoIn(to, timezone), rooms }, errors, availability.length > 0);
    } catch (error) {
        console.error("Couldn't load study space availability:", error);
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment." });
    }
}

/** One room's slots over ?days= days from today (7 by default, at most MAX_DAYS) */
export async function spacesRoom(req: Request, res: Response) {
    const found = schoolFor(req, res);
    if (!found) return;

    const days = Number(queryParam(req, "days") ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return void res.status(400).json({ error: `days must be 1 to ${MAX_DAYS}.`, code: "invalid_request" });

    const id = String(req.params.room).toLowerCase();
    const today = parseDate("today", found.config.timezone)!;

    try {
        const { availability, errors } = await getAvailability(found.id, found.config, today, addDays(today, days), room => room.id === id);
        const entry = availability[0];

        if (!entry) {
            if (errors.length) return void send(res, {}, errors, false);
            return void res.status(404).json({ error: `There's no room "${id}".`, code: "not_found" });
        }

        const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
        send(res, {
            ...entry.room,
            days: dates.map(date => ({
                date,
                slots: entry.slots.filter(slot => slot.start.startsWith(date)).map(plainSlot),
                free: entry.free.filter(stretch => stretch.start.startsWith(date)).map(plainFree)
            }))
        }, errors, true);
    } catch (error) {
        console.error("Couldn't load study space availability:", error);
        res.status(502).json({ error: "Couldn't reach the booking sites. Try again in a moment." });
    }
}
