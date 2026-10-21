// Everything about talking to Aramark's "Elevate" platform in one place. It's the GraphQL API behind each school's
// mydininghub.com site (uci.mydininghub.com for UCI). It's undocumented and unofficial, so if it changes, this is where to look.
//
// Headers, as of October 2026: without x-api-key the CDN answers 403, and without store it answers "450 Missing required
// input params". Menus (getLocationRecipes) also need the magento-* headers, or the catalog service says "Missing catalog".
// The site's magento-customer-group and x-magento-cache-id hash headers aren't needed. Each school's values are its
// dining config in the database (see DiningConfig), so a school is added without code changes

export const ELEVATE_URL = "https://api.elevate-dxp.com/api/mesh/c087f756-cc72-4649-a36f-3a41b700c519/graphql";
export const ELEVATE_API_KEY = "ElevateAPIProd";

/** A school's store on Elevate. UCI's: { storeCode: "ch_uci", storeViewCode: "ch_uci_en", clientPath: "ch/uci/en", campusUrlKey: "campus" } */
export interface DiningConfig {
    // Magento's store and website code, e.g. ch_uci
    storeCode: string;
    // The store view, e.g. ch_uci_en; also sent as the "store" header
    storeViewCode: string;
    // AEM's path for the school's site, e.g. ch/uci/en
    clientPath: string;
    // The campus every location belongs to; "campus" at UCI
    campusUrlKey: string;
}

export function elevateHeaders(config: DiningConfig): Record<string, string> {
    return {
        "x-api-key": ELEVATE_API_KEY,
        "store": config.storeViewCode,
        "magento-store-code": config.storeCode,
        "magento-website-code": config.storeCode,
        "magento-store-view-code": config.storeViewCode,
        "aem-elevate-clientpath": config.clientPath,
        "content-type": "application/json"
    };
}

// Being polite: how many requests run at once, the gap between starting them, and how long one may take
export const MAX_CONCURRENT_REQUESTS = 4;
export const MIN_REQUEST_GAP_MS = 100;
export const REQUEST_TIMEOUT_MS = 20_000;
// A failed request is tried this many more times, waiting longer each time
export const RETRIES = 2;
export const RETRY_DELAY_MS = 2_000;

// What's kept fresh: two weeks of menus from today, fetched nightly (and on first start). Today and tomorrow are fetched
// again more often, since menus can change on the day
export const DAYS_AHEAD = 14;
export const NIGHTLY_SYNC_HOUR = 3;
export const NEAR_TERM_DAYS = 2;
export const NEAR_TERM_REFRESH_MS = 60 * 60 * 1000;

// The site notes 30-45 minute "transitional periods" between meals, when the full menu may not be out
export const TRANSITION_NOTE = "Between meal periods there's a 30–45 minute transition when the full menu may not be available.";

// Bumped whenever saved items gain or change fields; a server with a newer version re-fetches the next two weeks on
// start instead of waiting for the night. 2: images
export const ITEM_VERSION = 2;

// Item photos are on Adobe's asset delivery, which resizes by address: {url}/as/{name}.jpg?width=320
export const THUMBNAIL_WIDTH = 320;
export const IMAGE_WIDTH = 1200;

// Only the product fields Zotify uses. Without this, every product carries prices, payment methods and more,
// about 3.5× the size. The names must be written into the query; the catalog service doesn't receive variables
export const ITEM_ATTRIBUTES = [
    "recipe_id", "marketing_name", "marketing_description", "recipe_ingredients", "allergens_intolerances",
    "allergens_intolerances_unknown", "allergen_statement", "recipe_attributes", "calories", "protein", "total_fat",
    "saturated_fat", "trans_fat", "cholesterol", "sodium", "total_carbohydrates", "dietary_fiber", "sugars",
    "includes_added_sugars", "serving_combined", "position_in_menu", "is_hide_from_web_menu", "master_recipe_type"
];
