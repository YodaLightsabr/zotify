import type { Request, Response } from "express";
import { fetchTrack, parseTrackId, SpotifyPlaylistUnavailableError } from "../spotify.js";
import { findTrack } from "../trackMatch.js";
import { queryParam, requestVenue } from "./params.js";

/**
 * Finds the Rockbot song for a track: ?title= and ?artist=, e.g. from a Spotify playlist, or ?spotify=, a Spotify track link,
 * whose title and artist are read from Spotify and sent back as track. match is null when it isn't on Rockbot; errors return 502
 */
export async function match(req: Request, res: Response) {
    const link = queryParam(req, "spotify");
    const venueName = requestVenue(res);
    let title = queryParam(req, "title");
    let artist = queryParam(req, "artist");

    if (link !== undefined) {
        const id = parseTrackId(link);
        if (!id) return void res.status(400).json({ error: "That doesn't look like a Spotify track link.", code: "invalid_request" });

        try {
            ({ title, artist } = await fetchTrack(id));
        } catch (error) {
            if (error instanceof SpotifyPlaylistUnavailableError) {
                return void res.status(404).json({ error: "Spotify doesn't have that track, or it isn't available.", code: "not_found" });
            }

            console.error(`Error reading Spotify track ${id}:`, error);
            return void res.status(502).json({ error: "Couldn't read that track from Spotify. Please try again." });
        }
    }

    if (!title || !artist) {
        res.status(400).json({ error: "Missing title or artist", code: "invalid_request" });
        return;
    }

    try {
        res.json({ ...(await findTrack(venueName, { title, artist })), ...(link !== undefined ? { track: { title, artist } } : {}) });
    } catch (error) {
        console.error(`Error finding "${title}" by ${artist} at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
