"use client";

import { useEffect, useRef, useState } from "react";
import { postJson, type Venue } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useSchool } from "@/lib/school";
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

/**
 * Songs waiting in Zotify's queue, front first. They aren't in the venue's queue yet, so there's nothing to vote on.
 * Admins can move songs up and down and remove any of them; everyone can remove their own
 */
export function WaitingList({ waiting, venue, admin }: { waiting: ZotifyQueueSong[], venue: Venue, admin: boolean }) {
    const [busy, setBusy] = useState<number | null>(null);
    const [error, setError] = useState("");

    // The server sends the updated queue to everyone once it's changed
    async function act(id: number, request: () => Promise<{ response: Response, data: any }>) {
        setBusy(id);
        setError("");

        try {
            const { response, data } = await request();
            if (!response.ok) throw new Error(data?.error ?? `That didn't work (${response.status})`);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(null);
        }
    }

    const move = (index: number, by: number) => {
        const ids = waiting.map(song => song.id);
        [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
        act(waiting[index].id, () => postJson("/api/admin/zotify-queue/reorder", { venue, ids }));
    };

    const remove = (song: ZotifyQueueSong) => {
        if (!confirm(`Take "${song.name}" out of the queue?`)) return;
        act(song.id, () => postJson("/api/zotify-queue/remove", { id: song.id }));
    };

    return <>
        <ul className="results">
            {waiting.map((song, i) => (
                <li className={cx("song zotify", busy === song.id && "busy-row")} key={song.id}>
                    <SongCover song={{ cover: song.cover }} />
                    <SongBackdrop song={{ cover: song.cover }} />
                    <div className="meta">
                        <div className="title-row">
                            <div className="name">{song.name}</div>
                            {song.mine && <span className="badge" title={`You queued this at ${time(song.requestedAt)}`}>Yours</span>}
                        </div>
                        <div className="artist">{song.artist}</div>
                    </div>
                    <div className="waiting-actions">
                        {admin && <>
                            <button type="button" className="row-icon" title="Move up" aria-label={`Move ${song.name} up`}
                                disabled={i === 0 || busy !== null} onClick={() => move(i, -1)}>{ICONS.up}</button>
                            <button type="button" className="row-icon" title="Move down" aria-label={`Move ${song.name} down`}
                                disabled={i === waiting.length - 1 || busy !== null} onClick={() => move(i, 1)}>{ICONS.down}</button>
                        </>}
                        {(admin || song.mine) && (
                            <button type="button" className="row-icon remove" title="Remove from the queue" aria-label={`Remove ${song.name} from the queue`}
                                disabled={busy !== null} onClick={() => remove(song)}>{ICONS.remove}</button>
                        )}
                    </div>
                </li>
            ))}
        </ul>
        {error && <p className="message error-text" role="alert">{error}</p>}
    </>;
}

const icon = (path: React.ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

const ICONS = {
    up: icon(<path d="m6 15 6-6 6 6" />),
    down: icon(<path d="m6 9 6 6 6-6" />),
    remove: icon(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>)
};

/** Admins only: empties Zotify's queue at the venue, after asking */
export function ClearButton({ venue, count }: { venue: Venue, count: number }) {
    const school = useSchool();
    const [clearing, setClearing] = useState(false);

    async function clear() {
        if (!confirm(`Take all ${plural(count, "song")} out of Zotify's queue at ${school.venueName(venue)}? This can't be undone.`)) return;
        setClearing(true);

        try {
            // The server sends the emptied queue to everyone
            const { response, data } = await postJson("/api/admin/zotify-queue/clear", { venue });
            if (!response.ok) throw new Error(data?.error ?? `Couldn't clear the queue (${response.status})`);
        } catch (error) {
            alert((error as Error).message);
        } finally {
            setClearing(false);
        }
    }

    return <button type="button" className="clear-queue" disabled={clearing} onClick={clear}>{clearing ? "Clearing…" : "Clear"}</button>;
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
    const school = useSchool();
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (open && !dialog.current?.open) dialog.current?.showModal();
        if (!open && dialog.current?.open) dialog.current.close();
    }, [open]);

    return (
        <dialog ref={dialog} className="vote-dialog failures-dialog" aria-labelledby="failures-title" onClose={onClose}>
            <h2 id="failures-title">Couldn&apos;t queue</h2>
            <p className="failures-intro">These didn&apos;t make it into the queue at {school.venueName(venue)}, even after trying again.</p>
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
