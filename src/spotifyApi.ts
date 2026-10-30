import { randomBytes } from "node:crypto";
import { FRONTEND_URL } from "./config.js";
import { isSiteAdmin } from "./auth.js";
import { db } from "./db.js";
import { seal, unseal } from "./secrets.js";
import { SpotifyPlaylistUnavailableError, type SpotifyPlaylist, type SpotifyTrack } from "./spotify.js";

// Site admins' own Spotify accounts, connected with Spotify's sign-in (OAuth), so they can import their liked songs and
// playlists, and read private playlists they paste. Public playlists are read without an account (see spotify.ts).
//
// The app is set up at developer.spotify.com with SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env. Spotify's Development
// Mode only lets the Spotify accounts added under User Management in its dashboard connect (five at most), which is why it's
// for site admins only, and only lets it read the tracks of playlists someone made or collaborates on. The site admin who
// connected most recently is also who Zotify looks up everyone's playlist covers and album art as (see spotifyArt.ts).
// Tokens are encrypted (secrets.ts)

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID?.trim() ?? "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET?.trim() ?? "";

// Spotify sends people back to the main site, which finishes connecting (web/app/(zotify)/api/spotify/callback). Spotify
// doesn't allow "localhost", so development uses 127.0.0.1, and the page moves itself back to localhost
const production = process.env.NODE_ENV === "production";
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI?.trim()
    || (production ? `${FRONTEND_URL}/api/spotify/callback` : "http://127.0.0.1:3000/api/spotify/callback");

// Reading private playlists (and ones they collaborate on), and their liked songs
const SCOPES = ["playlist-read-private", "playlist-read-collaborative", "user-library-read"];
// How long someone has to finish signing in to Spotify
const STATE_TTL_MS = 10 * 60 * 1000;
// Spotify's most per page
const PAGE_SIZE = 50;
// Long playlists stop here, like the embed's 100, but further
export const MAX_PLAYLIST_TRACKS = 1000;

db.exec(`
    CREATE TABLE IF NOT EXISTS spotify_accounts (
        email TEXT PRIMARY KEY,
        spotify_id TEXT NOT NULL,
        display_name TEXT,
        -- { accessToken, refreshToken }, encrypted (see secrets.ts)
        tokens TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        connected_at INTEGER NOT NULL
    );
`);

interface AccountRow { email: string, spotify_id: string, display_name: string | null, tokens: string, expires_at: number, connected_at: number }
interface Tokens { accessToken: string, refreshToken: string }

/** Spotify said no, or something went wrong asking it. status is Spotify's HTTP status, or 0 if it couldn't be reached */
export class SpotifyApiError extends Error {
    status: number;

    constructor (message: string, status: number) {
        super(message);
        this.name = "SpotifyApiError";
        this.status = status;
    }
}

/** Whether Spotify connections are set up on this server */
export const spotifyConfigured = () => !!CLIENT_ID && !!CLIENT_SECRET;

const selectAccount = db.prepare("SELECT * FROM spotify_accounts WHERE email = ?");
const upsertAccount = db.prepare(`
    INSERT INTO spotify_accounts (email, spotify_id, display_name, tokens, expires_at, connected_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET spotify_id = excluded.spotify_id, display_name = excluded.display_name, tokens = excluded.tokens,
        expires_at = excluded.expires_at, connected_at = excluded.connected_at
`);
const updateTokens = db.prepare("UPDATE spotify_accounts SET tokens = ?, expires_at = ? WHERE email = ?");
const deleteAccount = db.prepare("DELETE FROM spotify_accounts WHERE email = ?");
const selectByRecency = db.prepare("SELECT email FROM spotify_accounts ORDER BY connected_at DESC");

/** Who Zotify looks things up on Spotify as, for everyone: the site admin who connected Spotify most recently, or null */
export function lookupAccount() {
    return (selectByRecency.all() as { email: string }[]).map(row => row.email).find(isSiteAdmin) ?? null;
}

/** Someone's connected Spotify account, without its tokens, or null */
export function getConnection(email: string) {
    const row = selectAccount.get(email) as AccountRow | undefined;
    return row ? { spotifyId: row.spotify_id, displayName: row.display_name, connectedAt: row.connected_at } : null;
}

export function disconnect(email: string) {
    return Number(deleteAccount.run(email).changes) > 0;
}

// Signing in. The state ties Spotify's answer to the person who started it, so nobody can connect their Spotify to someone else

const pendingStates = new Map<string, { email: string, createdAt: number }>();

/** Where to send someone to connect their Spotify */
export function authorizeUrl(email: string) {
    const now = Date.now();
    for (const [state, pending] of pendingStates) if (now - pending.createdAt > STATE_TTL_MS) pendingStates.delete(state);

    const state = randomBytes(24).toString("base64url");
    pendingStates.set(state, { email, createdAt: now });

    return `https://accounts.spotify.com/authorize?${new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES.join(" "),
        state,
        // Lets people pick a different Spotify account than the one their browser is signed in to
        show_dialog: "true"
    })}`;
}

/** Asks Spotify's token endpoint for tokens, with the app's own credentials */
async function requestTokens(body: Record<string, string>) {
    let response: Response;

    try {
        response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`
            },
            body: new URLSearchParams(body),
            signal: AbortSignal.timeout(10_000)
        });
    } catch {
        throw new SpotifyApiError("Couldn't reach Spotify.", 0);
    }

    const data = await response.json().catch(() => null) as any;
    if (!response.ok || !data?.access_token) throw new SpotifyApiError(data?.error_description ?? data?.error ?? `Spotify answered ${response.status}`, response.status);

    return data as { access_token: string, refresh_token?: string, expires_in: number };
}

/** Finishes connecting: swaps the code Spotify sent back for tokens, and saves them with who they belong to */
export async function finishAuthorization(email: string, code: string, state: string) {
    const pending = pendingStates.get(state);
    pendingStates.delete(state);

    if (!pending || pending.email !== email || Date.now() - pending.createdAt > STATE_TTL_MS) {
        throw new SpotifyApiError("That sign-in expired or wasn't yours. Please connect Spotify again.", 400);
    }

    const tokens = await requestTokens({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
    if (!tokens.refresh_token) throw new SpotifyApiError("Spotify didn't send everything Zotify needs. Please try again.", 502);

    const me = await call(tokens.access_token, "/me");
    const now = Date.now();
    upsertAccount.run(email, String(me.id), me.display_name ?? null,
        seal({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token } satisfies Tokens), now + tokens.expires_in * 1000, now);

    return getConnection(email)!;
}

/** A working access token for someone, refreshed when it's about to run out. Null if they haven't connected Spotify */
async function accessToken(email: string, forceRefresh = false) {
    const row = selectAccount.get(email) as AccountRow | undefined;
    if (!row) return null;

    const tokens = unseal<Tokens>(row.tokens);
    if (!forceRefresh && row.expires_at - Date.now() > 60_000) return tokens.accessToken;

    try {
        const fresh = await requestTokens({ grant_type: "refresh_token", refresh_token: tokens.refreshToken });
        // Spotify sometimes sends a new refresh token, and otherwise the old one keeps working
        const next: Tokens = { accessToken: fresh.access_token, refreshToken: fresh.refresh_token ?? tokens.refreshToken };
        updateTokens.run(seal(next), Date.now() + fresh.expires_in * 1000, email);
        return next.accessToken;
    } catch (error) {
        // They took Zotify's access away in Spotify's settings, so the connection is gone
        if (error instanceof SpotifyApiError && error.status === 400) {
            deleteAccount.run(email);
            throw new SpotifyApiError("Your Spotify connection has ended. Connect Spotify again from your Account page.", 401);
        }
        throw error;
    }
}

/** A GET to Spotify's Web API with an access token. Waits once when Spotify says to slow down */
async function call(token: string, path: string, retried = false): Promise<any> {
    let response: Response;

    try {
        response = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch {
        throw new SpotifyApiError("Couldn't reach Spotify.", 0);
    }

    if (response.status === 429 && !retried) {
        const wait = Math.min(Number(response.headers.get("Retry-After")) || 2, 30);
        await new Promise(resolve => setTimeout(resolve, wait * 1000));
        return call(token, path, true);
    }

    const data = await response.json().catch(() => null) as any;
    if (!response.ok) throw new SpotifyApiError(data?.error?.message ?? `Spotify answered ${response.status}`, response.status);
    return data;
}

/** A GET as someone, refreshing their token once if Spotify turns it down */
async function get(email: string, path: string) {
    const token = await accessToken(email);
    if (!token) throw new SpotifyApiError("Connect Spotify first.", 401);

    try {
        return await call(token, path);
    } catch (error) {
        if (!(error instanceof SpotifyApiError) || error.status !== 401) throw error;
        return call((await accessToken(email, true))!, path);
    }
}

/** Every page of a paged list, up to max items */
async function getAll(email: string, path: string, max: number) {
    const items: any[] = [];
    let total = 0;

    for (let offset = 0; offset < max; offset += PAGE_SIZE) {
        const separator = path.includes("?") ? "&" : "?";
        const page = await get(email, `${path}${separator}limit=${Math.min(PAGE_SIZE, max - offset)}&offset=${offset}`);
        total = page.total ?? 0;
        items.push(...(page.items ?? []));
        if (!page.next || !page.items?.length) break;
    }

    return { items, total };
}

/** The image closest to 300 pixels wide from a list Spotify sends biggest first, or null */
function pickImage(images: unknown): string | null {
    if (!Array.isArray(images) || !images.length) return null;
    const bigEnough = images.filter(image => image?.url && (image.width ?? 0) >= 300);
    return String((bigEnough.at(-1) ?? images[0])?.url ?? "") || null;
}

/** A playlist's cover, looked up as `email`. Spotify shares covers of public playlists with anyone */
export async function playlistCover(email: string, id: string) {
    return pickImage((await get(email, `/playlists/${id}?fields=images`)).images);
}

/** A track's album art, looked up as `email` */
export async function trackArt(email: string, trackId: string) {
    if (!/^[A-Za-z0-9]{22}$/.test(trackId)) return null;
    return pickImage((await get(email, `/tracks/${trackId}`)).album?.images);
}

/** A Spotify track as Zotify keeps them, or null for podcast episodes and missing tracks */
function toTrack(item: any): SpotifyTrack | null {
    if (!item || item.type !== "track" || !item.name) return null;

    return {
        title: String(item.name),
        artist: Array.isArray(item.artists) ? item.artists.map((artist: any) => String(artist.name)).join(", ") : "",
        ...(typeof item.duration_ms === "number" ? { durationMs: item.duration_ms } : {}),
        ...(item.uri ? { uri: String(item.uri) } : {})
    };
}

export interface SpotifyPlaylistSummary {
    id: string;
    name: string;
    owner: string | null;
    // They made it, or collaborate on it, so Spotify lets Zotify read its tracks even if it's private
    yours: boolean;
    public: boolean;
    trackCount: number;
    image: string | null;
}

/** Someone's playlists on Spotify, as their library lists them, up to 500 */
export async function listPlaylists(email: string): Promise<SpotifyPlaylistSummary[]> {
    const spotifyId = getConnection(email)?.spotifyId;
    const { items } = await getAll(email, "/me/playlists", 500);

    return items.filter(playlist => playlist?.id).map(playlist => ({
        id: String(playlist.id),
        name: String(playlist.name ?? "Untitled playlist"),
        owner: playlist.owner?.display_name ?? playlist.owner?.id ?? null,
        yours: playlist.owner?.id === spotifyId || !!playlist.collaborative,
        public: playlist.public === true,
        trackCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
        image: playlist.images?.at(-1)?.url ?? playlist.images?.[0]?.url ?? null
    }));
}

/** How many songs someone has liked on Spotify */
export async function countLikedSongs(email: string) {
    return ((await get(email, "/me/tracks?limit=1")).total ?? 0) as number;
}

/** Someone's liked songs, most recently liked first, up to max */
export async function getLikedSongs(email: string, max: number) {
    const { items } = await getAll(email, "/me/tracks", max);
    return items.map(item => toTrack(item?.track ?? item?.item)).filter((track): track is SpotifyTrack => !!track);
}

/**
 * A playlist read as someone, with whether it's private. Spotify only gives Zotify the tracks of playlists they made or
 * collaborate on; for others, and ones that don't exist, this throws SpotifyPlaylistUnavailableError
 */
export async function fetchPlaylistAs(email: string, id: string): Promise<SpotifyPlaylist & { private: boolean }> {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new Error("Invalid playlist ID");

    try {
        const playlist = await get(email, `/playlists/${id}`);
        const { items, total } = await getAll(email, `/playlists/${id}/items`, MAX_PLAYLIST_TRACKS);

        return {
            id,
            name: String(playlist.name ?? "Untitled playlist"),
            ...(playlist.owner?.display_name ? { owner: String(playlist.owner.display_name) } : {}),
            ...(pickImage(playlist.images) ? { image: pickImage(playlist.images)! } : {}),
            tracks: items.map(item => toTrack(item?.item ?? item?.track)).filter((track): track is SpotifyTrack => !!track),
            mayBeTruncated: total > MAX_PLAYLIST_TRACKS,
            private: playlist.public !== true
        };
    } catch (error) {
        if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) throw new SpotifyPlaylistUnavailableError(id);
        throw error;
    }
}
