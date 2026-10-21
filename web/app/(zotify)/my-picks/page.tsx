"use client";

import { useCallback, useEffect, useState } from "react";
import PickHistory, { type Pick } from "@/components/PickHistory";
import { Spinner } from "@/components/Spinner";
import { getJson } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { useMember } from "@/lib/useMember";
import { useVenue } from "@/lib/venue";
import "./my-picks.css";

export default function MyPicksPage() {
    const user = useMember("/my-picks");
    const [venue, setVenue] = useVenue();
    const school = useSchool();
    const [picks, setPicks] = useState<Pick[] | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            // Sessions can end while the page is open; apiFetch sends them to sign in if so
            const { response, data } = await getJson<Pick[]>("/v1/me/picks", { school: school.id });
            if (!response.ok) throw new Error(`Couldn't load your picks (${response.status})`);
            setPicks(data);
        } catch (error) {
            setError((error as Error).message);
        }
    }, [school.id]);

    useEffect(() => { if (user) load(); }, [user, load]);

    return (
        <div className="page-my-picks">
            <main>
                <h1>My picks</h1>
                <p className="intro">
                    {picks?.length ? `${plural(picks.length, "song")} you've queued with Zotify.` : "Everything you've queued with Zotify."} Request one again with a click.
                </p>
                {/* Request again uses the venue picked here, which is the same one the homepage shows. One venue needs no choice */}
                {school.venues.length > 1 && (
                    <div className="venue-picker" role="radiogroup" aria-label="Venue to request at">
                        <span>Requests go to</span>
                        {school.venues.map(({ id, name }) => (
                            <button key={id} type="button" role="radio" aria-checked={venue === id}
                                className={cx("venue-option", venue === id && "current")} onClick={() => setVenue(id)}>{name}</button>
                        ))}
                    </div>
                )}
                {error ? <p className="error">{error}</p>
                    : picks ? <PickHistory picks={picks} onRequested={load}
                        emptyText="You haven't queued anything with Zotify yet. Search for a song on the homepage to get started." />
                    : <Spinner small />}
            </main>
        </div>
    );
}
