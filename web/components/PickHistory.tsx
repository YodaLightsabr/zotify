"use client";

import { useState } from "react";
import { postJson, type Venue } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { useVenue } from "@/lib/venue";
import { Busy } from "./Spinner";
import "./pick-history.css";

export interface Pick {
    pickId: string;
    songId: string;
    name: string;
    artist: string;
    cover?: string;
    venue: Venue;
    requestedAt: number;
    requestedBy?: string;
}

const PAGE_SIZE = 100;

function dayLabel(timestamp: number) {
    const day = new Date(timestamp).toDateString();
    if (day === new Date().toDateString()) return "Today";
    if (day === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
    return new Date(timestamp).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

interface Props {
    picks: Pick[];
    // Show who queued each pick
    showRequester?: boolean;
    // Shown when there are no picks
    emptyText?: string;
    // Called after a successful Request again
    onRequested?: () => void;
}

/** A pick history: songs grouped by day, newest first, each with "Request again". Used by the admin dashboard and My picks */
export default function PickHistory({ picks, showRequester = false, emptyText = "Nothing here yet.", onRequested }: Props) {
    const [shown, setShown] = useState(PAGE_SIZE);

    if (!picks.length) return <div className="pick-history"><p className="empty">{emptyText}</p></div>;

    // Group the shown picks by day, keeping newest first
    const sorted = [...picks].sort((a, b) => b.requestedAt - a.requestedAt);
    const days = new Map<string, Pick[]>();

    for (const pick of sorted.slice(0, shown)) {
        const label = dayLabel(pick.requestedAt);
        days.set(label, [...(days.get(label) ?? []), pick]);
    }

    return (
        <div className="pick-history">
            {[...days].map(([label, dayPicks]) => (
                <section className="history-day" key={label}>
                    <h3>{label} ({dayPicks.length})</h3>
                    <div className="history-rows">
                        {dayPicks.map(pick => <Row key={`${pick.pickId}-${pick.requestedAt}`} pick={pick} showRequester={showRequester} onRequested={onRequested} />)}
                    </div>
                </section>
            ))}
            {sorted.length > shown && (
                <p>
                    <button type="button" className="history-button" onClick={() => setShown(shown + PAGE_SIZE)}>
                        Show more ({sorted.length - shown} older)
                    </button>
                </p>
            )}
        </div>
    );
}

function Row({ pick, showRequester, onRequested }: { pick: Pick, showRequester: boolean, onRequested?: () => void }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [label, setLabel] = useState("Request again");
    const [done, setDone] = useState(false);
    const [status, setStatus] = useState({ text: "", error: false });

    const school = useSchool();
    // Requests go to the venue picked now, wherever the song played before
    const [venue] = useVenue();

    // Into Zotify's queue, like the homepage's Queue button
    async function requestAgain() {
        setBusy("Queuing…");
        setStatus({ text: "", error: false });

        try {
            const { response, data } = await postJson("/api/queue", {
                song: { id: pick.songId, name: pick.name, artist: pick.artist, cover: pick.cover },
                venue
            });

            if (response.status === 409) {
                setLabel("Played recently");
                setDone(true);
                setStatus({ text: data?.error ?? "", error: false });
                return;
            }

            if (!response.ok) throw new Error(data?.error ?? `Couldn't queue it (${response.status})`);

            setLabel("Queued ✓");
            setDone(true);
            onRequested?.();
        } catch (error) {
            setStatus({ text: (error as Error).message, error: true });
        } finally {
            setBusy(null);
        }
    }

    const who = showRequester && pick.requestedBy ? ` · ${school.shortEmail(pick.requestedBy)}` : "";

    return (
        <div className="history-row">
            <div className="song-cell">
                <span className="time">{new Date(pick.requestedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                {pick.cover ? <img src={pick.cover} alt="" loading="lazy" /> : <div className="no-cover">♪</div>}
                <div className="title">
                    <span className="name">{pick.name}</span>
                    <span className="details">{pick.artist} · {school.venueName(pick.venue)}{who}</span>
                </div>
            </div>
            <div className="row-actions">
                <span className={cx("row-status", status.error && "error")}>{status.text}</span>
                <button type="button" className={cx("history-button", busy && "busy")} disabled={!!busy || done} onClick={requestAgain}
                    title={`Queue it at ${school.venueName(venue)}`}>
                    {busy ? <Busy label={busy} /> : label}
                </button>
            </div>
        </div>
    );
}
