import { findTrack } from "../trackMatch.js";
import { parseVenue, queryParam } from "./params.js";
/** Finds the Rockbot song for a track, e.g. from a Spotify playlist. match is null when it isn't on Rockbot; errors return 502 */
export async function match(req, res) {
    const title = queryParam(req, "title");
    const artist = queryParam(req, "artist");
    const venueName = parseVenue(queryParam(req, "venue"));
    if (!title || !artist) {
        res.status(400).json({ error: "Missing title or artist" });
        return;
    }
    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${queryParam(req, "venue")}"` });
        return;
    }
    try {
        res.json(await findTrack(venueName, { title, artist }));
    }
    catch (error) {
        console.error(`Error finding "${title}" by ${artist} at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
//# sourceMappingURL=match.js.map