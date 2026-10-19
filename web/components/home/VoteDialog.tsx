"use client";

import { useEffect, useRef, useState } from "react";
import { Busy, Spinner } from "@/components/Spinner";
import { getJson, postJson, type Venue } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { SongCover } from "./SongParts";
import type { QueueEntry } from "./types";

interface Props {
    target: { song: QueueEntry, venue: Venue } | null;
    admin: boolean;
    onClose: () => void;
    // After votes or downvotes land, so the queue can show the new counts
    onVoted: () => void;
}

/** The popup for adding votes to a song in the queue, and for admins, downvoting meme songs */
export default function VoteDialog({ target, admin, onClose, onVoted }: Props) {
    const dialog = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (target && !dialog.current?.open) dialog.current?.showModal();
    }, [target]);

    return (
        <dialog ref={dialog} className="vote-dialog" aria-labelledby="vote-dialog-title" onClose={onClose}>
            {/* Keyed so each song starts fresh, and closing drops anything still loading */}
            {target && <Content key={`${target.venue}-${target.song.pickId}`} {...target} admin={admin}
                close={() => dialog.current?.close()} onVoted={onVoted} />}
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

interface ContentProps { song: QueueEntry, venue: Venue, admin: boolean, close: () => void, onVoted: () => void }

function Content({ song, venue, admin, close, onVoted }: ContentProps) {
    const mounted = useMounted();
    const [phase, setPhase] = useState<"loading" | "ready" | "voting" | "finished">("loading");
    const [status, setStatus] = useState("");
    const [available, setAvailable] = useState(1);
    // Starts at 1 so the thumb doesn't jump when the votes load
    const [count, setCount] = useState(1);
    const [closeLabel, setCloseLabel] = useState("Close");

    useEffect(() => {
        (async () => {
            try {
                const { response, data } = await getJson("/api/vote-capacity", { pickId: song.pickId!, venue });
                if (!response.ok) throw new Error(data?.error ?? `Couldn't check votes (${response.status})`);
                if (!mounted.current) return;

                // Every one of our accounts has voted, so there's nothing to add and no slider
                if (data.available === 0) {
                    setStatus(`All ${data.total} of our accounts have already voted for this song.`);
                    setPhase("finished");
                    return;
                }

                setAvailable(data.available);
                setPhase("ready");
            } catch (error) {
                if (!mounted.current) return;
                setStatus((error as Error).message || "Couldn't check this song's votes.");
                setPhase("finished");
            }
        })();
    }, [song, venue, mounted]);

    async function vote() {
        setPhase("voting");

        try {
            const { response, data } = await postJson("/api/vote", { pickId: song.pickId, venue, count, song: { name: song.name, artist: song.artist } });
            if (!response.ok) throw new Error(data?.error ?? `Voting failed (${response.status})`);
            if (!mounted.current) return;

            setStatus(data.confirmed === null
                ? `Sent ${plural(data.requested, "vote")}, but couldn't confirm them.`
                : `Added ${plural(data.confirmed, "vote")}.${data.missing?.length ? ` ${plural(data.missing.length, "vote")} didn't go through.` : ""}`);
            setCloseLabel("Done");
            setPhase("finished");
            onVoted();
        } catch (error) {
            if (!mounted.current) return;
            setStatus((error as Error).message || "Voting failed. Please try again.");
            setPhase("ready");
        }
    }

    return <>
        <div className="vote-dialog-song">
            <SongCover song={song} />
            <div className="meta">
                <h2 id="vote-dialog-title" className="name">{song.name}</h2>
                <div className="artist">{song.artist}</div>
            </div>
        </div>
        <p className="vote-dialog-status">{status}</p>
        <div className="vote-dialog-body">
            {/* The slider and its label are there from the start, so nothing shifts once the votes are checked */}
            {phase !== "finished" && <>
                <label htmlFor="vote-count" className="vote-count-label">
                    {phase === "loading" ? <Busy label="Checking votes…" /> : `Add ${plural(count, "vote")}`}
                </label>
                <input type="range" id="vote-count" min={1} max={available} step={1} value={count}
                    disabled={phase !== "ready"} onChange={event => setCount(Number(event.target.value))} />
            </>}
        </div>
        <div className="vote-dialog-actions">
            {phase === "finished"
                ? <button type="button" className="queue-btn" onClick={close}>{closeLabel}</button>
                : <>
                    <button type="button" className="queue-btn" onClick={close}>Cancel</button>
                    {/* Shown disabled until the votes are checked, for the same reason */}
                    <button type="button" className={cx("queue-btn boost", phase === "voting" && "busy")} disabled={phase !== "ready"} onClick={vote}>
                        {phase === "voting" ? <Busy label="Voting…" /> : "Add votes"}
                    </button>
                </>}
        </div>
        {/* Admins can mass-downvote meme songs that aren't Zotify's; the server decides whether this one qualifies */}
        {admin && !song.zotify && !song.queuedByZotify && <Downvote song={song} venue={venue} onDownvoted={onVoted} />}
    </>;
}

type DownvoteMode = "checking" | "blocked" | "allowed" | "confirming" | "override" | "overriding" | "downvoting" | "done";

function Downvote({ song, venue, onDownvoted }: { song: QueueEntry, venue: Venue, onDownvoted: () => void }) {
    const mounted = useMounted();
    const [mode, setMode] = useState<DownvoteMode>("checking");
    const [note, setNote] = useState({ text: "", error: false });
    const [count, setCount] = useState(6);
    // Overriding karma protection needs a reason, which the server records
    const [reason, setReason] = useState("");
    const [overriding, setOverriding] = useState(false);
    const reasonInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        (async () => {
            try {
                const { response, data: check } = await getJson("/api/admin/downvote", { pickId: song.pickId!, venue });
                if (!response.ok) throw new Error(check?.error ?? `Couldn't check this song (${response.status})`);
                if (!mounted.current) return;

                setCount(check.count);

                // Karma protection is the only thing in the way, so an admin can override it with a reason
                if (!check.allowed) {
                    setNote({ text: check.reason, error: false });
                    setMode(check.overridable ? "override" : "blocked");
                    return;
                }

                const karma = check.karma > 0 ? `+${check.karma}` : String(check.karma);
                setNote({ text: `${karma} karma (${check.upvotes} up, ${check.downvotes} down). Only for meme songs.`, error: false });
                setMode("allowed");
            } catch (error) {
                if (!mounted.current) return;
                setNote({ text: (error as Error).message, error: true });
                setMode("blocked");
            }
        })();
    }, [song, venue, mounted]);

    // Allowed songs: the first click asks for confirmation and the second downvotes.
    // Protected songs: the first click asks for a reason, and the button only works once there is one
    async function click() {
        if (mode === "allowed") return setMode("confirming");

        if (mode === "override") {
            setOverriding(true);
            setMode("overriding");
            setTimeout(() => reasonInput.current?.focus());
            return;
        }

        const overrideReason = overriding ? reason.trim() : undefined;
        setMode("downvoting");

        try {
            const { response, data } = await postJson("/api/admin/downvote", { pickId: song.pickId, venue, overrideReason });
            if (!response.ok) throw new Error(data?.error ?? `Downvoting failed (${response.status})`);
            if (!mounted.current) return;

            setNote({
                text: `Downvoted ${plural(data.confirmed ?? data.requested, "time")}${overrideReason ? " (override recorded)" : ""}.${data.missing?.length ? ` ${plural(data.missing.length, "vote")} didn't go through.` : ""}`,
                error: false
            });
            setOverriding(false);
            setMode("done");
            onDownvoted();
        } catch (error) {
            if (!mounted.current) return;
            setNote({ text: (error as Error).message, error: true });
            setMode("blocked");
            setCount(6);
        }
    }

    const label = {
        checking: `Downvote ×${count}`,
        blocked: `Downvote ×${count}`,
        allowed: `Downvote ×${count}`,
        confirming: "Confirm downvote ×6",
        override: "Override…",
        overriding: "Downvote ×6 anyway",
        downvoting: "Downvoting…",
        done: "Downvoted ✓"
    }[mode];

    const enabled = mode === "allowed" || mode === "confirming" || mode === "override" || (mode === "overriding" && reason.trim().length >= 3);

    return (
        <div className="downvote-section">
            <div className="downvote-text">
                <div className="downvote-title">Admin</div>
                <p className={cx("downvote-note", note.error && "error-text")}>{mode === "checking" ? <Busy label="Checking…" /> : note.text}</p>
                {overriding && (
                    <input ref={reasonInput} type="text" className="override-reason" maxLength={200} disabled={mode === "downvoting"}
                        placeholder="Why? e.g. 4 hours of 30-minute tracks" aria-label="Reason for overriding karma protection"
                        value={reason} onChange={event => setReason(event.target.value)} />
                )}
            </div>
            <button type="button" className={cx("queue-btn danger", (mode === "confirming" || mode === "overriding" || (mode === "downvoting" && overriding)) && "confirming", mode === "downvoting" && "busy")}
                disabled={!enabled} onClick={click}>
                {mode === "downvoting" ? <Busy label={label} /> : label}
            </button>
        </div>
    );
}
