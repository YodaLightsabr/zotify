"use client";

import { useCallback, useEffect, useState } from "react";
import PickHistory, { type Pick } from "@/components/PickHistory";
import { Spinner } from "@/components/Spinner";
import { getJson } from "@/lib/api";
import { plural } from "@/lib/format";
import { useSchool } from "@/lib/school";

/** Every song you've queued with Zotify at this school, by day, newest first */
export default function LibraryHistoryPage() {
    const school = useSchool();
    const [picks, setPicks] = useState<Pick[] | null>(null);
    const [error, setError] = useState("");

    const load = useCallback(async () => {
        try {
            // Sessions can end while the page is open; apiFetch sends them to sign in if so
            const { response, data } = await getJson<Pick[]>("/v1/me/picks", { school: school.id });
            if (!response.ok) throw new Error(`Couldn't load your history (${response.status})`);
            setPicks(data);
        } catch (error) {
            setError((error as Error).message);
        }
    }, [school.id]);

    useEffect(() => { load(); }, [load]);

    if (error) return <p className="message error-text">{error}</p>;
    if (!picks) return <div className="message"><Spinner /></div>;

    return <>
        {picks.length > 0 && <p className="library-intro">{plural(picks.length, "song")} you&apos;ve queued with Zotify. Request one again with a click.</p>}
        <PickHistory picks={picks} onRequested={load}
            emptyText="You haven't queued anything with Zotify yet. Search for a song on the homepage to get started." />
    </>;
}
