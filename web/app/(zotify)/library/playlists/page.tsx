"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { deleteJson, getJson } from "@/lib/api";
import { plural } from "@/lib/format";

interface LibraryPlaylist {
    id: string;
    name: string;
    owner?: string;
    trackCount: number;
    // How many of its tracks are in your Library
    songCount: number;
    savedAt: number;
}

/** Playlists you've saved. Each opens on its own page, where you can queue it */
export default function LibraryPlaylistsPage() {
    const [playlists, setPlaylists] = useState<LibraryPlaylist[] | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        getJson<LibraryPlaylist[]>("/v1/me/library/playlists").then(({ response, data }) => {
            if (!response.ok) throw new Error(`Couldn't load your playlists (${response.status})`);
            setPlaylists(data);
        }).catch(error => setError((error as Error).message));
    }, []);

    async function remove(playlist: LibraryPlaylist) {
        if (!confirm(`Take "${playlist.name}" out of your Library? Its songs stay saved.`)) return;

        const { response, data } = await deleteJson(`/v1/me/library/playlists/${playlist.id}`);
        if (!response.ok && response.status !== 404) {
            alert(data?.error ?? `Couldn't take it out (${response.status})`);
            return;
        }

        setPlaylists(current => current?.filter(other => other.id !== playlist.id) ?? null);
    }

    if (error) return <p className="message error-text">{error}</p>;
    if (!playlists) return <div className="message"><Spinner /></div>;

    if (!playlists.length) {
        return (
            <p className="library-empty">
                No playlists yet. Paste a Spotify playlist link into the search on the <Link href="/">homepage</Link>, then save it to your Library.
                Its songs are saved too.
            </p>
        );
    }

    return (
        <ul className="library-playlists">
            {playlists.map(playlist => (
                <li key={playlist.id}>
                    <Link className="library-playlist" href={`/playlist/${playlist.id}`}>
                        <span className="library-playlist-art" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
                            </svg>
                        </span>
                        <strong>{playlist.name}</strong>
                        <span>{playlist.owner ? `By ${playlist.owner}` : "Spotify playlist"}</span>
                        <span>{plural(playlist.trackCount, "track")} · {playlist.songCount} in your Library</span>
                    </Link>
                    <button type="button" className="row-icon remove" title="Take out of your Library" aria-label={`Take ${playlist.name} out of your Library`}
                        onClick={() => remove(playlist)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                    </button>
                </li>
            ))}
        </ul>
    );
}
