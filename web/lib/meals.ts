"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { API_URL } from "./config";
import { apiFetch, postJson } from "./api";
import { useUser } from "./user";

// Zotify Meals' data, from the public API (src/routes/meals.ts). Menus need no sign-in; favorites use the Zotify session

export interface MealItem {
    sku: string;
    recipeId: string | null;
    name: string;
    description: string | null;
    category: string | null;
    ingredients: string | null;
    allergens: { tagged: string[], incomplete: string[], statement: string | null, possibleFromIngredients: string[] };
    dietTags: string[];
    serving: string | null;
    nutrition: Record<"calories" | "protein" | "totalFat" | "saturatedFat" | "transFat" | "cholesterolMg" | "sodiumMg" | "totalCarbohydrates" | "dietaryFiber" | "sugars" | "addedSugars", number | null>;
}

export interface MealStation {
    id: number;
    name: string;
    // The same kinds, in the same order, at every hall (see src/meals/stations.ts)
    kind: { id: string, name: string, order: number };
    items: MealItem[];
}

export interface MealPeriod {
    id: number;
    name: string;
    slug: string;
    hours: { opens: string, closes: string }[];
    // Whether the hours say it's served that day
    scheduled: boolean;
    menu: "menu" | "none" | "not-fetched";
    stations: MealStation[];
}

export interface MealDay {
    location: string;
    name: string;
    date: string;
    schedule: string | null;
    periods: MealPeriod[];
    fetched: boolean;
    past: boolean;
    transitionNote: string;
}

export interface MealsOverview {
    timezone: string;
    allergens: { id: string, label: string }[];
    dietTags: { id: string, label: string, description: string | null }[];
    mealPeriods: { id: number, name: string, position: number, slug: string }[];
    locations: { id: string, name: string }[];
    firstDate: string | null;
    lastDate: string | null;
    dates: string[];
}

export interface Serving {
    date: string;
    location: string;
    locationName: string;
    periodId: number;
    period: string;
    station: string;
}

export interface Favorite {
    recipeId: string;
    name: string;
    addedAt: number;
    upcoming: Serving[];
}

// Menus are public and the same for everyone, so they're fetched without the session cookie and can be cached
const cache = new Map<string, Promise<any>>();

export function getMeals<T>(path: string): Promise<T> {
    if (!cache.has(path)) {
        cache.set(path, fetch(`${API_URL}/api/meals${path}`).then(async response => {
            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error ?? `Couldn't load menus (${response.status})`);
            return data;
        }).catch(error => {
            // Don't keep a failure; the next try asks again
            cache.delete(path);
            throw error;
        }));
    }

    return cache.get(path)!;
}

/** Loads something from the meals API; undefined while loading */
export function useMeals<T>(path: string | null) {
    const [state, setState] = useState<{ path: string | null, data?: T, error?: string }>({ path });

    useEffect(() => {
        if (!path) return;
        let current = true;
        setState({ path });
        getMeals<T>(path).then(data => current && setState({ path, data }), error => current && setState({ path, error: (error as Error).message }));
        return () => { current = false; };
    }, [path]);

    // Ignore a previous path's answer while the new one loads
    return state.path === path ? state : { path };
}

/** Today (YYYY-MM-DD) in a timezone */
export const todayIn = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

/** The time (HH:MM) in a timezone */
export const timeIn = (timezone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "11:00" → "11 AM", "14:30" → "2:30 PM" */
export function clock(time: string) {
    const [hours, minutes] = time.split(":").map(Number);
    const suffix = hours >= 12 && hours < 24 ? "PM" : "AM";
    const hour = hours % 12 || 12;
    return minutes ? `${hour}:${String(minutes).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

/** "Today", "Tomorrow", "Yesterday", or like "Thu, Oct 23" */
export function dayLabel(date: string, today: string) {
    if (date === today) return "Today";
    if (date === addDays(today, 1)) return "Tomorrow";
    if (date === addDays(today, -1)) return "Yesterday";
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

/** The signed-in person's favorites, with when each is next served, and a way to star or unstar a dish */
export function useFavorites(schoolId: string) {
    const { user } = useUser();
    const [favorites, setFavorites] = useState<Favorite[] | null>(null);

    const reload = useCallback(async () => {
        if (!user) return setFavorites(user === null ? [] : null);
        const response = await apiFetch(`/api/meal-favorites/${schoolId}`).catch(() => null);
        setFavorites(response?.ok ? await response.json() : []);
    }, [user, schoolId]);

    useEffect(() => { reload(); }, [reload]);

    const toggle = useCallback(async (item: { recipeId: string | null, name: string }) => {
        if (!item.recipeId || !favorites) return;
        const remove = favorites.some(favorite => favorite.recipeId === item.recipeId);

        // Show the change straight away, then catch up with the server
        setFavorites(remove
            ? favorites.filter(favorite => favorite.recipeId !== item.recipeId)
            : [{ recipeId: item.recipeId, name: item.name, addedAt: Date.now(), upcoming: [] }, ...favorites]);
        await postJson(`/api/meal-favorites/${schoolId}`, { recipeId: item.recipeId, name: item.name, remove }).catch(() => {});
        reload();
    }, [favorites, schoolId, reload]);

    return { favorites, ids: new Set(favorites?.map(favorite => favorite.recipeId)), toggle, reload };
}

// Filters people pick (diets and allergens to avoid), remembered in this browser

export interface MealFilters {
    diets: string[];
    avoid: string[];
}

const FILTERS_KEY = "zotify-meals:filters";
const NO_FILTERS: MealFilters = { diets: [], avoid: [] };
const filterListeners = new Set<() => void>();
let filtersCache: { raw: string | null, value: MealFilters } = { raw: null, value: NO_FILTERS };

function readFilters(): MealFilters {
    let raw: string | null = null;
    try { raw = localStorage.getItem(FILTERS_KEY); } catch {}
    if (raw !== filtersCache.raw) {
        try { filtersCache = { raw, value: raw ? { ...NO_FILTERS, ...JSON.parse(raw) } : NO_FILTERS }; } catch { filtersCache = { raw, value: NO_FILTERS }; }
    }
    return filtersCache.value;
}

export function useMealFilters(): [MealFilters, (filters: MealFilters) => void] {
    const filters = useSyncExternalStore(
        listener => { filterListeners.add(listener); return () => filterListeners.delete(listener); },
        readFilters,
        () => NO_FILTERS
    );

    const setFilters = useCallback((next: MealFilters) => {
        try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch { filtersCache = { raw: JSON.stringify(next), value: next }; }
        filterListeners.forEach(listener => listener());
    }, []);

    return [filters, setFilters];
}

/** Whether an item suits the filters: none of the avoided allergens (tagged, or mentioned in its ingredients), and every picked diet */
export function suits(item: MealItem, filters: MealFilters) {
    const allergens = [...item.allergens.tagged, ...item.allergens.possibleFromIngredients];
    return filters.avoid.every(allergen => !allergens.includes(allergen)) && filters.diets.every(diet => item.dietTags.includes(diet));
}
