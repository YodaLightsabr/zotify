// Serving counters go by different names in each dining hall (UCI's Anteatery has "Farmer's Market" where Brandywine has
// "The Farm Stand- Salad"), and the dining site lists them in its own order. Zotify sorts every hall's counters into the
// same kinds, in the same order, like walking down a line: mains first, then the salad bar, soup and desserts

export interface StationKind {
    id: string;
    name: string;
    // Counter names known to be this kind, like "Farmer's Market"
    exact: string[];
    // Keywords for counters not listed, so new halls mostly sort themselves
    keywords: RegExp;
}

export const STATION_KINDS: StationKind[] = [
    { id: "home", name: "Home-Style", exact: ["Home", "Grubb"], keywords: /home[- ]?style|comfort|classics/i },
    { id: "global", name: "Global", exact: ["Fire and Ice", "Compass", "Crossroads"], keywords: /global|international|world|fusion/i },
    { id: "grill", name: "Grill", exact: ["Sizzle Grill", "Ember"], keywords: /grill|burger/i },
    { id: "pizza", name: "Pizza", exact: ["Oven", "Hearth"], keywords: /pizza|flatbread/i },
    { id: "pasta", name: "Pasta & Noodles", exact: ["Noodle Bar", "Saute"], keywords: /noodle|pasta|wok|stir[- ]?fry/i },
    { id: "plant-based", name: "Plant-Based", exact: ["The Twisted Root"], keywords: /plant|vegan|root/i },
    { id: "deli", name: "Deli", exact: ["Deli", "The Farm Stand- Deli"], keywords: /deli|sandwich|panini/i },
    { id: "salad", name: "Salad Bar", exact: ["Farmer's Market", "The Farm Stand- Salad"], keywords: /salad|farm|market|produce/i },
    { id: "soup", name: "Soup", exact: ["Soups"], keywords: /soup|chowder/i },
    { id: "dessert", name: "Bakery & Desserts", exact: ["Bakery", "Honeycakes"], keywords: /bake|dessert|sweet|cake|pastry|cookie/i },
    { id: "specials", name: "Specials", exact: ["Promotions"], keywords: /promo|special|feature|limited/i }
];

const OTHER = { id: "other", name: "More" };

/** Which kind a counter is: by its exact name first, then by keywords */
export function stationKind(name: string) {
    const trimmed = name.trim().toLowerCase();
    return STATION_KINDS.find(kind => kind.exact.some(exact => exact.toLowerCase() === trimmed))
        ?? STATION_KINDS.find(kind => kind.keywords.test(trimmed))
        ?? OTHER;
}

/** Where a kind goes; unknown counters go just before Specials */
export function kindOrder(kindId: string) {
    const index = STATION_KINDS.findIndex(kind => kind.id === kindId);
    return index >= 0 ? index : STATION_KINDS.findIndex(kind => kind.id === "specials") - 0.5;
}

/** Sorts counters into the shared order. Two of the same kind (like Brandywine's two global counters) keep the dining site's order */
export function sortStations<T extends { name: string }>(stations: T[]) {
    return stations
        .map((station, index) => ({ station, index, kind: stationKind(station.name) }))
        .sort((a, b) => kindOrder(a.kind.id) - kindOrder(b.kind.id) || a.index - b.index)
        // order lets pages line up the same kinds across halls
        .map(({ station, kind }) => ({ ...station, kind: { id: kind.id, name: kind.name, order: kindOrder(kind.id) } }));
}
