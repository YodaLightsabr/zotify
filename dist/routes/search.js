import { searchSongs } from "../songSearch.js";
import { parseVenue, queryParam } from "./params.js";
export async function search(req, res) {
    const query = queryParam(req, "q");
    const venueName = parseVenue(queryParam(req, "venue"), res);
    if (!query) {
        res.status(400).json({ error: "Missing search query" });
        return;
    }
    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }
    try {
        const { songs, cacheHit } = await searchSongs(venueName, query);
        res.set("X-Cache", cacheHit ? "HIT" : "MISS").json(songs);
    }
    catch (error) {
        console.error(`Error searching for "${query}" at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
//# sourceMappingURL=search.js.map