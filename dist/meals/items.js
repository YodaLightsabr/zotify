/** A list of IDs from "0", "", "57", "39,57", ["39","57"] or JSON text. "0" means none */
function ids(value) {
    if (value === null || value === undefined)
        return [];
    const list = Array.isArray(value) ? value
        : typeof value === "string" && value.trim().startsWith("[") ? safeJson(value) ?? []
            : String(value).split(",");
    return [...new Set(list.map(id => String(id).trim()).filter(id => id && id !== "0"))];
}
function safeJson(text) {
    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
function text(value) {
    const value_ = Array.isArray(value) ? value.join(", ") : value === null || value === undefined ? "" : String(value);
    const trimmed = value_.trim();
    return trimmed && trimmed !== "N/A" ? trimmed : null;
}
function number(value) {
    const parsed = Number.parseFloat(String(value ?? ""));
    // Rounded to two places; the source has six, which is false precision
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}
const label = (map) => (id) => map[id] ?? `Unknown (${id})`;
/** Whether the dining hall hides this item from its online menu */
export const isHidden = (product) => product.attributes.some(attribute => attribute.name === "is_hide_from_web_menu" && /^(yes|1|true)$/i.test(String(attribute.value)));
export function toMenuItem(product, labels) {
    const attributes = new Map(product.attributes.map(attribute => [attribute.name, attribute.value]));
    const get = (name) => attributes.get(name);
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
const ALLERGEN_WORDS = [
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
export function possibleAllergens(ingredients) {
    if (!ingredients)
        return [];
    return ALLERGEN_WORDS
        .filter(({ words, except }) => words.test(except ? ingredients.replace(except, " ") : ingredients))
        .map(({ allergen }) => allergen);
}
//# sourceMappingURL=items.js.map