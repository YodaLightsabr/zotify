import { MAX_CONCURRENT_REQUESTS, REQUEST_TIMEOUT_MS, USER_AGENT, type SpaceArea, type SpaceSite } from "./config.js";

// A small client for LibCal's public booking pages (see config.ts for how they work). Requests are limited to a few at once,
// and every failure is a LibCalError, so one site being down doesn't take the others with it

export class LibCalError extends Error {
    constructor (message: string) {
        super(message);
        this.name = "LibCalError";
    }
}

let active = 0;
const waiting: (() => void)[] = [];

async function request(site: SpaceSite, path: string, init: RequestInit = {}) {
    if (active >= MAX_CONCURRENT_REQUESTS) await new Promise<void>(resolve => waiting.push(resolve));
    active++;

    try {
        const response = await fetch(`${site.url}${path}`, {
            ...init,
            // LibCal answers 403 without a Referer from its own site
            headers: { "User-Agent": USER_AGENT, Referer: `${site.url}/`, "X-Requested-With": "XMLHttpRequest", ...init.headers },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (!response.ok) throw new LibCalError(`${site.name} answered ${response.status}`);
        return await response.text();
    } catch (error) {
        throw error instanceof LibCalError ? error : new LibCalError(`Couldn't reach ${site.name}: ${(error as Error).message}`);
    } finally {
        active--;
        waiting.shift()?.();
    }
}

// Reading HTML

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

const decode = (text: string) => text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, code: string) =>
    code[0] === "#" ? String.fromCodePoint(parseInt(code.slice(code[1] === "x" ? 2 : 1), code[1] === "x" ? 16 : 10)) : ENTITIES[code] ?? entity);

/** Plain text from a bit of HTML: list items as "• " lines, paragraphs on their own lines */
function htmlText(html: string) {
    return decode(html
        .replace(/<li[^>]*>/gi, "\n• ")
        .replace(/<(br|\/p|\/div|\/h\d|\/ul|\/li)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, ""))
        .split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

/** A string from LibCal's inline script, which escapes everything as \uXXXX */
const scriptString = (text: string) => JSON.parse(`"${text.replace(/\t/g, "\\t")}"`) as string;

export interface LibCalRoom {
    eid: number;
    name: string;
    capacity: number;
    // LibCal's group, like "LL Collaboration Zone (360)"
    group: string;
    image: string | null;
}

/** An area's public rooms and the location's name, from its booking page */
export async function fetchArea(site: SpaceSite, area: SpaceArea) {
    const html = await request(site, `/spaces?lid=${area.lid}&gid=${area.gid}&c=0`);

    const names = new Map([...html.matchAll(/resourceNameIdMap\["eid_(\d+)"\] = "([^"]*)"/g)].map(match => [Number(match[1]), scriptString(match[2])]));
    const rooms: LibCalRoom[] = [...html.matchAll(/resources\.push\(\{([\s\S]*?)\}\);/g)].flatMap(([, body]) => {
        const field = (name: string) => body.match(new RegExp(`\\b${name}: ("(?:[^"\\\\]|\\\\.)*"|-?\\d+)`))?.[1];
        const eid = Number(field("eid"));
        const title = field("title");
        if (!eid || !title) return [];

        const image = field("thumbnail");
        return [{
            eid,
            name: names.get(eid) ?? scriptString(title.slice(1, -1)).replace(/\s*\(Capacity \d+\)$/, ""),
            capacity: Number(field("capacity")) || 0,
            group: scriptString((field("grouping") ?? "\"\"").slice(1, -1)).trim(),
            image: image ? scriptString(image.slice(1, -1)) || null : null
        }];
    });

    if (!rooms.length) throw new LibCalError(`${site.name} listed no rooms for location ${area.lid}`);

    // The location's name is in the location picker
    const location = html.match(new RegExp(`<option value="${area.lid}"[^>]*>([^<]*)`))?.[1];
    return { rooms, locationName: location ? decode(location).trim() : null };
}

/** A room's description and directions, from its own page, as plain text. Either can be null */
export async function fetchRoomDetails(site: SpaceSite, eid: number) {
    const html = await request(site, `/space/${eid}`);
    const section = (name: string) => {
        const match = html.match(new RegExp(`class="s-lc-section-${name}"[^>]*>([\\s\\S]*?)</div>`));
        // Leave out the section's heading, and paragraphs that are only a link, like "Additional Photos"
        const body = match?.[1].replace(/<h2[\s\S]*?<\/h2>/i, "").replace(/<p>\s*<a [^>]*>[^<]*<\/a>\s*<\/p>/gi, "");
        const text = body ? htmlText(body) : "";
        return text || null;
    };

    return { description: section("description"), directions: section("directions") };
}

export type SlotStatus = "available" | "booked" | "unavailable";

export interface LibCalSlot {
    eid: number;
    // In the site's timezone, like "2026-10-21 12:30:00"
    start: string;
    end: string;
    status: SlotStatus;
}

/** Every slot for an area's rooms from start up to (not including) end, both YYYY-MM-DD in the site's timezone */
export async function fetchSlots(site: SpaceSite, area: SpaceArea, start: string, end: string): Promise<LibCalSlot[]> {
    const body = new URLSearchParams({
        lid: String(area.lid), gid: String(area.gid), eid: "-1", seat: "0", seatId: "0", zone: "0",
        start, end, pageIndex: "0", pageSize: "500"
    });

    const text = await request(site, "/spaces/availability/grid", { method: "POST", body });

    let data: { slots?: { start: string, end: string, itemId: number, className?: string }[] };
    try {
        data = JSON.parse(text);
    } catch {
        throw new LibCalError(`${site.name} answered with something other than JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
    }

    return (data.slots ?? []).map(slot => ({
        eid: slot.itemId,
        start: slot.start,
        end: slot.end,
        // Pending bookings (s-lc-eq-pending) are as good as booked
        status: !slot.className ? "available" : /checkout|pending/.test(slot.className) ? "booked" : "unavailable"
    }));
}
