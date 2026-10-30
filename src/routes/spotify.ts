import type { Request, Response } from "express";
import { getLibraryPlaylists } from "../library.js";
import {
    authorizeUrl, countLikedSongs, disconnect, finishAuthorization, getConnection, listPlaylists, SpotifyApiError, spotifyConfigured
} from "../spotifyApi.js";
import { getImport, MAX_LIKED, startImport } from "../spotifyImport.js";
import { requestVenue } from "./params.js";

// Connecting Spotify and importing from it, for site admins on Zotify's own pages (see spotifyApi.ts and spotifyImport.ts)

const sessionEmail = (res: Response): string => res.locals.session.email;

/** Answers with what went wrong talking to Spotify. Never a 401, which Zotify's pages take to mean signing in to Zotify */
function sendSpotifyError(res: Response, error: unknown, doing: string) {
    if (error instanceof SpotifyApiError && error.status === 401) {
        res.status(409).json({ error: error.message, code: "spotify_disconnected" });
        return;
    }

    // Spotify apps in Development Mode only work for the accounts listed in their dashboard
    if (error instanceof SpotifyApiError && error.status === 403) {
        res.status(403).json({ error: "Spotify says this account can't use Zotify yet. Ask Zotify's admins to add your Spotify account.", code: "spotify_forbidden" });
        return;
    }

    if (error instanceof SpotifyApiError && error.status === 400) {
        res.status(400).json({ error: error.message, code: "invalid_request" });
        return;
    }

    console.error(`Error ${doing}:`, error);
    res.status(502).json({ error: "Couldn't reach Spotify. Please try again." });
}

/** Whether Spotify connections are on, your connection if you have one, and your latest import */
export function spotifyStatus(_req: Request, res: Response) {
    const email = sessionEmail(res);
    res.json({ configured: spotifyConfigured(), connection: getConnection(email), import: getImport(email) });
}

/** Where to send you to connect Spotify */
export function spotifyAuthorize(_req: Request, res: Response) {
    if (!spotifyConfigured()) {
        res.status(503).json({ error: "Spotify connections aren't set up on this server yet.", code: "unavailable" });
        return;
    }

    res.json({ url: authorizeUrl(sessionEmail(res)) });
}

/** Body: { code, state }, from Spotify sending you back. Finishes connecting */
export async function spotifyCallback(req: Request, res: Response) {
    const { code, state } = req.body ?? {};

    if (typeof code !== "string" || typeof state !== "string" || !code || !state) {
        res.status(400).json({ error: "Spotify didn't send back what Zotify needs. Please connect Spotify again.", code: "invalid_request" });
        return;
    }

    try {
        res.json(await finishAuthorization(sessionEmail(res), code, state));
    } catch (error) {
        sendSpotifyError(res, error, "connecting Spotify");
    }
}

/** Disconnects Spotify. Playlists and songs you imported stay */
export function spotifyDisconnect(_req: Request, res: Response) {
    disconnect(sessionEmail(res));
    res.status(204).end();
}

/** What there is to import: how many songs you've liked, and your playlists, marking ones already in your Zotify Library */
export async function spotifyLibrary(_req: Request, res: Response) {
    const email = sessionEmail(res);

    if (!getConnection(email)) {
        res.status(409).json({ error: "Connect Spotify first.", code: "spotify_disconnected" });
        return;
    }

    try {
        const [likedCount, playlists] = await Promise.all([countLikedSongs(email), listPlaylists(email)]);
        const saved = new Map(getLibraryPlaylists(email).map(playlist => [playlist.id, playlist.savedAt]));

        res.json({
            likedCount,
            maxLiked: MAX_LIKED,
            playlists: playlists.map(playlist => ({
                ...playlist,
                // Spotify only shares the tracks of private playlists people made or collaborate on
                importable: playlist.yours || playlist.public,
                savedAt: saved.get(playlist.id) ?? null
            }))
        });
    } catch (error) {
        sendSpotifyError(res, error, "reading a Spotify library");
    }
}

/** Body: { liked, playlists: [{ id, name }] }. Starts importing them, finding their songs at the venue */
export function spotifyImport(req: Request, res: Response) {
    const email = sessionEmail(res);
    const liked = req.body?.liked === true;
    const playlists = Array.isArray(req.body?.playlists) ? req.body.playlists : [];
    const valid = playlists.filter((playlist: any) => typeof playlist?.id === "string" && /^[A-Za-z0-9]{22}$/.test(playlist.id))
        .slice(0, 200)
        .map((playlist: any) => ({ id: playlist.id as string, name: typeof playlist.name === "string" ? playlist.name.slice(0, 200) : "Playlist" }));

    if (!getConnection(email)) {
        res.status(409).json({ error: "Connect Spotify first.", code: "spotify_disconnected" });
        return;
    }

    if (!liked && !valid.length) {
        res.status(400).json({ error: "Pick your liked songs or a playlist to import.", code: "invalid_request" });
        return;
    }

    try {
        res.status(202).json(startImport(email, requestVenue(res), { liked, playlists: valid }));
    } catch (error) {
        res.status(409).json({ error: (error as Error).message, code: "conflict" });
    }
}

/** How your latest import is going, or null */
export function spotifyImportStatus(_req: Request, res: Response) {
    res.json(getImport(sessionEmail(res)));
}
