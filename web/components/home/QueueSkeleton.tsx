"use client";

import { useEffect, useState } from "react";
import { QueueGroup } from "./SongParts";

// If the queue hasn't arrived by now, say so instead of leaving the placeholders up silently
const SLOW_MS = 8000;

/** One placeholder row, shaped like a song in the queue */
function SkeletonRow({ nowPlaying = false, title = "60%", artist = "35%" }: { nowPlaying?: boolean, title?: string, artist?: string }) {
    return (
        <li className={nowPlaying ? "song skeleton now-playing" : "song skeleton"}>
            <div className="cover skeleton-block" />
            <div className="meta">
                <div className="skeleton-line" style={{ width: title }} />
                <div className="skeleton-line short" style={{ width: artist }} />
            </div>
            {nowPlaying && <div className="progress-row"><div className="skeleton-line progress-placeholder" /></div>}
        </li>
    );
}

/** Stands in for the venue's queue until the first update arrives, laid out like the real thing so nothing jumps */
export default function QueueSkeleton() {
    const [slow, setSlow] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => setSlow(true), SLOW_MS);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="queue-skeleton" aria-busy="true" aria-label="Loading the queue">
            <QueueGroup title="Now playing"><ul className="results"><SkeletonRow nowPlaying title="55%" /></ul></QueueGroup>
            <QueueGroup title="On deck">
                <ul className="results">
                    <SkeletonRow title="45%" artist="30%" />
                    <SkeletonRow title="65%" artist="40%" />
                </ul>
            </QueueGroup>
            {slow && <p className="message" role="status">Still connecting to the venue…</p>}
        </div>
    );
}
