"use client";

import Filters from "@/components/spaces/Filters";
import RoomCard from "@/components/spaces/RoomCard";
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

/** The front page: rooms free right now, longest first, and rooms free soon */
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
            <p className="spaces-lead">Study rooms you can book from now or the next half hour, longest free first.</p>

            {overview.data && <Filters locations={overview.data.locations} />}
            <Problems errors={now.data?.errors} />

            {!now.data ? (
                now.error ? <p className="spaces-message">{now.error}</p> : <div className="spaces-message"><Spinner /></div>
            ) : <>
                {now.data.rooms.length
                    ? <ul className="spaces-cards">{now.data.rooms.map(room => <RoomCard key={room.id} room={room} now />)}</ul>
                    : <p className="spaces-message">Nothing's free right now{filters.capacity || filters.locations.length ? " with these filters" : ""}. Try Find a Time.</p>}

                {now.data.soon.length > 0 && <>
                    <h2 className="spaces-subheading">Free soon</h2>
                    <ul className="spaces-cards compact">{now.data.soon.map(room => <RoomCard key={room.id} room={room} />)}</ul>
                </>}
            </>}
        </main>
    );
}
