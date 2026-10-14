import { fetchPlaylist, parsePlaylistId, SpotifyPlaylistUnavailableError } from "../spotify.js";
import { queryParam } from "./params.js";
/** Returns a public Spotify playlist's name and tracks. Takes the pasted link as ?url= */
export async function spotifyPlaylist(req, res) {
    const id = parsePlaylistId(queryParam(req, "url") ?? "");
    if (!id) {
        res.status(400).json({ error: "That doesn't look like a Spotify playlist link." });
        return;
    }
    try {
        res.json(await fetchPlaylist(id));
    }
    catch (error) {
        if (error instanceof SpotifyPlaylistUnavailableError) {
            res.status(404).json({ error: "Couldn't read that playlist. It's private or doesn't exist. Only public playlists work for now." });
            return;
        }
        console.error(`Error reading Spotify playlist ${id}:`, error);
        res.status(502).json({ error: "Couldn't read that playlist from Spotify. Please try again." });
    }
}
//# sourceMappingURL=spotify-playlist.js.map