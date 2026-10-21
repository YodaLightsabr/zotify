"use client";

import { useEffect, useRef } from "react";
import { dayLabel, useMeals, type Favorite, type MealItem } from "@/lib/meals";
import { useSchool } from "@/lib/school";

interface Props {
    item: MealItem | null;
    // Where it's being looked at, like "Brandywine · Ember"
    where: string | null;
    today: string;
    favorite: Favorite | undefined;
    signedIn: boolean;
    onToggleFavorite: (item: MealItem) => void;
    onClose: () => void;
}

const NUTRITION: [keyof MealItem["nutrition"], string, string][] = [
    ["calories", "Calories", ""], ["protein", "Protein", "g"], ["totalCarbohydrates", "Carbs", "g"], ["totalFat", "Fat", "g"],
    ["saturatedFat", "Saturated fat", "g"], ["dietaryFiber", "Fiber", "g"], ["sugars", "Sugars", "g"], ["addedSugars", "Added sugars", "g"],
    ["sodiumMg", "Sodium", "mg"], ["cholesterolMg", "Cholesterol", "mg"]
];

const round = (value: number) => value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;

/** A dish's details: description, nutrition, allergens, ingredients, and when it's served next */
export default function ItemDialog({ item, where, today, favorite, signedIn, onToggleFavorite, onClose }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);
    const school = useSchool();

    useEffect(() => {
        if (item && !dialog.current?.open) dialog.current?.showModal();
        if (!item && dialog.current?.open) dialog.current.close();
    }, [item]);

    // Where else this exact item is served, for dishes that aren't favorites (favorites already know theirs)
    const served = useMeals<{ servedAt: { date: string, location: string, period: string | null }[] }>(item && !favorite ? `/${school.id}/items/${encodeURIComponent(item.sku)}` : null);
    const upcoming = favorite?.upcoming.map(serving => ({ date: serving.date, where: `${serving.period} at ${serving.locationName}` }))
        ?? served.data?.servedAt.filter(serving => serving.date >= today).map(serving => ({ date: serving.date, where: `${serving.period ?? "A meal"} at ${school.venueName(serving.location)}` }))
        ?? [];

    return (
        <dialog ref={dialog} className="meals-dialog" aria-labelledby="meals-dialog-title" onClose={onClose}>
            {item && <>
                <div className="meals-dialog-head">
                    <div>
                        <h2 id="meals-dialog-title">{item.name}</h2>
                        {where && <p className="meals-muted">{where}</p>}
                    </div>
                    {item.recipeId && (
                        <button type="button" className={favorite ? "meals-star on" : "meals-star"} onClick={() => onToggleFavorite(item)}
                            aria-pressed={!!favorite} title={signedIn ? (favorite ? "Remove from favorites" : "Add to favorites") : "Sign in to save favorites"}>
                            {favorite ? "★ Favorite" : "☆ Favorite"}
                        </button>
                    )}
                </div>

                {item.description && <p>{item.description}</p>}
                {item.dietTags.length > 0 && <div className="meals-tags">{item.dietTags.map(tag => <span key={tag} className="meals-tag">{tag}</span>)}</div>}

                <h3>Allergens</h3>
                {item.allergens.tagged.length > 0
                    ? <p><strong>Contains:</strong> {item.allergens.tagged.join(", ")}</p>
                    : <p className="meals-muted">None tagged.</p>}
                {item.allergens.possibleFromIngredients.length > 0 && (
                    <p className="meals-warning">
                        <strong>Also mentioned in the ingredients:</strong> {item.allergens.possibleFromIngredients.join(", ")}.
                        <span className="meals-muted"> Read from the ingredient list by Zotify, not tagged by the dining hall, so double-check.</span>
                    </p>
                )}
                {item.allergens.incomplete.length > 0 && (
                    <p className="meals-warning">
                        <strong>Incomplete information for:</strong> {item.allergens.incomplete.join(", ")}.
                        <span className="meals-muted"> Not the same as allergen-free; ask the dining hall.</span>
                    </p>
                )}

                <h3>Nutrition{item.serving ? <span className="meals-muted"> · per {item.serving}</span> : null}</h3>
                <dl className="meals-nutrition">
                    {NUTRITION.filter(([key]) => item.nutrition[key] !== null).map(([key, label, unit]) => (
                        <div key={key}><dt>{label}</dt><dd>{round(item.nutrition[key]!)}{unit}</dd></div>
                    ))}
                </dl>

                {item.ingredients && <>
                    <h3>Ingredients</h3>
                    <p className="meals-ingredients">{item.ingredients}</p>
                </>}

                <h3>Coming up</h3>
                {upcoming.length
                    ? <ul className="meals-upcoming">{upcoming.slice(0, 6).map((serving, i) => <li key={i}><strong>{dayLabel(serving.date, today)}</strong> · {serving.where}</li>)}</ul>
                    : <p className="meals-muted">{favorite || served.data ? "Not on the menu in the next two weeks." : "Checking…"}</p>}

                <div className="meals-dialog-actions"><button type="button" className="meals-button" onClick={onClose}>Close</button></div>
            </>}
        </dialog>
    );
}

