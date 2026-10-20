"use client";

import { useEffect, useRef, useState } from "react";
import { Busy } from "@/components/Spinner";
import { getJson, postJson, type Venue } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { SongCover } from "./SongParts";
import type { QueueEntry } from "./types";
import VoteCounter from "./VoteCounter";

interface Props {
    target: { song: QueueEntry, venue: Venue } | null;
    admin: boolean;
    onClose: () => void;
    // After votes or downvotes land, so the queue can show the new counts
    onVoted: () => void;
    // Clicking the artist searches for them
    onArtist?: (artist: string) => void;
}

/** The popup for a song in the queue: its details, and one counter for adding upvotes or, for admins, downvoting meme songs */
export default function VoteDialog({ target, admin, onClose, onVoted, onArtist }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (target && !dialog.current?.open) dialog.current?.showModal();
    }, [target]);

    return (
        <dialog ref={dialog} className="vote-dialog" aria-labelledby="vote-dialog-title" onClose={onClose}>
            {/* Keyed so each song starts fresh, and closing drops anything still loading */}
            {target && <Content key={`${target.venue}-${target.song.pickId}`} {...target} admin={admin}
                close={() => dialog.current?.close()} onVoted={onVoted}
                onArtist={onArtist && (artist => { dialog.current?.close(); onArtist(artist); })} />}
        </dialog>
    );
}

/** False once the component is gone, so late responses are ignored */
function useMounted() {
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    return mounted;
}

/** What the server says about downvoting this song (see src/downvotes.ts) */
interface DownvoteCheck {
    allowed: boolean;
    // True when karma protection is the only thing in the way, which an admin can override with a reason
    overridable: boolean;
    reason: string | null;
    karma: number | null;
    upvotes: number | null;
    downvotes: number | null;
    // The most accounts that can downvote
    count: number;
}

interface ContentProps {
    song: QueueEntry;
    venue: Venue;
    admin: boolean;
    close: () => void;
    onVoted: () => void;
    onArtist?: (artist: string) => void;
}

function Content({ song, venue, admin, close, onVoted, onArtist }: ContentProps) {
    const mounted = useMounted();
    // Admins can downvote meme songs that aren't Zotify's; the server decides whether this one qualifies
    const canDownvote = admin && !song.zotify && !song.queuedByZotify;

    // undefined while loading
    const [upvotesLeft, setUpvotesLeft] = useState<number | undefined>(undefined);
    const [check, setCheck] = useState<DownvoteCheck | null | undefined>(canDownvote ? undefined : null);
    const [loadError, setLoadError] = useState("");
    const [value, setValue] = useState(0);
    const [reason, setReason] = useState("");
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{ text: string, error: boolean } | null>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        getJson("/api/vote-capacity", { pickId: song.pickId!, venue }).then(({ response, data }) => {
            if (!response.ok) throw new Error(data?.error ?? `Couldn't check votes (${response.status})`);
            if (mounted.current) setUpvotesLeft(data.available);
        }).catch(error => mounted.current && setLoadError((error as Error).message || "Couldn't check this song's votes."));

        if (!canDownvote) return;

        getJson("/api/admin/downvote", { pickId: song.pickId!, venue }).then(({ response, data }) => {
            if (!response.ok) throw new Error(data?.error ?? `Couldn't check this song (${response.status})`);
            if (mounted.current) setCheck(data);
        // Upvotes still work if the downvote check fails
        }).catch(() => mounted.current && setCheck(null));
    }, [song, venue, canDownvote, mounted]);

    const loading = upvotesLeft === undefined || check === undefined;
    const downvotable = !!check && (check.allowed || check.overridable);
    const max = upvotesLeft ?? 0;
    const min = downvotable ? -check!.count : 0;
    // Karma protection is in the way, so downvoting needs a reason the server records
    const needsReason = value < 0 && !!check && !check.allowed && check.overridable;
    const ready = value !== 0 && !sending && !done && (!needsReason || reason.trim().length >= 3);

    async function confirm() {
        setSending(true);
        setResult(null);

        try {
            if (value > 0) {
                const { response, data } = await postJson("/api/vote", { pickId: song.pickId, venue, count: value, song: { name: song.name, artist: song.artist } });
                if (!response.ok) throw new Error(data?.error ?? `Voting failed (${response.status})`);
                if (!mounted.current) return;

                setResult({ error: false, text: data.confirmed === null
                    ? `Sent ${plural(data.requested, "upvote")}, but couldn't confirm them.`
                    : `Added ${plural(data.confirmed, "upvote")}.${data.missing?.length ? ` ${plural(data.missing.length, "vote")} didn't go through.` : ""}` });
            } else {
                const overrideReason = needsReason ? reason.trim() : undefined;
                const { response, data } = await postJson("/api/admin/downvote", { pickId: song.pickId, venue, count: -value, overrideReason });
                if (!response.ok) throw new Error(data?.error ?? `Downvoting failed (${response.status})`);
                if (!mounted.current) return;

                setResult({ error: false, text: `Downvoted ${plural(data.confirmed ?? data.requested, "time")}${overrideReason ? " (override recorded)" : ""}.${data.missing?.length ? ` ${plural(data.missing.length, "vote")} didn't go through.` : ""}` });
            }

            setDone(true);
            onVoted();
        } catch (error) {
            if (mounted.current) setResult({ error: true, text: (error as Error).message || "That didn't work. Please try again." });
        } finally {
            if (mounted.current) setSending(false);
        }
    }

    // What the counter is set to, in words
    const summary = value > 0 ? `Add ${plural(value, "upvote")}`
        : value < 0 ? `Downvote with ${plural(-value, "account")}`
        : max === 0 && !downvotable ? "Every one of our accounts has already voted for this song."
        : "Use the arrows to pick how many votes to add.";

    // For admins: why downvoting is or isn't possible
    const downvoteNote = !canDownvote ? null
        : check === null ? "Couldn't check whether this can be downvoted."
        : check?.allowed ? `${check.karma! > 0 ? `+${check.karma}` : check.karma} karma (${check.upvotes} up, ${check.downvotes} down). Downvotes are only for meme songs.`
        : check?.overridable ? `${check.reason} Go below zero to override it with a reason.`
        : check?.reason ?? null;

    return <>
        <div className="vote-dialog-song">
            <SongCover song={song} />
            <div className="meta">
                <h2 id="vote-dialog-title" className="name">{song.name}</h2>
                {onArtist
                    ? <button type="button" className="artist artist-link" title={`Search for ${song.artist}`} onClick={() => onArtist(song.artist)}>{song.artist}</button>
                    : <div className="artist">{song.artist}</div>}
            </div>
        </div>

        {loadError ? <p className="vote-dialog-status">{loadError}</p> : <>
            <div className="vote-dialog-body">
                <VoteCounter value={value} min={min} max={max} onChange={next => { setValue(next); setResult(null); }}
                    disabled={loading || sending || done} label="Votes to add" />
                <div className="vote-summary">
                    <p className={cx("vote-summary-text", value > 0 && "positive", value < 0 && "negative")}>
                        {loading ? <Busy label="Checking votes…" /> : summary}
                    </p>
                    {!loading && max > 0 && value >= 0 && <p className="vote-hint">{plural(max, "account")} can still upvote.</p>}
                    {canDownvote && !loading && downvoteNote && <p className="vote-hint">{downvoteNote}</p>}
                    {needsReason && !done && (
                        <input type="text" className="override-reason" maxLength={200} autoFocus
                            placeholder="Why override? e.g. 4 hours of 30-minute tracks" aria-label="Reason for overriding karma protection"
                            value={reason} onChange={event => setReason(event.target.value)} />
                    )}
                </div>
            </div>
            {result && <p className={cx("vote-dialog-status", result.error && "error-text")} role="status">{result.text}</p>}
        </>}

        <div className="vote-dialog-actions">
            <button type="button" className="queue-btn" onClick={close}>{done || loadError ? "Done" : "Cancel"}</button>
            {!done && !loadError && (
                <button type="button" className={cx("queue-btn", value < 0 ? "danger confirming" : "boost", sending && "busy")} disabled={!ready} onClick={confirm}>
                    {sending ? <Busy label={value < 0 ? "Downvoting…" : "Voting…"} /> : "Confirm"}
                </button>
            )}
        </div>
    </>;
}
