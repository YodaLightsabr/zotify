"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { deleteJson, getJson, putJson, type Venue } from "./api";
import { useUser } from "./user";

/** A song in your Library (see src/library.ts) */
export interface LibrarySong {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    savedAt: number;
    source: "requested" | "saved" | "playlist" | "liked";
    playlist?: { id: string, name: string };
    requests: number;
    lastRequestedAt: number | null;
    // Whether it could be requested at each venue the last time it came up there
    availability: Record<Venue, boolean>;
}

interface Library {
    // The IDs of your saved songs, or null until they've loaded (or for people who can't use Zotify's music)
    saved: Set<string> | null;
    // Saves or takes out a song. Throws with the server's message if that didn't work
    setSaved: (songId: string, save: boolean) => Promise<void>;
    // For songs saved some other way, like requesting them
    markSaved: (songId: string) => void;
    // Fetches your saved songs again, and gives them back for pages that show them
    reload: () => Promise<LibrarySong[]>;
}

const LibraryContext = createContext<Library | null>(null);

/** Which songs are in your Library, for the save buttons on every page. Rendered by Zotify's layout */
export function LibraryProvider({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const [saved, setSavedIds] = useState<Set<string> | null>(null);

    const reload = useCallback(async () => {
        const { response, data } = await getJson<LibrarySong[]>("/v1/me/library/songs");
        if (!response.ok) throw new Error(`Couldn't load your Library (${response.status})`);
        setSavedIds(new Set(data.map(song => song.id)));
        return data;
    }, []);

    useEffect(() => {
        if (user?.approved) reload().catch(error => console.error(error));
        else setSavedIds(null);
    }, [user?.approved, reload]);

    const markSaved = useCallback((songId: string) => setSavedIds(current => current && new Set(current).add(songId)), []);

    const setSaved = useCallback(async (songId: string, save: boolean) => {
        const path = `/v1/me/library/songs/${encodeURIComponent(songId)}`;
        const { response, data } = save ? await putJson(path, {}) : await deleteJson(path);
        // Taking out a song that's already gone is fine
        if (!response.ok && (save || response.status !== 404)) throw new Error(data?.error ?? `That didn't work (${response.status})`);

        setSavedIds(current => {
            if (!current) return current;
            const next = new Set(current);
            if (save) next.add(songId);
            else next.delete(songId);
            return next;
        });
    }, []);

    const value = useMemo(() => ({ saved, setSaved, markSaved, reload }), [saved, setSaved, markSaved, reload]);
    return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
    const library = useContext(LibraryContext);
    if (!library) throw new Error("useLibrary needs a LibraryProvider");
    return library;
}
