"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";
import { useLiveVenues, type LiveVenue } from "@/lib/live";
import { useSchool } from "@/lib/school";
import "./now-playing-bar.css";

/**
 * A thin bar along the bottom of every page except the homepage, which shows the queue itself:
 * the song playing at any of the school's venues, its album art and how long it has left. Rendered once by the root layout
 */
export default function NowPlayingBar() {
    const hidden = usePathname() === "/";
    const school = useSchool();
    // All the school's venues stay live while the bar shows; the first one playing something wins
    const lives = useLiveVenues(school.venues.map(venue => venue.id), !hidden);
    const [now, setNow] = useState(() => Date.now());

    const index = lives.findIndex(live => live?.queue?.nowPlaying);
    const venue = index >= 0 ? school.venues[index] : null;
    const live = index >= 0 ? lives[index] : null;
    const song = live?.queue?.nowPlaying;
    const endsAt = song?.secondsRemaining !== undefined && live ? endOf(live, song.secondsRemaining) : undefined;

    // Count down every second. The server sends the next song when it changes
    useEffect(() => {
        if (hidden || endsAt === undefined) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hidden, endsAt]);

    if (hidden) return null;

    // Still waiting to hear from the venues
    const loading = !song && lives.some(live => !live);

    return (
        <div className="now-playing-bar" role="status" aria-live="polite"
            title={song && venue ? `Now playing at ${venue.name}: ${song.name} by ${song.artist}` : undefined}>
            {!song && !loading && <span className="now-playing-name muted">Nothing&apos;s playing right now</span>}
            {song && <>
                {song.cover
                    ? <img className="now-playing-cover" src={song.cover} alt="" />
                    : <span className="now-playing-cover" aria-hidden="true">♪</span>}
                <span className="now-playing-name">{song.name}</span>
                {endsAt !== undefined && <span className="now-playing-time">{formatTime(Math.max(0, (endsAt - now) / 1000))} left</span>}
            </>}
        </div>
    );
}

/** When the song should end, counted from when its update arrived */
const endOf = (live: LiveVenue, secondsRemaining: number) => live.receivedAt + secondsRemaining * 1000;
