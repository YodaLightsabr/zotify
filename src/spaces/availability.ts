import { db, transaction } from "../db.js";
import { addDays, todayIn } from "../meals/sync.js";
import { AVAILABILITY_CACHE_MS, ROOMS_CACHE_MS, SPACES, type SpaceArea, type SpaceSite, type SpacesConfig } from "./config.js";
import { fetchArea, fetchRoomDetails, fetchSlots, LibCalError, type LibCalSlot, type SlotStatus } from "./libcal.js";

// Rooms and their availability, as the API gives them. Rooms are kept for hours; availability is fetched from LibCal for
// nearly every request (see AVAILABILITY_CACHE_MS). Times go out as ISO 8601 with the school's offset, like
// 2026-10-21T14:30:00-07:00

export interface Room {
    // The site's ID and LibCal's, like "lib-44696"
    id: string;
    name: string;
    capacity: number;
    // The area's ID, like "langson"
    location: string;
    locationName: string;
    // What people call it, like "Langson"
    locationShortName: string;
    // LibCal's group within the location, like "LL Collaboration Zone (360)"
    group: string;
    image: string | null;
    description: string | null;
    directions: string | null;
    // Where to book it
    bookingUrl: string;
}

export interface Slot {
    start: string;
    end: string;
    status: SlotStatus;
}

export interface FreeTime {
    start: string;
    end: string;
    minutes: number;
}

/** An area that couldn't be reached, so its rooms are missing from an answer */
export interface AreaError {
    location: string;
    error: string;
}

export const spacesConfig = (id: string): SpacesConfig | undefined => SPACES[id.toLowerCase()];

// Time

// Answers have thousands of slots, and making a formatter is slow, so there's one per timezone, and offsets are remembered
// for each quarter hour (no timezone changes offset between them)
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** How far ahead of UTC a timezone is at a moment, in milliseconds */
function offsetAt(ms: number, timeZone: string) {
    const key = `${timeZone}|${Math.floor(ms / QUARTER_HOUR_MS)}`;
    const known = offsets.get(key);
    if (known !== undefined) return known;

    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-US", {
            timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
        formatters.set(timeZone, formatter);
    }

    const parts = Object.fromEntries(formatter.formatToParts(ms).map(part => [part.type, Number(part.value)]));
    const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;

    if (offsets.size > 50_000) offsets.clear();
    offsets.set(key, offset);
    return offset;
}

/** A local time like "2026-10-21 14:30:00" in a timezone, as milliseconds since 1970 */
function localMs(local: string, timeZone: string) {
    const [y, mo, d, h, mi, s] = local.split(/[-: T]/).map(Number);
    const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    const guess = asUtc - offsetAt(asUtc, timeZone);
    // Near a daylight saving change the first guess can be an hour out
    return asUtc - offsetAt(guess, timeZone);
}

/** Milliseconds since 1970 as ISO 8601 in a timezone, like 2026-10-21T14:30:00-07:00 */
export function isoIn(ms: number, timeZone: string) {
    const offset = offsetAt(ms, timeZone);
    const local = new Date(ms + offset).toISOString().slice(0, 19);
    const minutes = Math.abs(offset) / 60_000;
    return `${local}${offset < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "today", "tomorrow" or YYYY-MM-DD as a date in the school's timezone; null if it's none of those */
export function parseDate(value: unknown, timeZone: string) {
    const today = todayIn(timeZone);
    if (value === undefined || value === "today") return today;
    if (value === "tomorrow") return addDays(today, 1);
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** "14:30" on a date in the school's timezone, as milliseconds since 1970. "24:00" is midnight at the end of the day */
export function timeOn(date: string, time: string, timeZone: string) {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[1]) > 24 || Number(match[2]) > 59) return null;
    return localMs(`${date} 00:00:00`, timeZone) + (Number(match[1]) * 60 + Number(match[2])) * 60_000;
}

// Rooms

interface RoomsCache {
    rooms: Room[];
    errors: AreaError[];
    fetchedAt: number;
}

const roomsCache = new Map<string, RoomsCache>();
const roomsLoading = new Map<string, Promise<RoomsCache>>();
// Descriptions are fetched once per room, in the background, since each is a page of its own
const details = new Map<string, { description: string | null, directions: string | null }>();
const detailsLoading = new Set<string>();

const areaName = (area: SpaceArea, locationName: string | null, group: string) => area.name ?? (area.gid ? group : locationName) ?? area.id;

async function loadRooms(schoolId: string, config: SpacesConfig): Promise<RoomsCache> {
    const previous = roomsCache.get(schoolId);
    const errors: AreaError[] = [];

    const areas = await Promise.all(config.sites.flatMap(site => site.areas.map(async area => {
        try {
            const { rooms, locationName } = await fetchArea(site, area);
            return rooms.map((room): Room => {
                const id = `${site.id}-${room.eid}`;
                return {
                    id,
                    name: room.name,
                    capacity: room.capacity,
                    location: area.id,
                    locationName: areaName(area, locationName, room.group),
                    locationShortName: area.shortName,
                    group: room.group,
                    image: room.image,
                    description: details.get(id)?.description ?? null,
                    directions: details.get(id)?.directions ?? null,
                    bookingUrl: `${site.url}/space/${room.eid}`
                };
            });
        } catch (error) {
            // Keep showing what we had for it
            errors.push({ location: area.id, error: (error as Error).message });
            return previous?.rooms.filter(room => room.location === area.id) ?? [];
        }
    })));

    const result = { rooms: areas.flat(), errors, fetchedAt: Date.now() };
    if (errors.length) console.error("Couldn't load some study spaces:", errors.map(error => `${error.location}: ${error.error}`).join("; "));
    if (result.rooms.length) roomsCache.set(schoolId, result);
    loadDetails(config, result.rooms);
    return result;
}

/** Fills in rooms' descriptions and directions, a few at a time, without holding anything up */
function loadDetails(config: SpacesConfig, rooms: Room[]) {
    for (const room of rooms) {
        if (details.has(room.id) || detailsLoading.has(room.id)) continue;

        const site = config.sites.find(candidate => room.id.startsWith(`${candidate.id}-`))!;
        detailsLoading.add(room.id);
        fetchRoomDetails(site, Number(room.id.slice(site.id.length + 1)))
            .then(found => {
                details.set(room.id, found);
                Object.assign(room, found);
            })
            .catch(error => console.error(`Couldn't read ${room.name}'s description:`, error.message))
            .finally(() => detailsLoading.delete(room.id));
    }
}

/** A school's rooms, from cache when it's fresh. Concurrent first loads share one */
export async function getRooms(schoolId: string, config: SpacesConfig) {
    const cached = roomsCache.get(schoolId);
    if (cached && Date.now() - cached.fetchedAt < ROOMS_CACHE_MS) return cached;

    let loading = roomsLoading.get(schoolId);
    if (!loading) {
        loading = loadRooms(schoolId, config).finally(() => roomsLoading.delete(schoolId));
        roomsLoading.set(schoolId, loading);
    }

    // With rooms already cached, refresh in the background and answer with them now
    if (cached) return cached;
    return loading;
}

// Availability

const slotsCache = new Map<string, { slots: Promise<LibCalSlot[]>, fetchedAt: number }>();

const saveSlot = db.prepare(`
    INSERT INTO space_slots (room, start_ms, end_ms, status, observed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (room, start_ms) DO UPDATE SET end_ms = excluded.end_ms, status = excluded.status, observed_at = excluded.observed_at
`);

/** Saves every slot just fetched, so once LibCal stops listing one, how it last looked is still known */
function recordSlots(site: SpaceSite, slots: LibCalSlot[], timeZone: string) {
    const now = Date.now();
    transaction(() => {
        for (const slot of slots) saveSlot.run(`${site.id}-${slot.eid}`, localMs(slot.start, timeZone), localMs(slot.end, timeZone), slot.status, now);
    });
}

/** An area's slots from start up to end, shared by requests within AVAILABILITY_CACHE_MS of each other. Fresh ones are recorded */
function areaSlots(site: SpaceSite, area: SpaceArea, start: string, end: string, timeZone: string) {
    const key = `${site.url}|${area.lid}|${area.gid}|${start}|${end}`;
    const cached = slotsCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < AVAILABILITY_CACHE_MS) return cached.slots;

    // Forget old answers now and then
    for (const [old, entry] of slotsCache) if (Date.now() - entry.fetchedAt > AVAILABILITY_CACHE_MS) slotsCache.delete(old);

    const slots = fetchSlots(site, area, start, end);
    slotsCache.set(key, { slots, fetchedAt: Date.now() });
    slots.then(fetched => recordSlots(site, fetched, timeZone)).catch(error => {
        if (!(error instanceof LibCalError)) console.error("Couldn't record study space availability:", error);
    });
    slots.catch(() => slotsCache.delete(key));
    return slots;
}

export interface RoomAvailability {
    room: Room;
    // Every slot, in order: what LibCal lists, and before that, slots that have started as they were last seen (past)
    slots: (Slot & { startMs: number, endMs: number, past?: true })[];
    // Back-to-back free slots joined into stretches. Only slots that can still be booked count
    free: (FreeTime & { startMs: number, endMs: number })[];
}

/** Slots LibCal no longer lists, as last recorded, for these rooms from one time up to another */
function recordedSlots(rooms: string[], from: number, to: number) {
    if (!rooms.length || to <= from) return new Map<string, { startMs: number, endMs: number, status: SlotStatus }[]>();

    const rows = db.prepare(`
        SELECT room, start_ms, end_ms, status FROM space_slots
        WHERE room IN (${rooms.map(() => "?").join(", ")}) AND start_ms >= ? AND start_ms < ?
    `).all(...rooms, from, to) as { room: string, start_ms: number, end_ms: number, status: SlotStatus }[];

    const byRoom = new Map<string, { startMs: number, endMs: number, status: SlotStatus }[]>();
    for (const row of rows) byRoom.set(row.room, [...(byRoom.get(row.room) ?? []), { startMs: row.start_ms, endMs: row.end_ms, status: row.status }]);
    return byRoom;
}

/**
 * Every room's availability from start up to end (YYYY-MM-DD, end exclusive), for the rooms matching filter. Areas that
 * LibCal couldn't answer for are in errors, and their rooms are left out
 */
export async function getAvailability(schoolId: string, config: SpacesConfig, start: string, end: string, filter: (room: Room) => boolean = () => true) {
    const { rooms, errors: roomErrors } = await getRooms(schoolId, config);
    const wanted = rooms.filter(filter);
    const errors: AreaError[] = [];
    const tz = config.timezone;

    // Only areas with a wanted room are asked
    const areas = config.sites.flatMap(site => site.areas.filter(area => wanted.some(room => room.location === area.id)).map(area => ({ site, area })));
    const slotsByRoom = new Map<string, LibCalSlot[]>();

    await Promise.all(areas.map(async ({ site, area }) => {
        try {
            for (const slot of await areaSlots(site, area, start, end, tz)) {
                const id = `${site.id}-${slot.eid}`;
                slotsByRoom.set(id, [...(slotsByRoom.get(id) ?? []), slot]);
            }
        } catch (error) {
            errors.push({ location: area.id, error: (error as LibCalError).message });
        }
    }));

    // Rooms whose availability couldn't be fetched are left out. An area whose room list couldn't be refreshed still has
    // the rooms from before, so it's only reported
    const failed = new Set(errors.map(error => error.location));
    errors.push(...roomErrors.filter(error => !failed.has(error.location)));

    // Slots in the range that have already started come from the record
    const shown = wanted.filter(room => !failed.has(room.location));
    const past = recordedSlots(shown.map(room => room.id), localMs(`${start} 00:00:00`, tz), Math.min(Date.now(), localMs(`${end} 00:00:00`, tz)));

    const availability = shown.map((room): RoomAvailability => {
        const live = (slotsByRoom.get(room.id) ?? []).map(slot => ({ startMs: localMs(slot.start, tz), endMs: localMs(slot.end, tz), status: slot.status }));
        const listed = new Set(live.map(slot => slot.startMs));
        const recorded = (past.get(room.id) ?? []).filter(slot => !listed.has(slot.startMs)).map(slot => ({ ...slot, past: true as const }));

        const slots = [...recorded, ...live]
            .sort((a, b) => a.startMs - b.startMs)
            .map(slot => ({ ...slot, start: isoIn(slot.startMs, tz), end: isoIn(slot.endMs, tz) }));

        const free: RoomAvailability["free"] = [];
        for (const slot of slots) {
            if (slot.status !== "available" || "past" in slot) continue;
            const last = free.at(-1);
            if (last && last.endMs === slot.startMs) last.endMs = slot.endMs;
            else free.push({ startMs: slot.startMs, endMs: slot.endMs, start: "", end: "", minutes: 0 });
        }
        for (const stretch of free) Object.assign(stretch, { start: isoIn(stretch.startMs, tz), end: isoIn(stretch.endMs, tz), minutes: (stretch.endMs - stretch.startMs) / 60_000 });

        return { room, slots, free };
    });

    return { availability, errors };
}

/** Leaves out the millisecond fields used for working things out. past marks slots that have started, as they were last seen */
export const plainSlot = ({ start, end, status, past }: Slot & { past?: true }) => ({ start, end, status, ...(past ? { past } : {}) });

// How often today's availability is fetched in the background, so the record is never more than this out of date when a
// slot starts, even with nobody looking
const RECORD_EVERY_MS = 5 * 60 * 1000;

/** Keeps the record of every school's availability going: today's, every RECORD_EVERY_MS */
export function startSpacesRecorder() {
    const record = () => {
        for (const config of Object.values(SPACES)) {
            const today = todayIn(config.timezone);
            for (const site of config.sites) {
                for (const area of site.areas) {
                    areaSlots(site, area, today, addDays(today, 1), config.timezone)
                        .catch(error => console.warn(`Couldn't record ${area.id}'s availability:`, (error as Error).message));
                }
            }
        }
    };

    record();
    setInterval(record, RECORD_EVERY_MS);
}
export const plainFree = ({ start, end, minutes }: FreeTime) => ({ start, end, minutes });
