import { db } from "../db.js";
import { getLocation, getReference } from "./store.js";
import { todayIn } from "./sync.js";
export function getFavorites(email, schoolId) {
    return db.prepare("SELECT recipe_id, name, added_at FROM meal_favorites WHERE email = ? AND school_id = ? ORDER BY added_at DESC")
        .all(email, schoolId)
        .map(row => ({ recipeId: row.recipe_id, name: row.name, addedAt: row.added_at }));
}
export function addFavorite(email, schoolId, recipeId, name) {
    db.prepare("INSERT OR IGNORE INTO meal_favorites (email, school_id, recipe_id, name, added_at) VALUES (?, ?, ?, ?, ?)")
        .run(email, schoolId, recipeId, name, Date.now());
}
export function removeFavorite(email, schoolId, recipeId) {
    db.prepare("DELETE FROM meal_favorites WHERE email = ? AND school_id = ? AND recipe_id = ?").run(email, schoolId, recipeId);
}
/** When each of these recipes is served from today on, soonest first, across the school's halls and meal periods */
export function upcomingServings(schoolId, recipeIds) {
    const servings = new Map(recipeIds.map(id => [id, []]));
    const reference = getReference(schoolId);
    if (!reference || !recipeIds.length)
        return servings;
    // Each recipe's SKUs, then every upcoming menu that has one
    const wanted = new Set(recipeIds);
    const recipeOf = new Map();
    for (const row of db.prepare("SELECT sku, data FROM meal_items WHERE school_id = ?").all(schoolId)) {
        const recipeId = JSON.parse(row.data).recipeId;
        if (recipeId && wanted.has(recipeId))
            recipeOf.set(row.sku, recipeId);
    }
    const periods = new Map(reference.mealPeriods.map(period => [period.id, period]));
    const menus = db.prepare(`
        SELECT venue_id, date, period_id, stations FROM meal_menus WHERE school_id = ? AND status = 'menu' AND date >= ? ORDER BY date
    `).all(schoolId, todayIn(reference.timezone));
    for (const menu of menus) {
        const location = getLocation(schoolId, menu.venue_id);
        for (const station of JSON.parse(menu.stations)) {
            const found = new Set(station.skus.map(sku => recipeOf.get(sku)).filter((id) => !!id));
            for (const recipeId of found) {
                servings.get(recipeId).push({
                    date: menu.date,
                    location: menu.venue_id,
                    locationName: location?.name ?? menu.venue_id,
                    periodId: menu.period_id,
                    period: periods.get(menu.period_id)?.name ?? `Meal period ${menu.period_id}`,
                    stationId: station.id,
                    station: location?.stations.find(candidate => candidate.id === station.id)?.name.trim() ?? `Station ${station.id}`
                });
            }
        }
    }
    // Soonest first: by date, then the order meal periods happen in
    for (const list of servings.values()) {
        list.sort((a, b) => a.date.localeCompare(b.date) || (periods.get(a.periodId)?.position ?? 0) - (periods.get(b.periodId)?.position ?? 0));
    }
    return servings;
}
//# sourceMappingURL=favorites.js.map