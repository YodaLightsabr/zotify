import { setTimeout as sleep } from "node:timers/promises";
import {
    elevateHeaders, ELEVATE_URL, ITEM_ATTRIBUTES, MAX_CONCURRENT_REQUESTS, MIN_REQUEST_GAP_MS, REQUEST_TIMEOUT_MS, RETRIES,
    RETRY_DELAY_MS, type DiningConfig
} from "./config.js";

// A small client for Elevate's GraphQL API (see config.ts). Requests are rate limited and retried, and every failure is
// an ElevateError, so callers can keep serving what they already have

export class ElevateError extends Error {
    constructor (message: string) {
        super(message);
        this.name = "ElevateError";
    }
}

// At most MAX_CONCURRENT_REQUESTS at once, started at least MIN_REQUEST_GAP_MS apart
let active = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

async function slot() {
    if (active >= MAX_CONCURRENT_REQUESTS) await new Promise<void>(resolve => waiting.push(resolve));
    active++;

    const gap = lastStart + MIN_REQUEST_GAP_MS - Date.now();
    lastStart = Math.max(Date.now(), lastStart + MIN_REQUEST_GAP_MS);
    if (gap > 0) await sleep(gap);
}

function release() {
    active--;
    waiting.shift()?.();
}

async function request<T>(config: DiningConfig, query: string, variables: Record<string, unknown>): Promise<T> {
    const url = `${ELEVATE_URL}?${new URLSearchParams({ query, variables: JSON.stringify(variables) })}`;

    await slot();
    try {
        const response = await fetch(url, { headers: elevateHeaders(config), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        const text = await response.text();

        let body: any;
        try {
            body = JSON.parse(text);
        } catch {
            // The CDN answers with HTML, e.g. "450 Missing required input params" when headers change
            throw new ElevateError(`Elevate answered ${response.status} with something other than JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
        }

        if (body.errors?.length && !body.data) {
            const messages = body.errors.map((error: any) => [error.message, ...(error.extensions?.messages ?? [])].join(": ")).join("; ");
            throw new ElevateError(`Elevate couldn't answer: ${messages}`);
        }

        return body.data as T;
    } catch (error) {
        throw error instanceof ElevateError ? error : new ElevateError(`Couldn't reach Elevate: ${(error as Error).message}`);
    } finally {
        release();
    }
}

/** Runs a query, trying again a couple of times if it fails */
async function query<T>(config: DiningConfig, text: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await request<T>(config, text, variables);
        } catch (error) {
            if (attempt >= RETRIES) throw error;
            await sleep(RETRY_DELAY_MS * (attempt + 1));
        }
    }
}

// The queries

export interface StoreConfig {
    timezone: string;
    allergens_intolerances: { label: string, value: string }[];
    menu_preferences: { label: string, title: string | null, value: string, description: string | null }[];
}

/** The school's allergen and diet tag labels, and its timezone */
export async function fetchStoreConfig(config: DiningConfig) {
    const data = await query<{ Commerce_storeConfig: StoreConfig }>(config,
        "{ Commerce_storeConfig { timezone allergens_intolerances { label value } menu_preferences { label title value description } } }");
    return data.Commerce_storeConfig;
}

/** Every meal period the school uses, like Breakfast (10) */
export async function fetchMealPeriods(config: DiningConfig) {
    const data = await query<{ Commerce_mealPeriods: { id: number, name: string, position: number }[] }>(config,
        "{ Commerce_mealPeriods { id name position } }");
    return data.Commerce_mealPeriods;
}

export interface ElevateLocation {
    commerceAttributes: {
        name: string;
        url_key: string;
        maxMenusDate: string | null;
        meal_periods: { id: number, name: string, position: number }[] | null;
        children: { id: number, name: string }[] | null;
    } | null;
    aemAttributes: {
        hoursOfOperation: { schedule: ScheduleEntry[] | null } | null;
    } | null;
}

/** A named stretch of opening hours, like "Standard" or "Finals Week Spring Quarter" (see hours.ts) */
export interface ScheduleEntry {
    id: string;
    name: string;
    // "standard" applies whenever no "special" entry covers the date
    type: string;
    start_date?: string | null;
    end_date?: string | null;
    // opening_hours is like "Mo-Fr 07:15-11:00; Sa-Su 09:00-11:00", or "Mo-Su off"
    meal_periods: { meal_period: string, opening_hours: string }[];
}

/** A dining hall: its stations, meal periods, how far ahead menus go, and its hours */
export async function fetchLocation(config: DiningConfig, locationKey: string) {
    const data = await query<{ getLocation: ElevateLocation | null }>(config, `
        query Location($campus: String!, $location: String!) {
            getLocation(campusUrlKey: $campus, locationUrlKey: $location) {
                commerceAttributes { name url_key maxMenusDate meal_periods { id name position } children { id name } }
                aemAttributes { hoursOfOperation { schedule } }
            }
        }
    `, { campus: config.campusUrlKey, location: locationKey });

    if (!data.getLocation?.commerceAttributes) throw new ElevateError(`Elevate has no location "${locationKey}"`);
    return data.getLocation;
}

export interface ElevateProduct {
    name: string;
    sku: string;
    attributes: { name: string, value: unknown }[];
    // Photos, for about one in five dishes
    images?: { url: string, roles: string[] | null }[] | null;
}

/**
 * One date and meal period's menu at a location: which items each station serves, and the items. Null when nothing was
 * published for it, which is common (a meal that isn't served that day)
 */
export async function fetchMenu(config: DiningConfig, locationKey: string, date: string, periodId: number) {
    const data = await query<{ getLocationRecipes: {
        locationRecipesMap: { stationSkuMap: { id: number, skus: string[] }[] | null } | null,
        products: { items: ElevateProduct[] | null } | null
    } | null }>(config, `
        query Menu($campus: String!, $location: String!, $date: String!, $period: Int) {
            getLocationRecipes(campusUrlKey: $campus, locationUrlKey: $location, date: $date, mealPeriod: $period, viewType: DAILY) {
                locationRecipesMap { stationSkuMap { id skus } }
                products { items { name sku images { url roles } attributes(names: ${JSON.stringify(ITEM_ATTRIBUTES)}) { name value } } }
            }
        }
    `, { campus: config.campusUrlKey, location: locationKey, date, period: periodId });

    const recipes = data.getLocationRecipes;
    const stations = recipes?.locationRecipesMap?.stationSkuMap ?? [];
    const items = recipes?.products?.items ?? [];

    return stations.length && items.length ? { stations, items } : null;
}
