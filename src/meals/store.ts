import { db, transaction } from "../db.js";
import type { ScheduleEntry } from "./elevate.js";
import type { MenuItem } from "./items.js";

// Zotify Meals' copy of each school's menus, in the meal_* tables (see db.ts). Everything the API answers with comes from
// here, so answers are instant and keep working when the dining site is down. Nothing is ever deleted, so it's also a
// history of what was served

export interface Reference {
    timezone: string;
    allergens: { id: string, label: string }[];
    dietTags: { id: string, label: string, description: string | null }[];
    mealPeriods: { id: number, name: string, position: number }[];
}

export interface DiningLocation {
    // The Zotify venue it is, like "anteatery", and its key on the dining site, like "the-anteatery"
    id: string;
    key: string;
    name: string;
    // How far ahead the dining hall has published menus
    menusThrough: string | null;
    mealPeriods: { id: number, name: string }[];
    stations: { id: number, name: string }[];
    schedule: ScheduleEntry[] | null;
}

export type StoredStation = { id: number, skus: string[] };

const json = <T>(text: string | undefined): T | null => text ? JSON.parse(text) as T : null;

export function saveReference(schoolId: string, reference: Reference) {
    db.prepare("INSERT OR REPLACE INTO meal_reference (school_id, data, fetched_at) VALUES (?, ?, ?)").run(schoolId, JSON.stringify(reference), Date.now());
}

export function getReference(schoolId: string) {
    return json<Reference>((db.prepare("SELECT data FROM meal_reference WHERE school_id = ?").get(schoolId) as { data: string } | undefined)?.data);
}

export function saveLocation(schoolId: string, location: DiningLocation) {
    db.prepare("INSERT OR REPLACE INTO meal_locations (school_id, venue_id, data, fetched_at) VALUES (?, ?, ?, ?)")
        .run(schoolId, location.id, JSON.stringify(location), Date.now());
}

export function getLocation(schoolId: string, venueId: string) {
    return json<DiningLocation>((db.prepare("SELECT data FROM meal_locations WHERE school_id = ? AND venue_id = ?").get(schoolId, venueId) as { data: string } | undefined)?.data);
}

/** Saves one date and meal period's menu, and its items. stations is null when nothing was published for it */
export function saveMenu(schoolId: string, venueId: string, date: string, periodId: number, stations: StoredStation[] | null, items: MenuItem[]) {
    const saveItem = db.prepare(`
        INSERT INTO meal_items (school_id, sku, data, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (school_id, sku) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);

    transaction(() => {
        // A published menu is never replaced by "nothing published": the dining site can stop listing a meal once it's
        // over, and the history should keep what was served
        if (!stations) {
            const saved = db.prepare("SELECT status FROM meal_menus WHERE school_id = ? AND venue_id = ? AND date = ? AND period_id = ?")
                .get(schoolId, venueId, date, periodId) as { status: string } | undefined;
            if (saved?.status === "menu") return;
        }

        for (const item of items) saveItem.run(schoolId, item.sku, JSON.stringify(item), Date.now());
        db.prepare("INSERT OR REPLACE INTO meal_menus (school_id, venue_id, date, period_id, status, stations, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(schoolId, venueId, date, periodId, stations ? "menu" : "none", JSON.stringify(stations ?? []), Date.now());
    });
}

/** Every meal period's menu saved for a date at a location */
export function getMenus(schoolId: string, venueId: string, date: string) {
    return (db.prepare("SELECT period_id, status, stations, fetched_at FROM meal_menus WHERE school_id = ? AND venue_id = ? AND date = ?")
        .all(schoolId, venueId, date) as { period_id: number, status: string, stations: string, fetched_at: number }[])
        .map(row => ({ periodId: row.period_id, published: row.status === "menu", stations: JSON.parse(row.stations) as StoredStation[], fetchedAt: row.fetched_at }));
}

export function getItems(schoolId: string, skus: string[]) {
    if (!skus.length) return new Map<string, MenuItem>();

    const rows = db.prepare(`SELECT data FROM meal_items WHERE school_id = ? AND sku IN (${skus.map(() => "?").join(",")})`)
        .all(schoolId, ...skus) as { data: string }[];
    return new Map(rows.map(row => { const item = JSON.parse(row.data) as MenuItem; return [item.sku, item]; }));
}

/** Where and when an item is on the menu, among the menus kept */
export function getItemAppearances(schoolId: string, sku: string) {
    return (db.prepare(`
        SELECT venue_id, date, period_id, stations FROM meal_menus
        WHERE school_id = ? AND status = 'menu' AND stations LIKE ? ORDER BY date, venue_id, period_id
    `).all(schoolId, `%${JSON.stringify(sku)}%`) as { venue_id: string, date: string, period_id: number, stations: string }[])
        .flatMap(row => (JSON.parse(row.stations) as StoredStation[]).filter(station => station.skus.includes(sku))
            .map(station => ({ location: row.venue_id, date: row.date, periodId: row.period_id, stationId: station.id })));
}

/** The dates with menus saved, for a school, earliest first */
export function getDates(schoolId: string) {
    return (db.prepare("SELECT DISTINCT date FROM meal_menus WHERE school_id = ? ORDER BY date").all(schoolId) as { date: string }[]).map(row => row.date);
}
