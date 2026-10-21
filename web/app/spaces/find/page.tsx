"use client";

import { useState } from "react";
import Filters from "@/components/spaces/Filters";
import RoomCard from "@/components/spaces/RoomCard";
import { Spinner } from "@/components/Spinner";
import { clock, timeIn, todayIn } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { filterQuery, useSpaceFilters, useSpaces, type AreaError, type FreeRoom, type SpacesOverview } from "@/lib/spaces";
import { DatePicker, Problems, Updated } from "../shared";

// Times to pick from, every half hour from 6 AM to midnight
const TIMES = Array.from({ length: 37 }, (_, i) => {
    const minutes = 6 * 60 + i * 30;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** The next half hour from now, like "14:30", for the default start */
function nextHalfHour(timezone: string) {
    const [hours, minutes] = timeIn(timezone).split(":").map(Number);
    const next = Math.ceil((hours * 60 + minutes) / 30) * 30;
    const clamped = Math.min(Math.max(next, 6 * 60), 23 * 60);
    return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

const plusHours = (time: string, hours: number) => {
    const index = TIMES.indexOf(time);
    return TIMES[Math.min(index + hours * 2, TIMES.length - 1)];
};

interface Free {
    rooms: FreeRoom[];
    errors: AreaError[];
}

/** Every room free for the whole of a stretch of time on a day, grouped by location */
export default function FindPage() {
    const school = useSchool();
    const [filters] = useSpaceFilters();
    const overview = useSpaces<SpacesOverview>(`/${school.id}`, false);
    const timezone = overview.data?.timezone ?? "America/Los_Angeles";
    const today = todayIn(timezone);

    const [date, setDate] = useState(today);
    const [from, setFrom] = useState(() => nextHalfHour(timezone));
    const [to, setTo] = useState(() => plusHours(nextHalfHour(timezone), 2));

    const query = filterQuery(filters);
    query.set("date", date);
    query.set("from", from);
    query.set("to", to);
    const free = useSpaces<Free>(from < to ? `/${school.id}/free?${query}` : null);

    const byLocation = overview.data?.locations
        .map(location => ({ location, rooms: free.data?.rooms.filter(room => room.location === location.id) ?? [] }))
        .filter(entry => entry.rooms.length) ?? [];

    return (
        <main className="spaces-main">
            <div className="spaces-heading">
                <h1>Find a time</h1>
                <Updated at={free.updatedAt} loading={free.loading} onRefresh={free.reload} />
            </div>
            <p className="spaces-lead">Rooms free for the whole time you need.</p>

            <div className="spaces-controls">
                <DatePicker value={date} today={today} onChange={setDate} />
                <div className="spaces-times">
                    <label>From
                        <select value={from} onChange={event => {
                            setFrom(event.target.value);
                            if (event.target.value >= to) setTo(plusHours(event.target.value, 1));
                        }}>
                            {TIMES.slice(0, -1).map(time => <option key={time} value={time}>{clock(time)}</option>)}
                        </select>
                    </label>
                    <label>Until
                        <select value={to} onChange={event => setTo(event.target.value)}>
                            {TIMES.filter(time => time > from).map(time => <option key={time} value={time}>{time === "24:00" ? "Midnight" : clock(time)}</option>)}
                        </select>
                    </label>
                </div>
                {overview.data && <Filters locations={overview.data.locations} />}
            </div>

            <Problems errors={free.data?.errors} />

            {!free.data ? (
                free.error ? <p className="spaces-message">{free.error}</p> : <div className="spaces-message"><Spinner /></div>
            ) : !free.data.rooms.length ? (
                <p className="spaces-message">Nothing&apos;s free for all of that time. Try a shorter stretch, or another day.</p>
            ) : byLocation.map(({ location, rooms }) => (
                <section key={location.id} className="spaces-location">
                    <h2 className="spaces-subheading">{location.name} <span className="spaces-muted">{rooms.length}</span></h2>
                    <ul className="spaces-cards compact">{rooms.map(room => <RoomCard key={room.id} room={room} />)}</ul>
                </section>
            ))}
        </main>
    );
}
