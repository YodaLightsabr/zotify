import { db, transaction } from "../db.js";
const json = (text) => text ? JSON.parse(text) : null;
export function saveReference(schoolId, reference) {
    db.prepare("INSERT OR REPLACE INTO meal_reference (school_id, data, fetched_at) VALUES (?, ?, ?)").run(schoolId, JSON.stringify(reference), Date.now());
}
export function getReference(schoolId) {
    return json(db.prepare("SELECT data FROM meal_reference WHERE school_id = ?").get(schoolId)?.data);
}
export function saveLocation(schoolId, location) {
    db.prepare("INSERT OR REPLACE INTO meal_locations (school_id, venue_id, data, fetched_at) VALUES (?, ?, ?, ?)")
        .run(schoolId, location.id, JSON.stringify(location), Date.now());
}
export function getLocation(schoolId, venueId) {
    return json(db.prepare("SELECT data FROM meal_locations WHERE school_id = ? AND venue_id = ?").get(schoolId, venueId)?.data);
}
/** Saves one date and meal period's menu, and its items. stations is null when nothing was published for it */
export function saveMenu(schoolId, venueId, date, periodId, stations, items) {
    const saveItem = db.prepare(`
        INSERT INTO meal_items (school_id, sku, data, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (school_id, sku) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    transaction(() => {
        for (const item of items)
            saveItem.run(schoolId, item.sku, JSON.stringify(item), Date.now());
        db.prepare("INSERT OR REPLACE INTO meal_menus (school_id, venue_id, date, period_id, status, stations, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(schoolId, venueId, date, periodId, stations ? "menu" : "none", JSON.stringify(stations ?? []), Date.now());
    });
}
/** Every meal period's menu saved for a date at a location */
export function getMenus(schoolId, venueId, date) {
    return db.prepare("SELECT period_id, status, stations, fetched_at FROM meal_menus WHERE school_id = ? AND venue_id = ? AND date = ?")
        .all(schoolId, venueId, date)
        .map(row => ({ periodId: row.period_id, published: row.status === "menu", stations: JSON.parse(row.stations), fetchedAt: row.fetched_at }));
}
export function getItems(schoolId, skus) {
    if (!skus.length)
        return new Map();
    const rows = db.prepare(`SELECT data FROM meal_items WHERE school_id = ? AND sku IN (${skus.map(() => "?").join(",")})`)
        .all(schoolId, ...skus);
    return new Map(rows.map(row => { const item = JSON.parse(row.data); return [item.sku, item]; }));
}
/** Where and when an item is on the menu, among the menus kept */
export function getItemAppearances(schoolId, sku) {
    return db.prepare(`
        SELECT venue_id, date, period_id, stations FROM meal_menus
        WHERE school_id = ? AND status = 'menu' AND stations LIKE ? ORDER BY date, venue_id, period_id
    `).all(schoolId, `%${JSON.stringify(sku)}%`)
        .flatMap(row => JSON.parse(row.stations).filter(station => station.skus.includes(sku))
        .map(station => ({ location: row.venue_id, date: row.date, periodId: row.period_id, stationId: station.id })));
}
/** The dates with menus saved, for a school, earliest first */
export function getDates(schoolId) {
    return db.prepare("SELECT DISTINCT date FROM meal_menus WHERE school_id = ? ORDER BY date").all(schoolId).map(row => row.date);
}
/** Drops menus from before a date, and items no menu uses anymore */
export function prune(schoolId, before) {
    transaction(() => {
        db.prepare("DELETE FROM meal_menus WHERE school_id = ? AND date < ?").run(schoolId, before);
        const used = new Set(db.prepare("SELECT stations FROM meal_menus WHERE school_id = ?").all(schoolId)
            .flatMap(row => JSON.parse(row.stations).flatMap(station => station.skus)));
        const stale = db.prepare("SELECT sku FROM meal_items WHERE school_id = ?").all(schoolId).filter(row => !used.has(row.sku));
        const drop = db.prepare("DELETE FROM meal_items WHERE school_id = ? AND sku = ?");
        for (const row of stale)
            drop.run(schoolId, row.sku);
    });
}
//# sourceMappingURL=store.js.map