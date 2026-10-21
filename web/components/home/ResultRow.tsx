"use client";

import { useState } from "react";
import { Busy } from "@/components/Spinner";
import { postJson, type Venue } from "@/lib/api";
import { cx, plural, timeAgo, voteSummary } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { CooldownBadge, QueuedBadge, SongBackdrop, SongCover, VotableCover } from "./SongParts";
import type { OpenVote, PlaylistTrack, Song } from "./types";

interface ButtonState {
    label: string;
    // Shown with a spinner, e.g. "Queuing…"
    busy?: string;
    disabled?: boolean;
    variant?: "boost" | "done";
    title?: string;
}

const QUEUED: ButtonState = { label: "Queued ✓", variant: "done", disabled: true };

function initialButton(song: Song, requestable: boolean, boostable: boolean): ButtonState {
    if (!requestable) return { label: "Unavailable", disabled: true };
    if (boostable && song.boostedAt) return { label: "Boosted ✓", variant: "done", disabled: true, title: `Boosted ${timeAgo(song.boostedAt)}` };
    if (boostable) return { label: "Boost", variant: "boost", title: "Upvote it with every account" };
    if (song.status === "queued") return QUEUED;
    if (song.status === "cooldown") return { label: "Cooldown", disabled: true };
    return { label: "Queue" };
}

/** A search result, with a button to queue it, or to boost it when someone else queued it */
export function ResultRow({ song, venue, onVote }: { song: Song, venue: Venue, onVote: OpenVote }) {
    const school = useSchool();
    const requestable = song.requestable !== false;
    // Someone else queued it, so all our accounts can upvote it instead
    const boostable = song.status === "queued" && !!song.pickId && song.queuedByZotify === false;

    const [button, setButton] = useState(() => initialButton(song, requestable, boostable));
    const [error, setError] = useState("");
    // Set once we've queued it ourselves
    const [queuedAt, setQueuedAt] = useState<number | null>(null);

    const update = (changes: Partial<ButtonState>) => setButton(current => ({ ...current, ...changes }));

    async function boost() {
        setError("");
        update({ busy: "Boosting…" });

        try {
            const { response, data } = await postJson(`/v1/venues/${venue}/picks/${song.pickId}/votes`, { songId: song.id });

            if (response.status === 404) {
                setButton({ label: "Not in queue", disabled: true });
                setError(data?.error ?? "");
                return;
            }

            if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);

            setButton({ label: "Boosted ✓", variant: "done", disabled: true, title: voteSummary(data) });
            if (data.missing?.length) setError(`Boosted, but ${plural(data.missing.length, "vote")} didn't go through.`);
        } catch (err) {
            setError((err as Error).message || "Could not boost this song");
            update({ busy: undefined });
        }
    }

    async function queue() {
        setError("");
        update({ busy: "Queuing…" });

        // Into Zotify's queue, which puts it into the venue's queue when there's room
        try {
            const { response, data } = await postJson(`/v1/venues/${venue}/requests`, {
                songId: song.id,
                song: { id: song.id, name: song.name, artist: song.artist, cover: song.cover }
            });

            if (response.status === 409) {
                setButton({ label: "Played recently", disabled: true });
                setError(data?.error ?? "");
                return;
            }

            if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);

            setQueuedAt(data.requestedAt ?? Date.now());
            setButton(QUEUED);
        } catch (err) {
            setError((err as Error).message || "Could not queue song");
            update({ busy: undefined });
        }
    }

    const elsewhere = !requestable && song.availableAt ? school.venueName(song.availableAt) : null;

    return (
        <li className="song">
            <VotableCover song={song} venue={venue} onVote={onVote} />
            <SongBackdrop song={song} />
            <div className="meta">
                <div className="title-row">
                    <div className="name">{song.name}</div>
                    {elsewhere && <span className="badge elsewhere" title={`Not requestable here, but you can request it at ${elsewhere}`}>Available at {elsewhere}</span>}
                    {queuedAt ? <QueuedBadge queuedAt={queuedAt} />
                        : song.status === "queued" ? <QueuedBadge queuedAt={song.queuedAt} />
                        : song.status === "cooldown" ? <CooldownBadge song={song} />
                        : null}
                </div>
                <div className="artist">{song.artist}</div>
                <div className="error" role="alert">{error}</div>
            </div>
            <button
                className={cx("queue-btn", button.variant, button.busy && "busy")}
                disabled={button.disabled || !!button.busy}
                title={button.title}
                onClick={boostable ? boost : queue}
            >
                {button.busy ? <Busy label={button.busy} /> : button.label}
            </button>
        </li>
    );
}

export type TrackState = "waiting" | "searching" | "retrying" | "found" | "missing" | "failed";

const TRACK_LABELS: Record<TrackState, string> = { waiting: "Waiting", searching: "", retrying: "Retrying ", found: "✓", missing: "Not found", failed: "Search failed" };

/** A playlist track while its search is waiting, running or finished, or one Rockbot had no match for */
export function TrackRow({ track, state }: { track: PlaylistTrack, state: TrackState | "not-found" }) {
    return (
        <li className="song">
            <SongCover song={{}} />
            <div className="meta">
                <div className="title-row"><div className="name">{track.title}</div></div>
                <div className="artist">{track.artist}</div>
            </div>
            {/* Not found tracks only say anything when the search failed, to tell "Rockbot had no match" from "we couldn't ask Rockbot" */}
            {state === "failed" ? (
                <span className="track-status" data-state={state} title="The search failed twice, so this song might still be on Rockbot">Search failed</span>
            ) : state !== "not-found" && (
                <span className="track-status" data-state={state}>
                    {TRACK_LABELS[state]}
                    {(state === "searching" || state === "retrying") && <span className="spinner small" role="img" aria-label={state === "searching" ? "Searching" : "Retrying"} />}
                </span>
            )}
        </li>
    );
}
