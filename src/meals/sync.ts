import { cache } from "../cache.js";
import { db } from "../db.js";
import { DAYS_AHEAD, NEAR_TERM_DAYS, NEAR_TERM_REFRESH_MS, NIGHTLY_SYNC_HOUR, type DiningConfig } from "./config.js";
import { fetchLocation, fetchMealPeriods, fetchMenu, fetchStoreConfig } from "./elevate.js";
import { isHidden, toMenuItem, type Labels } from "./items.js";
import { getReference, saveLocation, saveMenu, saveReference, type DiningLocation, type Reference } from "./store.js";

// Keeps every school's menus fresh: the next two weeks nightly (and on first start), and today and tomorrow every hour,
// since menus can change on the day. A failed request leaves what was saved before in place, so the API keeps answering.
// Menus are never deleted, so past days stay available as a history

export interface DiningSchool {
    id: string;
    config: DiningConfig;
    // Zotify venues with a dining site location, like { id: "anteatery", key: "the-anteatery" }
    locations: { id: string, key: string }[];
}

/** Schools set up for Zotify Meals, with the venues it reads menus for */
export function diningSchools(): DiningSchool[] {
    const schools = db.prepare("SELECT id, dining_config FROM schools WHERE dining_config IS NOT NULL ORDER BY position").all() as { id: string, dining_config: string }[];

    return schools.map(school => ({
        id: school.id,
        config: JSON.parse(school.dining_config) as DiningConfig,
        locations: (db.prepare("SELECT id, dining_location_key AS key FROM venues WHERE school_id = ? AND dining_location_key IS NOT NULL ORDER BY position")
            .all(school.id) as { id: string, key: string }[])
    })).filter(school => school.locations.length);
}

export interface SyncStatus {
    running: boolean;
    lastFullSync: number | null;
    lastNearTermSync: number | null;
    lastError: string | null;
    // From the most recent sync
    menusFetched: number;
    menusFailed: number;
}

const statusKey = (schoolId: string) => `mealsSync:${schoolId}`;

export async function getStatus(schoolId: string): Promise<SyncStatus> {
    return (await cache.get([statusKey(schoolId)]) as SyncStatus | undefined) ?? { running: false, lastFullSync: null, lastNearTermSync: null, lastError: null, menusFetched: 0, menusFailed: 0 };
}

async function setStatus(schoolId: string, change: Partial<SyncStatus>) {
    await cache.set([statusKey(schoolId)], { ...await getStatus(schoolId), ...change });
}

/** A date (YYYY-MM-DD) some days before or after another */
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Today's date (YYYY-MM-DD) in a timezone */
export const todayIn = (timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

/** Today and the days after it, in a timezone */
export function datesFrom(timezone: string, days: number) {
    const today = todayIn(timezone);
    return Array.from({ length: days }, (_, i) => addDays(today, i));
}


const hourIn = (timezone: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date()));

async function syncReference(school: DiningSchool) {
    const [config, periods] = await Promise.all([fetchStoreConfig(school.config), fetchMealPeriods(school.config)]);

    const reference: Reference = {
        timezone: config.timezone,
        allergens: config.allergens_intolerances.map(({ value, label }) => ({ id: value, label })),
        dietTags: config.menu_preferences.map(({ value, title, label, description }) => ({ id: value, label: title ?? label, description })),
        mealPeriods: [...periods].sort((a, b) => a.position - b.position)
    };

    saveReference(school.id, reference);
    return reference;
}

async function syncLocation(school: DiningSchool, location: { id: string, key: string }) {
    const { commerceAttributes, aemAttributes } = await fetchLocation(school.config, location.key);

    const saved: DiningLocation = {
        id: location.id,
        key: location.key,
        name: commerceAttributes!.name,
        menusThrough: commerceAttributes!.maxMenusDate,
        mealPeriods: (commerceAttributes!.meal_periods ?? []).map(({ id, name }) => ({ id, name })),
        stations: (commerceAttributes!.children ?? []).map(({ id, name }) => ({ id, name: name.trim() })),
        schedule: aemAttributes?.hoursOfOperation?.schedule ?? null
    };

    saveLocation(school.id, saved);
    return saved;
}

/** Fetches every meal period's menu for these dates at a location. Returns how many were fetched and how many failed */
async function syncMenus(school: DiningSchool, location: DiningLocation, dates: string[], labels: Labels) {
    const tasks = dates
        .filter(date => !location.menusThrough || date <= location.menusThrough)
        .flatMap(date => location.mealPeriods.map(period => ({ date, period })));

    let failed = 0;

    // The Elevate client limits how many run at once
    await Promise.all(tasks.map(async ({ date, period }) => {
        try {
            const menu = await fetchMenu(school.config, location.key, date, period.id);
            const visible = (menu?.items ?? []).filter(product => !isHidden(product));
            const skus = new Set(visible.map(product => product.sku));

            const stations = menu?.stations
                .map(station => ({ id: station.id, skus: station.skus.filter(sku => skus.has(sku)) }))
                .filter(station => station.skus.length) ?? [];

            saveMenu(school.id, location.id, date, period.id, stations.length ? stations : null, visible.map(product => toMenuItem(product, labels)));
        } catch (error) {
            failed++;
            console.warn(`Zotify Meals couldn't fetch ${location.name} on ${date} (${period.name}): ${(error as Error).message}`);
        }
    }));

    return { fetched: tasks.length - failed, failed };
}

const labelsOf = (reference: Reference): Labels => ({
    allergens: Object.fromEntries(reference.allergens.map(({ id, label }) => [id, label])),
    dietTags: Object.fromEntries(reference.dietTags.map(({ id, label }) => [id, label]))
});

// One sync at a time per school
const running = new Set<string>();

/** Fetches a school's labels, locations, and menus for the next days. near limits it to the next couple of days' menus */
export async function syncSchool(school: DiningSchool, { near = false } = {}) {
    if (running.has(school.id)) return;
    running.add(school.id);
    await setStatus(school.id, { running: true });

    const started = Date.now();
    let fetched = 0, failed = 0;

    try {
        // Labels and locations change rarely, so the hourly refresh reuses them
        const reference = near ? getReference(school.id) ?? await syncReference(school) : await syncReference(school);
        const dates = datesFrom(reference.timezone, near ? NEAR_TERM_DAYS : DAYS_AHEAD);

        for (const location of school.locations) {
            try {
                const saved = await syncLocation(school, location);
                const result = await syncMenus(school, saved, dates, labelsOf(reference));
                fetched += result.fetched;
                failed += result.failed;
            } catch (error) {
                failed++;
                console.error(`Zotify Meals couldn't sync ${location.key} for ${school.id}:`, (error as Error).message);
            }
        }


        console.log(`Zotify Meals ${near ? "refreshed" : "synced"} ${school.id}: ${fetched} menus${failed ? `, ${failed} failed` : ""} in ${Math.round((Date.now() - started) / 1000)}s`);
        await setStatus(school.id, {
            [near ? "lastNearTermSync" : "lastFullSync"]: Date.now(),
            ...(near ? {} : { lastNearTermSync: Date.now() }),
            lastError: failed ? `${failed} menus couldn't be fetched` : null,
            menusFetched: fetched,
            menusFailed: failed
        });
    } catch (error) {
        console.error(`Zotify Meals couldn't sync ${school.id}:`, error);
        await setStatus(school.id, { lastError: (error as Error).message });
    } finally {
        running.delete(school.id);
        await setStatus(school.id, { running: false });
    }
}

/** Syncs each school when it's never been synced, nightly after NIGHTLY_SYNC_HOUR, and refreshes the next days hourly */
export function startMealsSync() {
    const check = async () => {
        for (const school of diningSchools()) {
            const status = await getStatus(school.id);
            const timezone = getReference(school.id)?.timezone ?? "America/Los_Angeles";
            const today = todayIn(timezone);
            const lastFullDay = status.lastFullSync ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(status.lastFullSync)) : null;

            if (!status.lastFullSync || (lastFullDay! < today && hourIn(timezone) >= NIGHTLY_SYNC_HOUR)) {
                await syncSchool(school);
            } else if (!status.lastNearTermSync || Date.now() - status.lastNearTermSync > NEAR_TERM_REFRESH_MS) {
                await syncSchool(school, { near: true });
            }
        }
    };

    // A sync that was running when the server stopped isn't anymore
    for (const school of diningSchools()) setStatus(school.id, { running: false });

    check().catch(error => console.error("Zotify Meals sync check failed:", error));
    setInterval(() => check().catch(error => console.error("Zotify Meals sync check failed:", error)), 5 * 60 * 1000);
}
