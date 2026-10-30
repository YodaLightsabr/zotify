import type { Request, Response } from "express";
import { keepPlaylistSongs } from "../library.js";
import { getPlaylist } from "../playlists.js";
import { fetchTrack, parseTrackId, SpotifyPlaylistUnavailableError } from "../spotify.js";
import { findTrack } from "../trackMatch.js";
import { queryParam, requestVenue } from "./params.js";

/**
 * Finds the Rockbot song for a track: ?title= and ?artist=, e.g. from a Spotify playlist, or ?spotify=, a Spotify track link,
 * whose title and artist are read from Spotify and sent back as track. match is null when it isn't on Rockbot; errors return 502.
 * ?playlist=, the Spotify playlist the track is from, keeps the match with the playlist and adds it to the Libraries of the
 * people who saved it
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
        const found = await findTrack(venueName, { title, artist });
        const playlistId = queryParam(req, "playlist");

        if (found.match && playlistId && /^[A-Za-z0-9]{22}$/.test(playlistId) && getPlaylist(playlistId)) {
            try {
                keepPlaylistSongs(playlistId, [found.match.id]);
            } catch (error) {
                console.error(`Could not keep "${title}" with playlist ${playlistId}:`, error);
            }
        }

        res.json({ ...found, ...(link !== undefined ? { track: { title, artist } } : {}) });
    } catch (error) {
        console.error(`Error finding "${title}" by ${artist} at ${venueName}:`, error);
        res.status(502).json({ error: "Search failed. Please try again." });
    }
}
