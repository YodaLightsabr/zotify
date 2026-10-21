import { IMAGE_WIDTH, THUMBNAIL_WIDTH } from "./config.js";
import type { ElevateProduct } from "./elevate.js";

// Turns Elevate's products into clean menu items. Its attribute values are inconsistent (a single ID can be "0" or "57",
// a list can be a string or an array, numbers are decimal strings), so everything is normalized here

export interface Labels {
    // Allergen ID → label, like "48" → "Peanuts"
    allergens: Record<string, string>;
    // Diet tag ID → label, like "96" → "Vegan"
    dietTags: Record<string, string>;
}

export interface MenuItem {
    sku: string;
    recipeId: string | null;
    name: string;
    description: string | null;
    category: string | null;
    // As written by the dining hall; sub-ingredients in parentheses, often in capitals
    ingredients: string | null;
    allergens: {
        // What the item is tagged with
        tagged: string[];
        // Allergens the data is incomplete for. This means "unknown", not "free from"
        incomplete: string[];
        // The dining hall's own statement, like "Contains: Milk, Wheat"
        statement: string | null;
        // Found by reading the ingredients, not tagged by the dining hall. Derived, so it can be wrong either way; see possibleAllergens
        possibleFromIngredients: string[];
    };
    dietTags: string[];
    serving: string | null;
    // A photo, for about one in five dishes: a large one and a small one for lists. Null when there isn't one
    image: { url: string, thumbnail: string } | null;
    // Per serving; grams unless noted
    nutrition: {
        calories: number | null;
        protein: number | null;
        totalFat: number | null;
        saturatedFat: number | null;
        transFat: number | null;
        cholesterolMg: number | null;
        sodiumMg: number | null;
        totalCarbohydrates: number | null;
        dietaryFiber: number | null;
        sugars: number | null;
        addedSugars: number | null;
    };
    // Where the dining hall lists it on its menu
    position: number | null;
}

/** A list of IDs from "0", "", "57", "39,57", ["39","57"] or JSON text. "0" means none */
function ids(value: unknown): string[] {
    if (value === null || value === undefined) return [];

    const list = Array.isArray(value) ? value
        : typeof value === "string" && value.trim().startsWith("[") ? safeJson(value) ?? []
        : String(value).split(",");

    return [...new Set(list.map(id => String(id).trim()).filter(id => id && id !== "0"))];
}

function safeJson(text: string): unknown[] | null {
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function text(value: unknown): string | null {
    const value_ = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
    const trimmed = value_.trim();
    return trimmed && trimmed !== "N/A" ? trimmed : null;
}

function number(value: unknown): number | null {
    const parsed = Number.parseFloat(String(value ?? ""));
    // Rounded to two places; the source has six, which is false precision
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

const label = (map: Record<string, string>) => (id: string) => map[id] ?? `Unknown (${id})`;

/** A product's photo, sized by its address on Adobe's asset delivery: {url}/as/{name}.jpg?width= */
function imageOf(product: ElevateProduct) {
    const image = product.images?.find(candidate => candidate.roles?.includes("image")) ?? product.images?.[0];
    if (!image?.url?.startsWith("https://")) return null;

    const name = (product.name || "dish").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dish";
    const sized = (width: number) => `${image.url}/as/${name}.jpg?width=${width}&quality=80`;
    return { url: sized(IMAGE_WIDTH), thumbnail: sized(THUMBNAIL_WIDTH) };
}

/** Whether the dining hall hides this item from its online menu */
export const isHidden = (product: ElevateProduct) =>
    product.attributes.some(attribute => attribute.name === "is_hide_from_web_menu" && /^(yes|1|true)$/i.test(String(attribute.value)));

export function toMenuItem(product: ElevateProduct, labels: Labels): MenuItem {
    const attributes = new Map(product.attributes.map(attribute => [attribute.name, attribute.value]));
    const get = (name: string) => attributes.get(name);
    const ingredients = text(get("recipe_ingredients"));
    const tagged = ids(get("allergens_intolerances")).map(label(labels.allergens));
    const statement = text(get("allergen_statement"));

    return {
        sku: product.sku,
        recipeId: text(get("recipe_id")),
        name: text(get("marketing_name")) ?? product.name,
        description: text(get("marketing_description")),
        category: text(get("master_recipe_type")),
        ingredients,
        allergens: {
            tagged,
            incomplete: ids(get("allergens_intolerances_unknown")).map(label(labels.allergens)),
            // "Contains: " with nothing after it says nothing
            statement: statement && !/^contains:?\s*$/i.test(statement) ? statement : null,
            possibleFromIngredients: possibleAllergens(ingredients).filter(allergen => !tagged.includes(allergen))
        },
        dietTags: ids(get("recipe_attributes")).filter(id => labels.dietTags[id]).map(id => labels.dietTags[id]),
        serving: text(get("serving_combined")),
        image: imageOf(product),
        nutrition: {
            calories: number(get("calories")),
            protein: number(get("protein")),
            totalFat: number(get("total_fat")),
            saturatedFat: number(get("saturated_fat")),
            transFat: number(get("trans_fat")),
            cholesterolMg: number(get("cholesterol")),
            sodiumMg: number(get("sodium")),
            totalCarbohydrates: number(get("total_carbohydrates")),
            dietaryFiber: number(get("dietary_fiber")),
            sugars: number(get("sugars")),
            addedSugars: number(get("includes_added_sugars"))
        },
        position: number(get("position_in_menu"))
    };
}

// Allergens that ingredient text mentions, by keyword. The dining hall's tags miss some (Kung Pao Cauliflower lists
// peanuts but isn't tagged for them; coconut is a tree nut on some items and not others), so this flags what the text
// suggests. It's a hint, not a guarantee: it can miss things, and "may contain" warnings count too
const ALLERGEN_WORDS: { allergen: string, words: RegExp, except?: RegExp }[] = [
    { allergen: "Peanuts", words: /\bpeanuts?\b/i, except: /\bpeanut[- ]free\b/gi },
    {
        allergen: "Tree Nuts",
        // Not coconut: the FDA stopped counting it as a tree nut in 2025, which is why the dining hall tags it inconsistently
        words: /\b(almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|filberts?|macadamias?|brazil nuts?|pine nuts?|pignoli|praline|marzipan)\b/i,
        except: /\b(tree )?nut[- ]free\b/gi
    },
    {
        allergen: "Milk",
        words: /\b(milk|butter|buttermilk|cream|cheese|cheddar|mozzarella|parmesan|ricotta|whey|casein(ate)?|yogh?urt|lactose|ghee|curds?)\b/i,
        // Plant milks, butters and cheeses, cream of tartar, and cream of wheat or rice (cereals) aren't dairy
        except: /\b((peanut|almond|cashew|apple|cocoa|nut|seed|sunflower|soy|coconut|oat|rice) (butter|milk|cream)|vegan \w+( \w+)?|cream of (tartar|wheat|rice)|dairy[- ]free|non[- ]?dairy)\b/gi
    },
    { allergen: "Eggs", words: /\b(eggs?|egg whites?|egg yolks?|albumen|mayonnaise|meringue)\b/i, except: /\begg[- ]free\b/gi },
    {
        allergen: "Wheat",
        words: /\b(wheat|flour|semolina|durum|spelt|farro|couscous|seitan|bulgur)\b/i,
        // Flours that aren't wheat
        except: /\b(buckwheat|(rice|corn|masa|almond|coconut|chickpea|garbanzo|tapioca|potato|oat|cassava|soy|mustard|gluten[- ]free) flour|gluten[- ]free)\b/gi
    },
    {
        allergen: "Soy",
        words: /\b(soy|soya|soybeans?|tofu|edamame|miso|tempeh|tamari)\b/i,
        // Highly refined soybean oil is exempt from US allergen labeling, and it's in nearly every dish as part of
        // "Vegetable Oil (May contain one or more of the following: Soybean, Canola...)". Flagging it would bury real warnings
        except: /\b(soy[- ]free|soy(bean)? oil|oil \([^()]*\))/gi
    },
    { allergen: "Fish", words: /\b(fish|salmon|tuna|cod|tilapia|pollock|anchov(y|ies)|halibut|trout|catfish|sardines?|swai|mahi)\b/i },
    { allergen: "Shellfish", words: /\b(shrimp|prawns?|crabs?|lobsters?|crawfish|crayfish|clams?|mussels?|scallops?|oysters?|squid|calamari)\b/i },
    { allergen: "Sesame", words: /\b(sesame|tahini|benne)\b/i }
];

/** Allergens the ingredient text mentions (see ALLERGEN_WORDS). Derived, so it can be wrong */
export function possibleAllergens(ingredients: string | null) {
    if (!ingredients) return [];

    return ALLERGEN_WORDS
        .filter(({ words, except }) => words.test(except ? ingredients.replace(except, " ") : ingredients))
        .map(({ allergen }) => allergen);
}
