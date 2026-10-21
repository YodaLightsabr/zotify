import { TRANSITION_NOTE } from "../meals/config.js";
import { addFavorite, getFavorites, removeFavorite, upcomingServings } from "../meals/favorites.js";
import { hoursOn } from "../meals/hours.js";
import { getDates, getItemAppearances, getItems, getLocation, getMenus, getReference } from "../meals/store.js";
import { sortStations } from "../meals/stations.js";
import { addDays, diningSchools, getStatus, todayIn } from "../meals/sync.js";
import { getSchool } from "../schools.js";
// Zotify Meals: a public, read-only REST API for dining hall menus. Everything comes from the copy kept by meals/sync.ts,
// so answers are instant, and responses can be cached by browsers and Cloudflare for a few minutes
//
//   GET /api/meals                                   schools and their dining halls
//   GET /api/meals/:school                           allergen and diet tag labels, meal periods, dining halls, dates
//   GET /api/meals/:school/status                    when menus were last fetched
//   GET /api/meals/:school/items/:sku                one item, and where and when it's served
//   GET /api/meals/:school/:location                 a dining hall's stations and hours for the next two weeks
//   GET /api/meals/:school/:location/:date           a day's menu: today, tomorrow, yesterday or YYYY-MM-DD, past or future,
//                                                    as long as it was saved
//       ?period=lunch (or 25)   one meal period
//       ?exclude=milk,peanuts   leave out items tagged with, or whose ingredients mention, these allergens
//       ?diet=vegan             only items with these diet tags
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Cache headers: browsers and Cloudflare may reuse an answer for a few minutes, and serve it stale while refetching */
function cached(res, seconds = 300) {
    res.set("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=3600`);
}
function notFound(res, error) {
    res.status(404).json({ error });
}
/** The school and its saved labels, or a 404 */
function schoolFor(req, res) {
    const id = String(req.params.school ?? "").toLowerCase();
    const school = diningSchools().find(candidate => candidate.id === id);
    const reference = school ? getReference(school.id) : null;
    if (!school)
        return void notFound(res, `There's no school "${id}" on Zotify Meals.`);
    if (!reference)
        return void res.status(503).json({ error: "Menus are still being fetched for the first time. Try again in a minute." });
    return { school, reference };
}
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Values from a comma-separated query parameter, as slugs */
const listParam = (req, name) => typeof req.query[name] === "string"
    ? req.query[name].split(",").map(slug).filter(Boolean) : [];
export function mealsIndex(_req, res) {
    cached(res, 3600);
    res.json({
        schools: diningSchools().map(school => ({
            id: school.id,
            name: getSchool(school.id)?.name ?? school.id,
            locations: school.locations.map(location => ({ id: location.id, name: getLocation(school.id, location.id)?.name ?? location.id }))
        }))
    });
}
export function mealsSchool(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const { school, reference } = found;
    const dates = getDates(school.id);
    cached(res, 3600);
    res.json({
        school: school.id,
        timezone: reference.timezone,
        allergens: reference.allergens,
        dietTags: reference.dietTags,
        mealPeriods: reference.mealPeriods.map(period => ({ ...period, slug: slug(period.name) })),
        locations: school.locations.map(location => {
            const saved = getLocation(school.id, location.id);
            return { id: location.id, name: saved?.name ?? location.id, menusPublishedThrough: saved?.menusThrough ?? null };
        }),
        // Every date with menus kept: everything since Zotify Meals started, through two weeks ahead
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        dates
    });
}
export async function mealsStatus(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const status = await getStatus(found.school.id);
    res.json({
        ...status,
        lastFullSync: status.lastFullSync && new Date(status.lastFullSync).toISOString(),
        lastNearTermSync: status.lastNearTermSync && new Date(status.lastNearTermSync).toISOString()
    });
}
export function mealsItem(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const item = getItems(found.school.id, [String(req.params.sku)]).get(String(req.params.sku));
    if (!item)
        return notFound(res, "There's no item with that SKU on the menus kept.");
    const periods = new Map(found.reference.mealPeriods.map(period => [period.id, period.name]));
    cached(res);
    res.json({
        ...item,
        servedAt: getItemAppearances(found.school.id, item.sku).map(appearance => ({ ...appearance, period: periods.get(appearance.periodId) ?? null }))
    });
}
/** The dining hall, or a 404 */
function locationFor(req, res, schoolId, locations) {
    const id = String(req.params.location ?? "").toLowerCase();
    const location = locations.some(candidate => candidate.id === id) ? getLocation(schoolId, id) : null;
    if (!location)
        return void notFound(res, `There's no dining hall "${id}". Try one of: ${locations.map(candidate => candidate.id).join(", ")}.`);
    return location;
}
export function mealsLocation(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const location = locationFor(req, res, found.school.id, found.school.locations);
    if (!location)
        return;
    const today = todayIn(found.reference.timezone);
    cached(res, 3600);
    res.json({
        id: location.id,
        name: location.name,
        menusPublishedThrough: location.menusThrough,
        // In the same order at every hall, each with its kind (see meals/stations.ts)
        stations: sortStations(location.stations),
        mealPeriods: location.mealPeriods,
        hours: Array.from({ length: 14 }, (_, i) => hoursOn(location.schedule, addDays(today, i))),
        transitionNote: TRANSITION_NOTE
    });
}
/** Whether an item avoids every excluded allergen (tagged, or mentioned in its ingredients) and has every wanted diet tag */
function keep(item, exclude, diets) {
    const allergens = [...item.allergens.tagged, ...item.allergens.possibleFromIngredients].map(slug);
    const tags = item.dietTags.map(slug);
    // "nuts" matches "tree-nuts", "egg" matches "eggs", and so on
    const mentions = (list, wanted) => list.some(entry => entry === wanted || entry.startsWith(wanted) || entry.endsWith(wanted));
    return exclude.every(allergen => !mentions(allergens, allergen)) && diets.every(diet => mentions(tags, diet));
}
export function mealsDay(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const { school, reference } = found;
    const location = locationFor(req, res, school.id, school.locations);
    if (!location)
        return;
    const today = todayIn(reference.timezone);
    const requested = String(req.params.date).toLowerCase();
    const date = requested === "today" ? today : requested === "tomorrow" ? addDays(today, 1) : requested === "yesterday" ? addDays(today, -1) : requested;
    if (!DATE.test(date))
        return void res.status(400).json({ error: "Use a date like 2026-10-21, or today, tomorrow or yesterday." });
    const menus = getMenus(school.id, location.id, date);
    const hours = hoursOn(location.schedule, date);
    // ?period= by name, slug or ID
    const wanted = typeof req.query.period === "string" ? req.query.period.toLowerCase() : null;
    const period = wanted ? reference.mealPeriods.find(candidate => String(candidate.id) === wanted || slug(candidate.name) === slug(wanted)) : null;
    if (wanted && !period)
        return void res.status(400).json({ error: `There's no meal period "${wanted}". Try one of: ${reference.mealPeriods.map(candidate => slug(candidate.name)).join(", ")}.` });
    const exclude = listParam(req, "exclude");
    const diets = listParam(req, "diet");
    cached(res);
    res.json({
        location: location.id,
        name: location.name,
        date,
        schedule: hours.schedule,
        // Every meal period served that day, or with a menu published, in order
        periods: dayPeriods(school.id, location, reference, menus, hours.periods)
            .filter(entry => !period || entry.id === period.id)
            .map(entry => ({
            ...entry,
            stations: entry.stations.map(station => ({ ...station, items: station.items.filter(item => keep(item, exclude, diets)) }))
                .filter(station => station.items.length || (!exclude.length && !diets.length))
        })),
        // When none of the date's menus were ever fetched: further ahead than two weeks, or before Zotify Meals started
        fetched: menus.length > 0,
        past: date < today,
        transitionNote: TRANSITION_NOTE
    });
}
/** Each dish once per station. The same recipe can be listed under several SKUs */
function unique(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.recipeId ?? item.sku;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function dayPeriods(schoolId, location, reference, menus, hours) {
    const byId = new Map(menus.map(menu => [menu.periodId, menu]));
    const names = new Map(reference.mealPeriods.map(period => [period.id, period]));
    const items = getItems(schoolId, menus.flatMap(menu => menu.stations.flatMap(station => station.skus)));
    const stationNames = new Map(location.stations.map(station => [station.id, station.name]));
    // Periods with hours that day, then any others that have a menu anyway
    const ids = [
        ...hours.map(entry => reference.mealPeriods.find(period => period.name === entry.period)?.id).filter((id) => id !== undefined),
        ...menus.filter(menu => menu.published).map(menu => menu.periodId)
    ];
    return [...new Set(ids)].map(id => {
        const menu = byId.get(id);
        const period = names.get(id);
        const times = hours.filter(entry => entry.period === period?.name);
        return {
            id,
            name: period?.name ?? `Meal period ${id}`,
            slug: slug(period?.name ?? String(id)),
            // Usually one stretch, sometimes more
            hours: times.map(({ opens, closes }) => ({ opens, closes })),
            // Whether the hours say it's served that day. The dining site sometimes has menus for meal periods that aren't,
            // like an "All Day" list; those come last
            scheduled: times.length > 0,
            // "menu", "none" (nothing published for it), or "not-fetched"
            menu: menu ? (menu.published ? "menu" : "none") : "not-fetched",
            updatedAt: menu ? new Date(menu.fetchedAt).toISOString() : null,
            // In the same order at every hall, each with its kind (see meals/stations.ts)
            stations: sortStations((menu?.stations ?? []).map(station => ({
                id: station.id,
                name: stationNames.get(station.id) ?? `Station ${station.id}`,
                items: unique(station.skus.map(sku => items.get(sku)).filter((item) => !!item))
                    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
            })))
        };
    });
}
// Favorites, for signed-in people. These are under /api/meal-favorites, not /api/meals, since they need the session cookie
/** The signed-in person's favorites at a school, each with when it's next served */
export function myFavorites(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const favorites = getFavorites(res.locals.session.email, found.school.id);
    const servings = upcomingServings(found.school.id, favorites.map(favorite => favorite.recipeId));
    res.set("Cache-Control", "private, no-store");
    res.json(favorites.map(favorite => ({ ...favorite, upcoming: servings.get(favorite.recipeId) ?? [] })));
}
/** Body: { recipeId, name, remove? }. Stars or unstars a dish */
export function setFavorite(req, res) {
    const found = schoolFor(req, res);
    if (!found)
        return;
    const recipeId = typeof req.body?.recipeId === "string" ? req.body.recipeId.trim().slice(0, 64) : "";
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    if (!recipeId || (!req.body?.remove && !name)) {
        res.status(400).json({ error: "Missing the dish" });
        return;
    }
    const email = res.locals.session.email;
    if (req.body?.remove === true)
        removeFavorite(email, found.school.id, recipeId);
    else
        addFavorite(email, found.school.id, recipeId, name);
    res.json({ ok: true });
}
//# sourceMappingURL=meals.js.map