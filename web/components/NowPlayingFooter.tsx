"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import { VENUES } from "@/lib/format";

interface Playing { venue: string, name: string, artist: string }

/** What's playing at either venue, kept fresh, so pages like sign-in feel live */
export default function NowPlayingFooter() {
    const [playing, setPlaying] = useState<Playing | null | undefined>(undefined);

    useEffect(() => {
        async function update() {
            for (const [venue, label] of VENUES) {
                try {
                    const { response, data } = await getJson("/api/venue-queue", { venue });
                    if (response.ok && data?.nowPlaying) return setPlaying({ venue: label, ...data.nowPlaying });
                } catch {}
            }

            setPlaying(null);
        }

        update();
        const timer = setInterval(() => { if (!document.hidden) update(); }, 20_000);
        return () => clearInterval(timer);
    }, []);

    return (
        <footer aria-live="polite">
            <span className="live-dot" aria-hidden="true" />
            <span>
                {playing === undefined && "Checking what's playing…"}
                {playing === null && "Nothing's playing right now"}
                {playing && <>Now playing at {playing.venue}: <strong>{playing.name}</strong> by {playing.artist}</>}
            </span>
        </footer>
    );
}
