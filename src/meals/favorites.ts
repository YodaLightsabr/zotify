import { db } from "../db.js";
import type { MenuItem } from "./items.js";
import { getLocation, getReference, type StoredStation } from "./store.js";
import { todayIn } from "./sync.js";

// Dishes people star on Zotify Meals, and when each is next served. Favorites are by recipe, so a dish counts wherever
// and whenever it's served, under whichever SKU

export interface Favorite {
    recipeId: string;
    name: string;
    addedAt: number;
}

export function getFavorites(email: string, schoolId: string): Favorite[] {
    return (db.prepare("SELECT recipe_id, name, added_at FROM meal_favorites WHERE email = ? AND school_id = ? ORDER BY added_at DESC")
        .all(email, schoolId) as { recipe_id: string, name: string, added_at: number }[])
        .map(row => ({ recipeId: row.recipe_id, name: row.name, addedAt: row.added_at }));
}

export function addFavorite(email: string, schoolId: string, recipeId: string, name: string) {
    db.prepare("INSERT OR IGNORE INTO meal_favorites (email, school_id, recipe_id, name, added_at) VALUES (?, ?, ?, ?, ?)")
        .run(email, schoolId, recipeId, name, Date.now());
}

export function removeFavorite(email: string, schoolId: string, recipeId: string) {
    db.prepare("DELETE FROM meal_favorites WHERE email = ? AND school_id = ? AND recipe_id = ?").run(email, schoolId, recipeId);
}

export interface Serving {
    date: string;
    location: string;
    locationName: string;
    periodId: number;
    period: string;
    stationId: number;
    station: string;
}

/** When each of these recipes is served from today on, soonest first, across the school's halls and meal periods */
export function upcomingServings(schoolId: string, recipeIds: string[]) {
    const servings = new Map<string, Serving[]>(recipeIds.map(id => [id, []]));
    const reference = getReference(schoolId);
    if (!reference || !recipeIds.length) return servings;

    // Each recipe's SKUs, then every upcoming menu that has one
    const wanted = new Set(recipeIds);
    const recipeOf = new Map<string, string>();
    for (const row of db.prepare("SELECT sku, data FROM meal_items WHERE school_id = ?").all(schoolId) as { sku: string, data: string }[]) {
        const recipeId = (JSON.parse(row.data) as MenuItem).recipeId;
        if (recipeId && wanted.has(recipeId)) recipeOf.set(row.sku, recipeId);
    }

    const periods = new Map(reference.mealPeriods.map(period => [period.id, period]));
    const menus = db.prepare(`
        SELECT venue_id, date, period_id, stations FROM meal_menus WHERE school_id = ? AND status = 'menu' AND date >= ? ORDER BY date
    `).all(schoolId, todayIn(reference.timezone)) as { venue_id: string, date: string, period_id: number, stations: string }[];

    for (const menu of menus) {
        const location = getLocation(schoolId, menu.venue_id);

        for (const station of JSON.parse(menu.stations) as StoredStation[]) {
            const found = new Set(station.skus.map(sku => recipeOf.get(sku)).filter((id): id is string => !!id));

            for (const recipeId of found) {
                servings.get(recipeId)!.push({
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
