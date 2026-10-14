// Reads public Spotify playlists from the embed page Spotify serves for website widgets, which needs no API key.
// Private playlists aren't available there, and the embed seems to stop at 100 tracks.
export class SpotifyPlaylistUnavailableError extends Error {
    constructor(id) {
        super(`Spotify playlist ${id} isn't public, or doesn't exist`);
        this.name = "SpotifyPlaylistUnavailableError";
    }
}
const EMBED_TRACK_LIMIT = 100;
/** Finds a playlist ID in a pasted link or URI, e.g. https://open.spotify.com/playlist/{id}?si=… or spotify:playlist:{id} */
export function parsePlaylistId(text) {
    const match = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})/i)
        ?? text.match(/spotify:playlist:([A-Za-z0-9]{22})/i);
    return match?.[1] ?? null;
}
export async function fetchPlaylist(id) {
    // Only ever request Spotify's own embed URL built from a validated ID
    if (!/^[A-Za-z0-9]{22}$/.test(id))
        throw new Error("Invalid playlist ID");
    const response = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 404)
        throw new SpotifyPlaylistUnavailableError(id);
    if (!response.ok)
        throw new Error(`Spotify returned ${response.status}`);
    const html = await response.text();
    const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!nextData)
        throw new Error("Spotify's embed page didn't include playlist data");
    const pageProps = JSON.parse(nextData)?.props?.pageProps;
    // Private and missing playlists render a "Page not found" page instead of the playlist
    if (pageProps?.status === "404" || pageProps?.status === 404)
        throw new SpotifyPlaylistUnavailableError(id);
    const entity = pageProps?.state?.data?.entity;
    if (!entity || !Array.isArray(entity.trackList))
        throw new Error("Spotify's embed page didn't include a track list");
    const tracks = entity.trackList.map((track) => ({
        title: String(track.title ?? ""),
        artist: String(track.subtitle ?? ""),
        durationMs: typeof track.duration === "number" ? track.duration : undefined,
        uri: typeof track.uri === "string" ? track.uri : undefined
    }));
    return {
        id,
        name: String(entity.name ?? entity.title ?? "Untitled playlist"),
        owner: entity.subtitle ? String(entity.subtitle) : undefined,
        tracks,
        mayBeTruncated: tracks.length >= EMBED_TRACK_LIMIT
    };
}
//# sourceMappingURL=spotify.js.map