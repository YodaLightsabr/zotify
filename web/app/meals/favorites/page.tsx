"use client";

import Link from "next/link";
import { Spinner } from "@/components/Spinner";
import { goToLogin } from "@/lib/api";
import { dayLabel, todayIn, useFavorites, useMeals, type MealsOverview, type Serving } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";

/** Your starred dishes, each with when and where it's next on, soonest first */
export default function FavoritesPage() {
    const school = useSchool();
    const { user } = useUser();
    const { favorites, toggle } = useFavorites(school.id);
    const overview = useMeals<MealsOverview>(`/${school.id}`);
    const today = todayIn(overview.data?.timezone ?? "America/Los_Angeles");

    if (user === null) {
        return (
            <main className="meals-main narrow">
                <h1>Favorites</h1>
                <p className="meals-muted">
                    <a href="/login" onClick={event => { event.preventDefault(); goToLogin(); }}>Sign in</a> with your Zotify account to star dishes and see when they&apos;re on next.
                </p>
            </main>
        );
    }

    if (!favorites) return <main className="meals-main narrow"><div className="meals-message"><Spinner /></div></main>;

    // Soonest first; dishes not coming up go last
    const sorted = [...favorites].sort((a, b) => (a.upcoming[0]?.date ?? "9999").localeCompare(b.upcoming[0]?.date ?? "9999"));

    return (
        <main className="meals-main narrow">
            <h1>Favorites</h1>
            {!favorites.length && <p className="meals-muted">No favorites yet. Tap ☆ next to a dish on the <Link href="/">menus</Link> to add it.</p>}
            <ul className="meals-favorites-page">
                {sorted.map(favorite => (
                    <li key={favorite.recipeId} className="meals-favorite-card">
                        <div className="meals-section-head">
                            <h2>{favorite.name}</h2>
                            <button type="button" className="meals-star on" aria-pressed="true" title="Remove from favorites" onClick={() => toggle(favorite)}>★</button>
                        </div>
                        {favorite.upcoming.length ? (
                            <ul className="meals-upcoming">
                                {firstPerMeal(favorite.upcoming).slice(0, 5).map((serving, i) => (
                                    <li key={i}>
                                        <Link href={`/?${new URLSearchParams({ ...(serving.date === today ? {} : { date: serving.date }), period: slug(serving.period), hall: serving.location })}`}>
                                            <strong>{dayLabel(serving.date, today)}</strong> · {serving.period} at {serving.locationName}
                                        </Link>
                                        <span className="meals-muted"> · {serving.station}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="meals-muted">Not on the menu in the next two weeks.</p>
                        )}
                    </li>
                ))}
            </ul>
        </main>
    );
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A dish can be at two counters in the same meal; list each meal once
function firstPerMeal(servings: Serving[]) {
    const seen = new Set<string>();
    return servings.filter(serving => {
        const key = `${serving.date}-${serving.periodId}-${serving.location}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
