"use client";

import Link from "next/link";
import { useState } from "react";
import Filters from "@/components/spaces/Filters";
import { spanOf, Timeline, TimelineHours } from "@/components/spaces/Timeline";
import { Spinner } from "@/components/Spinner";
import { todayIn } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { duration, filterQuery, timeOf, useSpaceFilters, useSpaces, type AreaError, type FreeTime, type SpaceRoom, type SpaceSlot, type SpacesOverview } from "@/lib/spaces";
import { DatePicker, Problems, Updated } from "../shared";

interface Day {
    date: string;
    rooms: (SpaceRoom & { slots: SpaceSlot[], free: FreeTime[] })[];
    errors: AreaError[];
}

/** Every room's day at a glance, by location, like the booking sites' grids but across all of them */
export default function BrowsePage() {
    const school = useSchool();
    const [filters] = useSpaceFilters();
    const overview = useSpaces<SpacesOverview>(`/${school.id}`, false);
    const today = todayIn(overview.data?.timezone ?? "America/Los_Angeles");
    const [date, setDate] = useState(today);

    const query = filterQuery(filters);
    query.set("date", date);
    const day = useSpaces<Day>(`/${school.id}/availability?${query}`);

    const span = day.data && spanOf(day.data.rooms.map(room => room.slots), date);
    const byLocation = overview.data?.locations
        .map(location => ({ location, rooms: day.data?.rooms.filter(room => room.location === location.id) ?? [] }))
        .filter(entry => entry.rooms.length) ?? [];

    return (
        <main className="spaces-main">
            <div className="spaces-heading">
                <h1>Browse</h1>
                <Updated at={day.updatedAt} loading={day.loading} onRefresh={day.reload} />
            </div>
            <p className="spaces-lead">Every room&apos;s day. Green is free; hover for times, and open a room to see its week.</p>

            <div className="spaces-controls">
                <DatePicker value={date} today={today} onChange={setDate} />
                {overview.data && <Filters locations={overview.data.locations} />}
            </div>

            <Problems errors={day.data?.errors} />

            {!day.data ? (
                day.error ? <p className="spaces-message">{day.error}</p> : <div className="spaces-message"><Spinner /></div>
            ) : !span ? (
                <p className="spaces-message">Nothing can be booked {date === today ? "for the rest of today" : "that day"}.</p>
            ) : byLocation.map(({ location, rooms }) => (
                <section key={location.id} className="spaces-location">
                    <div className="spaces-grid-head">
                        <h2 className="spaces-subheading">{location.name}</h2>
                        <TimelineHours span={span} />
                    </div>
                    <ul className="spaces-grid">
                        {rooms.map(room => {
                            const free = room.free.reduce((total, stretch) => total + stretch.minutes, 0);
                            return (
                                <li key={room.id} className="spaces-grid-row">
                                    <div className="spaces-grid-room">
                                        <Link href={`/rooms/${room.id}`}>{room.name}</Link>
                                        <span className="spaces-muted small">
                                            {room.capacity} {room.capacity === 1 ? "person" : "people"}
                                            {room.free[0] ? ` · free ${timeOf(room.free[0].start)}${free ? `, ${duration(free)} in all` : ""}` : " · booked up"}
                                        </span>
                                    </div>
                                    <Timeline slots={room.slots} date={date} span={span} />
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </main>
    );
}
