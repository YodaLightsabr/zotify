"use client";

import { useCallback } from "react";
import PickHistory, { type Pick } from "@/components/PickHistory";
import { plural } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { adminGet, Loading, useLoad } from "./shared";

// Pick history: every song queued through Zotify

export default function History() {
    const school = useSchool();
    const { data, error, reload } = useLoad(useCallback(() => adminGet<Pick[]>(`/v1/schools/${school.id}/history`, "the history"), [school.id]));

    return (
        <section className="panel" aria-labelledby="history-title">
            <div className="panel-header">
                <h2 id="history-title">Pick history</h2>
                <div>
                    <span className="muted">{data && `${plural(data.length, "pick")}  `}</span>
                    <button className="small" type="button" onClick={reload}>Refresh</button>
                </div>
            </div>
            {!data ? <Loading error={error} /> : <PickHistory picks={data} showRequester emptyText="Nothing queued through Zotify yet." onRequested={reload} />}
        </section>
    );
}
