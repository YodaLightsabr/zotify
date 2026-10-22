"use client";

import Filters from "@/components/spaces/Filters";
import { RoomsByLocation } from "@/components/spaces/RoomCard";
import { Spinner } from "@/components/Spinner";
import { useSchool } from "@/lib/school";
import { filterQuery, useSpaceFilters, useSpaces, type AreaError, type FreeRoom, type SpacesOverview } from "@/lib/spaces";
import { Problems, Updated } from "./shared";

interface Now {
    at: string;
    rooms: FreeRoom[];
    soon: FreeRoom[];
    errors: AreaError[];
}

/** The front page: rooms free right now by location, longest first, and rooms free soon */
export default function FreeNowPage() {
    const school = useSchool();
    const [filters] = useSpaceFilters();
    const overview = useSpaces<SpacesOverview>(`/${school.id}`, false);
    const query = filterQuery(filters).toString();
    const now = useSpaces<Now>(`/${school.id}/now${query ? `?${query}` : ""}`);

    return (
        <main className="spaces-main">
            <div className="spaces-heading">
                <h1>Free right now</h1>
                <Updated at={now.updatedAt} loading={now.loading} onRefresh={now.reload} />
            </div>

            {overview.data && <Filters locations={overview.data.locations} />}
            <Problems errors={now.data?.errors} />

            {!now.data || !overview.data ? (
                now.error || overview.error ? <p className="spaces-message">{now.error ?? overview.error}</p> : <div className="spaces-message"><Spinner /></div>
            ) : <>
                {now.data.rooms.length
                    ? <RoomsByLocation rooms={now.data.rooms} locations={overview.data.locations} now />
                    : <p className="spaces-message">Nothing's free right now{filters.capacity || filters.locations.length ? " with these filters" : ""}. Try Find a Time.</p>}

                {now.data.soon.length > 0 && <>
                    <h2 className="spaces-subheading">Free soon</h2>
                    <RoomsByLocation rooms={now.data.soon} locations={overview.data.locations} />
                </>}
            </>}
        </main>
    );
}
