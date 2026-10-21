"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import ItemDialog from "@/components/meals/ItemDialog";
import { Spinner } from "@/components/Spinner";
import { goToLogin } from "@/lib/api";
import { cx } from "@/lib/format";
import {
    addDays, clock, dayLabel, getMeals, suits, timeIn, todayIn, useFavorites, useMealFilters, useMeals,
    type MealDay, type MealFilters, type MealItem, type MealPeriod, type MealsOverview, type MealStation
} from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";

// Zotify Meals' dashboard: one meal at both dining halls side by side, counters lined up by kind so the salad bars and
// desserts sit across from each other, with your favorites on top. Phones show one hall at a time, in the same order.
// The date, meal and hall are in the address (?date=&period=&hall=), so any view can be shared

// Counters with more dishes than this are folded, like the salad bar's dozens of toppings
const FOLDED_ITEMS = 8;

export default function MealsPage() {
    return <Suspense><Dashboard /></Suspense>;
}

/** Every hall's menu for a date. Undefined while loading */
function useDays(school: string, halls: string[], date: string) {
    const [days, setDays] = useState<{ key: string, days?: (MealDay | null)[], error?: string }>({ key: "" });
    const key = `${halls.join(",")}@${date}`;

    useEffect(() => {
        if (!halls.length) return;
        let current = true;
        Promise.all(halls.map(hall => getMeals<MealDay>(`/${school}/${hall}/${date}`).catch(() => null)))
            .then(result => current && setDays({ key, days: result }));
        return () => { current = false; };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

    return days.key === key ? days.days : undefined;
}

/** The meal periods to offer: those scheduled at either hall that day, otherwise any with a menu, in the order meals happen */
function periodsOf(days: (MealDay | null)[], overview: MealsOverview) {
    const all = days.flatMap(day => day?.periods ?? []);
    const scheduled = all.filter(period => period.scheduled);
    const offered = scheduled.length ? scheduled : all.filter(period => period.menu === "menu");
    const position = (id: number) => overview.mealPeriods.find(period => period.id === id)?.position ?? 999;

    return [...new Map(offered.map(period => [period.id, period])).values()].sort((a, b) => position(a.id) - position(b.id));
}

/** The meal on now, or next; for other days, the first */
function defaultPeriod(periods: MealPeriod[], days: (MealDay | null)[], isToday: boolean, now: string) {
    if (!isToday) return periods[0];

    const closes = (period: MealPeriod) => Math.max(...days.flatMap(day => day?.periods.find(entry => entry.id === period.id)?.hours.map(hours => Number(hours.closes.replace(":", ""))) ?? [0]));
    return periods.find(period => closes(period) > Number(now.replace(":", ""))) ?? periods.at(-1);
}

function Dashboard() {
    const school = useSchool();
    const router = useRouter();
    const params = useSearchParams();
    const { user } = useUser();
    const overview = useMeals<MealsOverview>(`/${school.id}`);
    const [filters, setFilters] = useMealFilters();
    const { favorites, ids: favoriteIds, toggle } = useFavorites(school.id);
    const [open, setOpen] = useState<{ item: MealItem, where: string } | null>(null);
    const [showFilters, setShowFilters] = useState(false);

    const timezone = overview.data?.timezone ?? "America/Los_Angeles";
    const today = todayIn(timezone);
    const date = params.get("date") ?? today;
    const halls = overview.data?.locations ?? [];
    const days = useDays(school.id, halls.map(hall => hall.id), date);

    const periods = useMemo(() => days && overview.data ? periodsOf(days, overview.data) : [], [days, overview.data]);
    const period = periods.find(entry => entry.slug === params.get("period")) ?? (days ? defaultPeriod(periods, days, date === today, timeIn(timezone)) : undefined);
    const hall = params.get("hall") ?? halls[0]?.id;

    /** Changes the address, keeping the rest */
    function go(changes: Record<string, string | null>) {
        const next = new URLSearchParams(params);
        for (const [key, value] of Object.entries(changes)) {
            if (value === null) next.delete(key);
            else next.set(key, value);
        }
        router.replace(`/?${next}`, { scroll: false });
    }

    function star(item: MealItem) {
        if (!user) return goToLogin();
        toggle(item);
    }

    if (overview.error) return <main className="meals-main"><p className="meals-message">{overview.error}</p></main>;
    if (!overview.data) return <main className="meals-main"><div className="meals-message"><Spinner /></div></main>;

    // Today and the coming days, plus the chosen one if it's further back
    const dates = overview.data.dates.filter(entry => entry >= today);
    if (!dates.includes(date)) dates.unshift(date);

    // This meal at each hall, and its counters grouped by kind across halls, in the shared order
    const meals = halls.map((entry, i) => ({ hall: entry, day: days?.[i] ?? null, period: days?.[i]?.periods.find(candidate => candidate.id === period?.id) ?? null }));
    const kinds = [...new Map(meals.flatMap(meal => meal.period?.stations ?? []).map(station => [station.kind.id, station.kind])).values()]
        .sort((a, b) => a.order - b.order);

    // Favorites on this meal, at either hall
    const onNow = meals.flatMap(meal => (meal.period?.stations ?? []).flatMap(station => station.items
        .filter(item => item.recipeId && favoriteIds.has(item.recipeId))
        .map(item => ({ item, hall: meal.hall.name, station: station.name }))));

    const filtered = filters.diets.length + filters.avoid.length;

    return (
        <main className="meals-main">
            <div className="meals-controls">
                <div className="meals-dates" role="tablist" aria-label="Day">
                    {dates.map(entry => (
                        <button key={entry} type="button" role="tab" aria-selected={entry === date} className={cx("meals-chip", entry === date && "current")}
                            onClick={() => go({ date: entry === today ? null : entry, period: null })}>
                            {dayLabel(entry, today)}
                        </button>
                    ))}
                    {/* Earlier days, back to when Zotify Meals started keeping menus */}
                    <label className="meals-chip meals-calendar" title="Pick a past day">
                        <span aria-hidden="true">📅</span>
                        <input type="date" aria-label="Pick a day" min={overview.data.firstDate ?? undefined} max={overview.data.lastDate ?? undefined} value={date}
                            onChange={event => event.target.value && go({ date: event.target.value === today ? null : event.target.value, period: null })} />
                    </label>
                </div>

                <div className="meals-periods" role="tablist" aria-label="Meal">
                    {periods.map(entry => (
                        <button key={entry.id} type="button" role="tab" aria-selected={entry.id === period?.id} className={cx("meals-period", entry.id === period?.id && "current")}
                            onClick={() => go({ period: entry.slug })}>
                            {entry.name}
                        </button>
                    ))}
                    <button type="button" className={cx("meals-period", "filter-toggle", filtered > 0 && "active")} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
                        Filters{filtered ? ` · ${filtered}` : ""}
                    </button>
                </div>

                {showFilters && <Filters overview={overview.data} filters={filters} onChange={setFilters} />}

                {/* Phones show one hall at a time */}
                <div className="meals-hall-toggle" role="tablist" aria-label="Dining hall">
                    {halls.map(entry => (
                        <button key={entry.id} type="button" role="tab" aria-selected={entry.id === hall} className={cx("meals-chip", entry.id === hall && "current")}
                            onClick={() => go({ hall: entry.id })}>{entry.name}</button>
                    ))}
                </div>
            </div>

            {!days ? <div className="meals-message"><Spinner /></div> : <>
                <section className="meals-favorites" aria-labelledby="meals-favorites-title">
                    <div className="meals-section-head">
                        <h2 id="meals-favorites-title">Your favorites{period ? ` at ${period.name.toLowerCase()}` : ""}</h2>
                        <Link href="/favorites">When they&apos;re on next →</Link>
                    </div>
                    {!user ? (
                        <p className="meals-muted">
                            <a href="/login" onClick={event => { event.preventDefault(); goToLogin(); }}>Sign in</a> to star dishes, see them here first, and find out when they&apos;re on next.
                        </p>
                    ) : onNow.length ? (
                        <ul className="meals-favorite-list">
                            {onNow.map(({ item, hall: hallName, station }) => (
                                <li key={`${hallName}-${item.sku}`}>
                                    <button type="button" className="meals-favorite" onClick={() => setOpen({ item, where: `${hallName} · ${station}` })}>
                                        <span className="meals-favorite-star" aria-hidden="true">★</span>
                                        <span className="meals-favorite-name">{item.name}</span>
                                        <span className="meals-muted">{hallName} · {station}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="meals-muted">{favorites?.length ? "None of your favorites are on this meal." : "Star a dish to see it here whenever it's on."}</p>
                    )}
                </section>

                <div className="meals-grid" style={{ "--halls": halls.length } as React.CSSProperties}>
                    {meals.map(meal => (
                        <div key={meal.hall.id} className={cx("meals-hall-head", meal.hall.id !== hall && "other-hall")}>
                            <h2>{meal.hall.name}</h2>
                            <p className="meals-muted">{hoursText(meal.period, meal.day)}</p>
                        </div>
                    ))}

                    {kinds.length === 0 && (
                        <p className="meals-message wide">
                            {meals.some(meal => meal.day && !meal.day.fetched)
                                ? date < today ? "Zotify Meals didn't keep menus that far back." : "Menus for this day aren't out yet."
                                : "No menus published for this meal."}
                        </p>
                    )}

                    {kinds.map(kind => <Fragment key={kind.id}>
                        <h3 className="meals-kind">{kind.name}</h3>
                        {meals.map(meal => (
                            <div key={`${kind.id}-${meal.hall.id}`} className={cx("meals-cell", meal.hall.id !== hall && "other-hall")}>
                                {(meal.period?.stations ?? []).filter(station => station.kind.id === kind.id).map(station => (
                                    <Station key={station.id} station={station} filters={filters} favorites={favoriteIds}
                                        onOpen={item => setOpen({ item, where: `${meal.hall.name} · ${station.name}` })} onStar={star} />
                                ))}
                                {!(meal.period?.stations ?? []).some(station => station.kind.id === kind.id) && <p className="meals-none">—</p>}
                            </div>
                        ))}
                    </Fragment>)}
                </div>

                {meals[0]?.day?.transitionNote && <p className="meals-note">{meals[0].day.transitionNote}</p>}
            </>}

            <ItemDialog item={open?.item ?? null} where={open?.where ?? null} today={today} signedIn={!!user}
                favorite={favorites?.find(favorite => favorite.recipeId === open?.item.recipeId)}
                onToggleFavorite={star} onClose={() => setOpen(null)} />
        </main>
    );
}

/** "11 AM – 2:30 PM", "Not served", or why there's no menu */
function hoursText(period: MealPeriod | null, day: MealDay | null) {
    if (!day) return "Couldn't load this hall.";
    if (!period) return "Not served";
    const hours = period.hours.map(({ opens, closes }) => `${clock(opens)} – ${clock(closes)}`).join(", ");
    return hours || (period.menu === "menu" ? "Menu posted" : "Not served");
}

function Station({ station, filters, favorites, onOpen, onStar }: {
    station: MealStation, filters: MealFilters, favorites: Set<string>, onOpen: (item: MealItem) => void, onStar: (item: MealItem) => void
}) {
    const [unfolded, setUnfolded] = useState(false);
    const shown = station.items.filter(item => suits(item, filters));
    const hidden = station.items.length - shown.length;
    // Favorites first, then the dining hall's order
    const sorted = [...shown].sort((a, b) => Number(favorites.has(b.recipeId ?? "")) - Number(favorites.has(a.recipeId ?? "")));
    const visible = unfolded ? sorted : sorted.slice(0, FOLDED_ITEMS);

    return (
        <div className="meals-station">
            <h4>{station.name}</h4>
            <ul>
                {visible.map(item => {
                    const starred = !!item.recipeId && favorites.has(item.recipeId);
                    return (
                        <li key={item.sku} className={cx("meals-item", starred && "starred")}>
                            <button type="button" className={cx("meals-item-star", starred && "on")} aria-pressed={starred}
                                title={starred ? "Remove from favorites" : "Add to favorites"} onClick={() => onStar(item)}>{starred ? "★" : "☆"}</button>
                            <button type="button" className="meals-item-name" onClick={() => onOpen(item)}>
                                <span>{item.name}</span>
                                <span className="meals-item-meta">
                                    {item.dietTags.filter(tag => /vegan|vegetarian|halal|gluten/i.test(tag)).map(tag => <span key={tag} className="meals-tag small">{shortTag(tag)}</span>)}
                                    {item.nutrition.calories !== null && <span className="meals-muted">{Math.round(item.nutrition.calories)} cal</span>}
                                    {item.image && <img className="meals-thumb" src={item.image.thumbnail} alt="" loading="lazy" />}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {sorted.length > FOLDED_ITEMS && (
                <button type="button" className="meals-more" onClick={() => setUnfolded(!unfolded)}>
                    {unfolded ? "Show fewer" : `Show all ${sorted.length}`}
                </button>
            )}
            {hidden > 0 && <p className="meals-muted small">{hidden} hidden by your filters</p>}
        </div>
    );
}

// Short versions of the diet tags people filter by most
const shortTag = (tag: string) => ({ "Vegan": "Vegan", "Vegetarian": "Veg", "Halal Friendly": "Halal", "Made Without Gluten": "No gluten" } as Record<string, string>)[tag] ?? tag;

function Filters({ overview, filters, onChange }: { overview: MealsOverview, filters: MealFilters, onChange: (filters: MealFilters) => void }) {
    const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(entry => entry !== value) : [...list, value];
    // The diet tags worth filtering by; the rest (like "Colors") are nutrition programs
    const diets = overview.dietTags.filter(tag => /vegan|vegetarian|halal|gluten|plant/i.test(tag.label));

    return (
        <div className="meals-filters">
            <div>
                <h3>Only show</h3>
                {diets.map(tag => (
                    <button key={tag.id} type="button" className={cx("meals-chip", filters.diets.includes(tag.label) && "current")} aria-pressed={filters.diets.includes(tag.label)}
                        onClick={() => onChange({ ...filters, diets: toggle(filters.diets, tag.label) })}>{tag.label}</button>
                ))}
            </div>
            <div>
                <h3>Avoid</h3>
                {overview.allergens.map(allergen => (
                    <button key={allergen.id} type="button" className={cx("meals-chip", "avoid", filters.avoid.includes(allergen.label) && "current")} aria-pressed={filters.avoid.includes(allergen.label)}
                        onClick={() => onChange({ ...filters, avoid: toggle(filters.avoid, allergen.label) })}>{allergen.label}</button>
                ))}
                <p className="meals-muted small">Hides dishes tagged with these, or whose ingredients mention them. Dishes with incomplete allergen info aren&apos;t hidden; check each one.</p>
            </div>
        </div>
    );
}
