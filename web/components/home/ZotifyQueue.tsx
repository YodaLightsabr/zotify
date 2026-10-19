"use client";

import { useEffect, useRef } from "react";
import type { Venue } from "@/lib/api";
import { plural, VENUE_LABELS } from "@/lib/format";
import { SongBackdrop, SongCover } from "./SongParts";

export interface ZotifyQueueSong {
    id: number;
    songId: string;
    name: string;
    artist: string;
    cover?: string;
    requestedAt: number;
    // Whether the signed-in person queued it
    mine: boolean;
}

export interface ZotifyQueueFailure extends ZotifyQueueSong {
    failedAt: number;
    attempts: number;
    error: string | null;
}

/** Zotify's own queue at a venue (see src/zotifyQueue.ts), for signed-in people */
export interface ZotifyQueue {
    // Songs waiting for room in the venue's queue, front first
    waiting: ZotifyQueueSong[];
    // Songs that couldn't be put into the venue's queue even after retrying
    failures: ZotifyQueueFailure[];
}

const time = (timestamp: number) => new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** A song waiting in Zotify's queue. It isn't in the venue's queue yet, so there's nothing to vote on */
export function WaitingRow({ song }: { song: ZotifyQueueSong }) {
    return (
        <li className="song zotify">
            <SongCover song={{ cover: song.cover }} />
            <SongBackdrop song={{ cover: song.cover }} />
            <div className="meta">
                <div className="title-row">
                    <div className="name">{song.name}</div>
                    {song.mine && <span className="badge" title={`You queued this at ${time(song.requestedAt)}`}>Yours</span>}
                </div>
                <div className="artist">{song.artist}</div>
            </div>
        </li>
    );
}

/** The little warning by the "Up next" heading when songs couldn't be queued */
export function FailuresButton({ count, onClick }: { count: number, onClick: () => void }) {
    const label = `${plural(count, "song")} couldn't be queued`;

    return (
        <button type="button" className="failures-button" title={label} aria-label={label} onClick={onClick}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
            </svg>
            {count}
        </button>
    );
}

/** Lists the songs that couldn't be put into the venue's queue, and why */
export function FailuresDialog({ failures, venue, open, onClose }: { failures: ZotifyQueueFailure[], venue: Venue, open: boolean, onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (open && !dialog.current?.open) dialog.current?.showModal();
        if (!open && dialog.current?.open) dialog.current.close();
    }, [open]);

    return (
        <dialog ref={dialog} className="vote-dialog failures-dialog" aria-labelledby="failures-title" onClose={onClose}>
            <h2 id="failures-title">Couldn&apos;t queue</h2>
            <p className="failures-intro">These didn&apos;t make it into the queue at {VENUE_LABELS[venue]}, even after trying again.</p>
            {failures.length ? (
                <ul className="failures-list">
                    {failures.map(failure => (
                        <li key={failure.id}>
                            <SongCover song={{ cover: failure.cover }} />
                            <div className="meta">
                                <div className="name">{failure.name}</div>
                                <div className="artist">{failure.artist}</div>
                                <div className="failure-reason">{failure.error ?? "Something went wrong."} · {time(failure.failedAt)}</div>
                            </div>
                        </li>
                    ))}
                </ul>
            ) : <p className="failures-intro">Nothing right now.</p>}
            <div className="vote-dialog-actions">
                <button type="button" className="queue-btn" onClick={onClose}>Close</button>
            </div>
        </dialog>
    );
}
