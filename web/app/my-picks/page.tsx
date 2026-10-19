"use client";

import { useCallback, useEffect, useState } from "react";
import PickHistory, { type Pick } from "@/components/PickHistory";
import { Spinner } from "@/components/Spinner";
import { getJson } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMember } from "@/lib/useMember";
import "./my-picks.css";

export default function MyPicksPage() {
    const user = useMember("/my-picks");
    const [picks, setPicks] = useState<Pick[] | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            // Sessions can end while the page is open; apiFetch sends them to sign in if so
            const { response, data } = await getJson<Pick[]>("/api/my-picks");
            if (!response.ok) throw new Error(`Couldn't load your picks (${response.status})`);
            setPicks(data);
        } catch (error) {
            setError((error as Error).message);
        }
    }, []);

    useEffect(() => { if (user) load(); }, [user, load]);

    return (
        <div className="page-my-picks">
            <main>
                <h1>My picks</h1>
                <p className="intro">
                    {picks?.length ? `${plural(picks.length, "song")} you've queued with Zotify.` : "Everything you've queued with Zotify."} Request one again with a click.
                </p>
                {error ? <p className="error">{error}</p>
                    : picks ? <PickHistory picks={picks} onRequested={load}
                        emptyText="You haven't queued anything with Zotify yet. Search for a song on the homepage to get started." />
                    : <Spinner small />}
            </main>
        </div>
    );
}
