import { Action, ActionPanel, Color, Icon, Image, Keyboard, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise, useLocalStorage, withAccessToken } from "@raycast/utils";
import { useEffect, useState } from "react";
import { offerToSignInAgain, SITE_URL, zotify, zotifyAuth, ZotifyError } from "./zotify";

// Zotify Meals: the dining halls' menus (public), with your favorite dishes (signed in). A meal is picked in the search bar's
// dropdown, from both halls' hours; dishes are grouped by kind of counter across the halls, like the website, with a detail
// pane for each. See UX.md

const SCHOOL = "uci";
const TIMEZONE = "America/Los_Angeles";
const MEALS_URL = SITE_URL.replace("www.", "meals.");
const DAYS = 7;

interface Hours {
  date: string;
  periods: { period: string; opens: string; closes: string }[];
}

interface Hall {
  id: string;
  name: string;
  hours: Hours[];
}

export interface Dish {
  sku: string;
  recipeId: string | null;
  name: string;
  description: string | null;
  ingredients: string | null;
  allergens: { tagged: string[]; incomplete: string[]; possibleFromIngredients: string[] };
  dietTags: string[];
  serving: string | null;
  image: { url: string; thumbnail: string } | null;
  nutrition: Record<string, number | null>;
}

interface Station {
  id: number;
  name: string;
  kind: { id: string; name: string; order: number };
  items: Dish[];
}

interface Day {
  location: string;
  name: string;
  periods: { name: string; slug: string; stations: Station[] }[];
}

interface Favorite {
  recipeId: string;
  name: string;
  upcoming: { date: string; locationName: string; period: string; station: string }[];
}

interface Overview {
  allergens: { id: string; label: string }[];
  dietTags: { id: string; label: string }[];
  locations: { id: string; name: string }[];
}

interface Filters {
  diets: string[];
  avoid: string[];
}

const todayIn = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const nowIn = () =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(),
  );
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Today", "Tomorrow", or "Sat, Oct 26" */
export function dayName(date: string) {
  const today = todayIn();
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "16:30" → "4:30 PM" */
const clock = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours >= 12 && hours < 24 ? "PM" : "AM"}`;
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Whether a dish has every wanted diet tag and none of the allergens to avoid (tagged, or found in its ingredients) */
function suits(dish: Dish, filters: Filters) {
  const allergens = [...dish.allergens.tagged, ...dish.allergens.possibleFromIngredients];
  return (
    filters.diets.every((diet) => dish.dietTags.includes(diet)) &&
    filters.avoid.every((allergen) => !allergens.includes(allergen))
  );
}

/** Every meal served in the next week at either hall, in order: { date, period, opens, closes } */
function mealsOf(halls: Hall[]) {
  const meals = new Map<string, { date: string; period: string; opens: string; closes: string }>();

  for (const hall of halls) {
    for (const day of hall.hours.slice(0, DAYS)) {
      for (const { period, opens, closes } of day.periods) {
        const key = `${day.date}|${slug(period)}`;
        const known = meals.get(key);
        meals.set(key, {
          date: day.date,
          period,
          opens: known && known.opens < opens ? known.opens : opens,
          closes: known && known.closes > closes ? known.closes : closes,
        });
      }
    }
  }

  return [...meals.entries()]
    .map(([key, meal]) => ({ key, ...meal }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.opens.localeCompare(b.opens));
}

function Meals() {
  const overview = useCachedPromise(() => zotify<Overview>(`/v1/meals/${SCHOOL}`, { token: null }), [], {
    keepPreviousData: true,
  });
  const locations = overview.data?.locations ?? [];

  const halls = useCachedPromise(
    (ids: string) =>
      Promise.all(ids.split(",").map((id) => zotify<Hall>(`/v1/meals/${SCHOOL}/${id}`, { token: null }))),
    [locations.map((location) => location.id).join(",")],
    { execute: locations.length > 0, keepPreviousData: true },
  );

  const meals = mealsOf(halls.data ?? []);
  const [selected, setSelected] = useState<string | undefined>();

  // Start on the meal being served now, or the next one
  const now = `${todayIn()}|${nowIn()}`;
  const current = meals.find((meal) => `${meal.date}|${meal.closes}` > now)?.key ?? meals[0]?.key;
  const key = selected ?? current;
  const meal = meals.find((candidate) => candidate.key === key);

  const days = useCachedPromise(
    (date: string, ids: string) =>
      Promise.all(ids.split(",").map((id) => zotify<Day>(`/v1/meals/${SCHOOL}/${id}/${date}`, { token: null }))),
    [meal?.date ?? "", locations.map((location) => location.id).join(",")],
    { execute: !!meal, keepPreviousData: true },
  );

  const favorites = useCachedPromise(() => zotify<Favorite[]>(`/v1/meals/${SCHOOL}/favorites`), [], {
    keepPreviousData: true,
    onError: (error) => {
      if (error instanceof ZotifyError && error.code === "insufficient_scope") offerToSignInAgain("meals", "favorites");
    },
  });
  const favoriteIds = new Set(favorites.data?.map((favorite) => favorite.recipeId));

  const stored = useLocalStorage<Filters>("meals-filters", { diets: [], avoid: [] });
  const filters = stored.value ?? { diets: [], avoid: [] };

  async function toggleFavorite(dish: Dish) {
    if (!dish.recipeId) return;
    const remove = favoriteIds.has(dish.recipeId);
    const path = `/v1/meals/${SCHOOL}/favorites/${encodeURIComponent(dish.recipeId)}`;

    try {
      await favorites.mutate(
        zotify(path, remove ? { method: "DELETE" } : { method: "PUT", body: { name: dish.name } }),
        {
          optimisticUpdate: (data) =>
            remove
              ? data?.filter((favorite) => favorite.recipeId !== dish.recipeId)
              : [...(data ?? []), { recipeId: dish.recipeId!, name: dish.name, upcoming: [] }],
        },
      );
      await showToast({
        style: Toast.Style.Success,
        title: remove ? `Removed ${dish.name}` : `Added ${dish.name} to favorites`,
      });
    } catch (error) {
      if (error instanceof ZotifyError && error.code === "insufficient_scope")
        return offerToSignInAgain("meals", "favorites");
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't change favorites",
        message: (error as Error).message,
      });
    }
  }

  // Every dish in the meal, by kind of counter across the halls, in the same order at each
  const entries = (days.data ?? []).flatMap((day) =>
    (day.periods.find((period) => meal && slug(period.name) === slug(meal.period))?.stations ?? []).flatMap((station) =>
      station.items.map((dish) => ({ dish, station, hall: day.name })),
    ),
  );
  const shown = entries.filter(({ dish }) => suits(dish, filters));
  const kinds = [...new Map(shown.map(({ station }) => [station.kind.id, station.kind])).values()].sort(
    (a, b) => a.order - b.order,
  );
  const favorite = shown.filter(({ dish }) => dish.recipeId && favoriteIds.has(dish.recipeId));
  const hidden = entries.length - shown.length;

  const index = meals.findIndex((candidate) => candidate.key === key);
  const step = (by: number) => meals[index + by] && setSelected(meals[index + by].key);

  const dishItem = ({ dish, station, hall }: (typeof entries)[number], prefix: string) => {
    const starred = !!dish.recipeId && favoriteIds.has(dish.recipeId);

    return (
      <List.Item
        key={`${prefix}-${hall}-${station.id}-${dish.sku}`}
        title={dish.name}
        subtitle={station.name}
        icon={starred ? { source: Icon.Star, tintColor: Color.Yellow } : dishIcon(dish)}
        keywords={[hall, station.name, ...dish.dietTags]}
        accessories={[{ tag: hall }]}
        detail={<DishDetail dish={dish} hall={hall} station={station.name} />}
        actions={
          <ActionPanel title={dish.name}>
            {dish.recipeId && (
              <Action
                title={starred ? "Remove from Favorites" : "Add to Favorites"}
                icon={starred ? Icon.StarDisabled : Icon.Star}
                shortcut={Keyboard.Shortcut.Common.Pin}
                onAction={() => toggleFavorite(dish)}
              />
            )}
            <Action.Push
              title="Show Favorite Dishes"
              icon={Icon.Star}
              shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
              target={<FavoritesView onChange={favorites.revalidate} />}
            />
            <ActionPanel.Section title="Meal">
              <Action
                title="Next Meal"
                icon={Icon.ArrowRight}
                shortcut={{ modifiers: ["cmd"], key: "]" }}
                onAction={() => step(1)}
              />
              <Action
                title="Previous Meal"
                icon={Icon.ArrowLeft}
                shortcut={{ modifiers: ["cmd"], key: "[" }}
                onAction={() => step(-1)}
              />
            </ActionPanel.Section>
            <ActionPanel.Section title="Filters">
              <FilterSubmenu
                title="Diet…"
                icon={Icon.Leaf}
                shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
                options={overview.data?.dietTags.map((tag) => tag.label) ?? []}
                chosen={filters.diets}
                onChange={(diets) => stored.setValue({ ...filters, diets })}
              />
              <FilterSubmenu
                title="Avoid Allergens…"
                icon={Icon.ExclamationMark}
                shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                options={overview.data?.allergens.map((allergen) => allergen.label) ?? []}
                chosen={filters.avoid}
                onChange={(avoid) => stored.setValue({ ...filters, avoid })}
              />
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action.CopyToClipboard
                title="Copy Dish Name"
                content={dish.name}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action.OpenInBrowser
                title="Open Zotify Meals"
                url={MEALS_URL}
                shortcut={Keyboard.Shortcut.Common.Open}
              />
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={overview.isLoading || halls.isLoading || days.isLoading}
      isShowingDetail={shown.length > 0}
      searchBarPlaceholder="Search dishes, counters and diets…"
      searchBarAccessory={
        <List.Dropdown tooltip="Meal" value={key} onChange={setSelected}>
          {[...new Set(meals.map((candidate) => candidate.date))].map((date) => (
            <List.Dropdown.Section key={date} title={dayName(date)}>
              {meals
                .filter((candidate) => candidate.date === date)
                .map((candidate) => (
                  <List.Dropdown.Item
                    key={candidate.key}
                    value={candidate.key}
                    title={`${dayName(date)} · ${candidate.period} · ${clock(candidate.opens)}–${clock(candidate.closes)}`}
                    keywords={[candidate.period]}
                  />
                ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Mug}
        title={entries.length ? "Nothing matches your filters" : "No menu yet"}
        description={
          entries.length
            ? `${hidden} dishes are hidden by your diet and allergen filters.`
            : "The dining halls haven't published this meal's menu."
        }
        actions={
          <ActionPanel>
            <Action
              title="Clear Filters"
              icon={Icon.XMarkCircle}
              onAction={() => stored.setValue({ diets: [], avoid: [] })}
            />
            <Action title="Next Meal" icon={Icon.ArrowRight} onAction={() => step(1)} />
          </ActionPanel>
        }
      />

      {favorite.length > 0 && (
        <List.Section title="Your Favorites" subtitle={String(favorite.length)}>
          {favorite.map((entry) => dishItem(entry, "favorite"))}
        </List.Section>
      )}

      {kinds.map((kind) => {
        const here = shown.filter(({ station }) => station.kind.id === kind.id);
        return (
          <List.Section key={kind.id} title={kind.name} subtitle={String(here.length)}>
            {here.map((entry) => dishItem(entry, kind.id))}
          </List.Section>
        );
      })}
    </List>
  );
}

/** A dish's photo when it has one; otherwise a leaf for vegan and vegetarian dishes, and a dot for the rest */
const dishIcon = (dish: Dish): Image.ImageLike =>
  dish.image
    ? { source: dish.image.thumbnail, mask: Image.Mask.RoundedRectangle }
    : dish.dietTags.some((tag) => /vegan|vegetarian/i.test(tag))
      ? { source: Icon.Leaf, tintColor: Color.Green }
      : { source: Icon.Dot, tintColor: Color.SecondaryText };

const NUTRITION: [string, string, string][] = [
  ["calories", "Calories", ""],
  ["protein", "Protein", "g"],
  ["totalCarbohydrates", "Carbs", "g"],
  ["totalFat", "Fat", "g"],
  ["sugars", "Sugars", "g"],
  ["sodiumMg", "Sodium", "mg"],
];

function DishDetail({ dish, hall, station }: { dish: Dish; hall: string; station: string }) {
  const round = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
  const markdown = [
    dish.image ? `![${dish.name}](${dish.image.url}?raycast-height=180)` : null,
    `## ${dish.name}`,
    dish.description,
    dish.ingredients ? `**Ingredients:** ${dish.ingredients}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Where" text={`${hall} · ${station}`} />
          {dish.serving && <List.Item.Detail.Metadata.Label title="Serving" text={dish.serving} />}
          {dish.dietTags.length > 0 && (
            <List.Item.Detail.Metadata.TagList title="Diet">
              {dish.dietTags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} color={Color.Green} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          )}
          <List.Item.Detail.Metadata.TagList title="Contains">
            {dish.allergens.tagged.length ? (
              dish.allergens.tagged.map((allergen) => (
                <List.Item.Detail.Metadata.TagList.Item key={allergen} text={allergen} color={Color.Orange} />
              ))
            ) : (
              <List.Item.Detail.Metadata.TagList.Item text="None tagged" color={Color.SecondaryText} />
            )}
          </List.Item.Detail.Metadata.TagList>
          {dish.allergens.possibleFromIngredients.length > 0 && (
            <List.Item.Detail.Metadata.Label
              title="Also in the Ingredients"
              text={dish.allergens.possibleFromIngredients.join(", ")}
              icon={{ source: Icon.Warning, tintColor: Color.Orange }}
            />
          )}
          {dish.allergens.incomplete.length > 0 && (
            <List.Item.Detail.Metadata.Label
              title="Incomplete Information"
              text={dish.allergens.incomplete.join(", ")}
              icon={Icon.QuestionMarkCircle}
            />
          )}
          <List.Item.Detail.Metadata.Separator />
          {NUTRITION.filter(([field]) => dish.nutrition[field] !== null && dish.nutrition[field] !== undefined).map(
            ([field, label, unit]) => (
              <List.Item.Detail.Metadata.Label
                key={field}
                title={label}
                text={`${round(dish.nutrition[field]!)}${unit}`}
              />
            ),
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

/** Picks diet tags or allergens: each one toggles, with a checkmark on the chosen ones */
function FilterSubmenu(props: {
  title: string;
  icon: Image.ImageLike;
  shortcut: Keyboard.Shortcut;
  options: string[];
  chosen: string[];
  onChange: (chosen: string[]) => void;
}) {
  return (
    <ActionPanel.Submenu title={props.title} icon={props.icon} shortcut={props.shortcut}>
      {props.chosen.length > 0 && <Action title="Clear" icon={Icon.XMarkCircle} onAction={() => props.onChange([])} />}
      {props.options.map((option) => {
        const on = props.chosen.includes(option);
        return (
          <Action
            key={option}
            title={option}
            icon={on ? Icon.CheckCircle : Icon.Circle}
            onAction={() =>
              props.onChange(on ? props.chosen.filter((entry) => entry !== option) : [...props.chosen, option])
            }
          />
        );
      })}
    </ActionPanel.Submenu>
  );
}

/** Your favorite dishes, each with when it's served next. onChange tells the menu behind it to fetch them again */
function FavoritesView({ onChange }: { onChange: () => void }) {
  const favorites = useCachedPromise(() => zotify<Favorite[]>(`/v1/meals/${SCHOOL}/favorites`), [], {
    keepPreviousData: true,
  });
  const { pop } = useNavigation();

  async function remove(favorite: Favorite) {
    try {
      await favorites.mutate(
        zotify(`/v1/meals/${SCHOOL}/favorites/${encodeURIComponent(favorite.recipeId)}`, { method: "DELETE" }),
        {
          optimisticUpdate: (data) => data?.filter((entry) => entry.recipeId !== favorite.recipeId),
        },
      );
      onChange();
      await showToast({ style: Toast.Style.Success, title: `Removed ${favorite.name}` });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't change favorites",
        message: (error as Error).message,
      });
    }
  }

  useEffect(() => {
    if (favorites.error instanceof ZotifyError && favorites.error.code === "insufficient_scope") {
      offerToSignInAgain("meals", "favorites");
    }
  }, [favorites.error]);

  const sorted = [...(favorites.data ?? [])].sort(
    (a, b) =>
      (a.upcoming[0]?.date ?? "9999").localeCompare(b.upcoming[0]?.date ?? "9999") || a.name.localeCompare(b.name),
  );

  return (
    <List isLoading={favorites.isLoading} navigationTitle="Favorite Dishes" searchBarPlaceholder="Filter favorites…">
      <List.EmptyView
        icon={Icon.Star}
        title="No favorites yet"
        description="Add dishes to your favorites (⌘.) to see when they're next served."
      />
      <List.Section title="Coming Up">
        {sorted
          .filter((favorite) => favorite.upcoming.length)
          .map((favorite) => (
            <FavoriteItem key={favorite.recipeId} favorite={favorite} onRemove={() => remove(favorite)} onBack={pop} />
          ))}
      </List.Section>
      <List.Section title="Not on the Menu in the Next Two Weeks">
        {sorted
          .filter((favorite) => !favorite.upcoming.length)
          .map((favorite) => (
            <FavoriteItem key={favorite.recipeId} favorite={favorite} onRemove={() => remove(favorite)} onBack={pop} />
          ))}
      </List.Section>
    </List>
  );
}

function FavoriteItem({
  favorite,
  onRemove,
  onBack,
}: {
  favorite: Favorite;
  onRemove: () => void;
  onBack: () => void;
}) {
  const next = favorite.upcoming[0];

  return (
    <List.Item
      title={favorite.name}
      icon={{ source: Icon.Star, tintColor: Color.Yellow }}
      subtitle={next ? `${dayName(next.date)} · ${next.period} at ${next.locationName}` : undefined}
      accessories={
        favorite.upcoming.length > 1
          ? [{ text: `${favorite.upcoming.length} times`, tooltip: "In the next two weeks" }]
          : []
      }
      actions={
        <ActionPanel title={favorite.name}>
          <Action title="Back to the Menu" icon={Icon.ArrowLeft} onAction={onBack} />
          <Action
            title="Remove from Favorites"
            icon={Icon.StarDisabled}
            style={Action.Style.Destructive}
            shortcut={Keyboard.Shortcut.Common.Pin}
            onAction={onRemove}
          />
          <Action.CopyToClipboard
            title="Copy Dish Name"
            content={favorite.name}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        </ActionPanel>
      }
    />
  );
}

export default withAccessToken(zotifyAuth)(Meals);
