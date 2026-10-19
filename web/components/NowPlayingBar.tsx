"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import { formatTime, VENUES } from "@/lib/format";
import "./now-playing-bar.css";

// How often to check what's playing, like the homepage's queue
const REFRESH_MS = 20_000;

interface Playing {
    venue: string;
    name: string;
    artist: string;
    cover?: string;
    // When the song should end, from the remaining time Rockbot gave us
    endsAt?: number;
}

/**
 * A thin bar along the bottom of every page except the homepage, which shows the queue itself:
 * the song playing at either venue, its album art and how long it has left. Rendered once by the root layout
 */
export default function NowPlayingBar() {
    const pathname = usePathname();
    const hidden = pathname === "/";
    // undefined while loading, null when nothing's playing at either venue
    const [playing, setPlaying] = useState<Playing | null | undefined>(undefined);
    const [now, setNow] = useState(() => Date.now());

    const update = useCallback(async () => {
        for (const [venue, label] of VENUES) {
            try {
                const { response, data } = await getJson("/api/venue-queue", { venue });
                const song = response.ok ? data?.nowPlaying : null;

                if (song) {
                    setPlaying({
                        venue: label,
                        name: song.name,
                        artist: song.artist,
                        cover: song.cover,
                        endsAt: song.secondsRemaining !== undefined ? Date.now() + song.secondsRemaining * 1000 : undefined
                    });
                    return;
                }
            } catch {}
        }

        setPlaying(null);
    }, []);

    useEffect(() => {
        if (hidden) return;

        update();
        const timer = setInterval(() => { if (!document.hidden) update(); }, REFRESH_MS);
        return () => clearInterval(timer);
    }, [hidden, update]);

    // Count down every second, and look again once the song should be over
    useEffect(() => {
        if (hidden || !playing?.endsAt) return;

        const timer = setInterval(() => {
            setNow(Date.now());
            if (Date.now() > playing.endsAt! + 2000) update();
        }, 1000);
        return () => clearInterval(timer);
    }, [hidden, playing, update]);

    if (hidden) return null;

    return (
        <div className="now-playing-bar" role="status" aria-live="polite"
            title={playing ? `Now playing at ${playing.venue}: ${playing.name} by ${playing.artist}` : undefined}>
            {playing === null && <span className="now-playing-name muted">Nothing&apos;s playing right now</span>}
            {playing && <>
                {playing.cover
                    ? <img className="now-playing-cover" src={playing.cover} alt="" />
                    : <span className="now-playing-cover" aria-hidden="true">♪</span>}
                <span className="now-playing-name">{playing.name}</span>
                {playing.endsAt !== undefined && <span className="now-playing-time">{formatTime(Math.max(0, (playing.endsAt - now) / 1000))} left</span>}
            </>}
        </div>
    );
}
