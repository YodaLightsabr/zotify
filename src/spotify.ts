// Reads public Spotify playlists and tracks from the embed pages Spotify serves for website widgets, which need no API key.
// Private playlists aren't available there, and the embed seems to stop at 100 tracks.

export interface SpotifyTrack {
    title: string;
    artist: string;
    durationMs?: number;
    uri?: string;
}

export interface SpotifyPlaylist {
    id: string;
    name: string;
    owner?: string;
    tracks: SpotifyTrack[];
    // The embed has returned at most this many tracks, so a playlist this long may have more
    mayBeTruncated: boolean;
}

export class SpotifyPlaylistUnavailableError extends Error {
    constructor (id: string, kind: "playlist" | "track" = "playlist") {
        super(`Spotify ${kind} ${id} isn't public, or doesn't exist`);
        this.name = "SpotifyPlaylistUnavailableError";
    }
}

const EMBED_TRACK_LIMIT = 100;

/** Finds a playlist ID in a pasted link or URI, e.g. https://open.spotify.com/playlist/{id}?si=… or spotify:playlist:{id} */
export function parsePlaylistId(text: string): string | null {
    const match = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})/i)
        ?? text.match(/spotify:playlist:([A-Za-z0-9]{22})/i);

    return match?.[1] ?? null;
}

/** Finds a track ID in a pasted link or URI, e.g. https://open.spotify.com/track/{id}?si=… or spotify:track:{id} */
export function parseTrackId(text: string): string | null {
    const match = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})/i)
        ?? text.match(/spotify:track:([A-Za-z0-9]{22})/i);

    return match?.[1] ?? null;
}

/** What Spotify's embed page for a playlist or track says about it. Throws SpotifyPlaylistUnavailableError if it's not there */
async function fetchEmbed(kind: "playlist" | "track", id: string): Promise<any> {
    // Only ever request Spotify's own embed URL built from a validated ID
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error(`Invalid ${kind} ID`);

    const response = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(10_000)
    });

    if (response.status === 404) throw new SpotifyPlaylistUnavailableError(id, kind);
    if (!response.ok) throw new Error(`Spotify returned ${response.status}`);

    const html = await response.text();
    const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];

    if (!nextData) throw new Error(`Spotify's embed page didn't include ${kind} data`);

    const pageProps = JSON.parse(nextData)?.props?.pageProps;

    // Private and missing playlists render a "Page not found" page instead of the playlist
    if (pageProps?.status === "404" || pageProps?.status === 404) throw new SpotifyPlaylistUnavailableError(id, kind);

    return pageProps?.state?.data?.entity;
}

/** A public track's title and artists, joined like playlist tracks' are */
export async function fetchTrack(id: string): Promise<SpotifyTrack> {
    const entity = await fetchEmbed("track", id);
    if (!entity?.name && !entity?.title) throw new Error("Spotify's embed page didn't include the track");

    return {
        title: String(entity.title ?? entity.name),
        artist: Array.isArray(entity.artists) ? entity.artists.map((artist: any) => String(artist.name)).join(", ") : "",
        durationMs: typeof entity.duration === "number" ? entity.duration : undefined,
        uri: typeof entity.uri === "string" ? entity.uri : undefined
    };
}

export async function fetchPlaylist(id: string): Promise<SpotifyPlaylist> {
    const entity = await fetchEmbed("playlist", id);

    if (!entity || !Array.isArray(entity.trackList)) throw new Error("Spotify's embed page didn't include a track list");

    const tracks: SpotifyTrack[] = entity.trackList.map((track: any) => ({
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
