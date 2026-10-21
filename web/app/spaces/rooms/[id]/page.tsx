"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { spanOf, Timeline, TimelineHours } from "@/components/spaces/Timeline";
import { Spinner } from "@/components/Spinner";
import { dayLabel, todayIn } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { duration, hideBrokenPhoto, timeOf, useSpaces, type AreaError, type FreeTime, type SpaceRoom, type SpaceSlot } from "@/lib/spaces";
import { Problems, Updated } from "../../shared";

interface RoomWeek extends SpaceRoom {
    days: { date: string, slots: SpaceSlot[], free: FreeTime[] }[];
    errors: AreaError[];
}

/** One room: what it's like, and when it's free over the next week */
export default function RoomPage() {
    const school = useSchool();
    const { id } = useParams<{ id: string }>();
    const room = useSpaces<RoomWeek>(`/${school.id}/rooms/${encodeURIComponent(id)}?days=7`);

    if (!room.data) {
        return (
            <main className="spaces-main narrow">
                {room.error ? <p className="spaces-message">{room.error} <Link href="/browse">Browse rooms</Link></p> : <div className="spaces-message"><Spinner /></div>}
            </main>
        );
    }

    const data = room.data;
    const today = todayIn("America/Los_Angeles");
    // The same hours for every day, so they line up
    const span = spanOf(data.days.map(day => day.slots), today) ?? null;

    return (
        <main className="spaces-main narrow">
            <p className="spaces-back"><Link href="/browse">← Browse</Link></p>

            <div className="spaces-room">
                {data.image && <img className="spaces-room-photo" src={data.image} alt="" onError={hideBrokenPhoto} />}
                <div>
                    <h1>{data.name}</h1>
                    <p className="spaces-muted">{data.locationName}{data.group && data.group !== data.locationName ? ` · ${data.group}` : ""} · {data.capacity} {data.capacity === 1 ? "person" : "people"}</p>
                    <a className="spaces-book large" href={data.bookingUrl} target="_blank" rel="noreferrer">Book on {new URL(data.bookingUrl).host}</a>
                </div>
            </div>

            {data.description && <p className="spaces-description">{data.description}</p>}
            {data.directions && <p className="spaces-description spaces-muted">{data.directions}</p>}

            <div className="spaces-heading">
                <h2 className="spaces-subheading">This week</h2>
                <Updated at={room.updatedAt} loading={room.loading} onRefresh={room.reload} />
            </div>
            <Problems errors={data.errors} />

            <ul className="spaces-week">
                {data.days.map(day => {
                    // Each day's own hours, since a day's slots are on its own date
                    const daySpan = spanOf([day.slots], day.date);
                    return (
                        <li key={day.date}>
                            <div className="spaces-week-day">
                                <strong>{dayLabel(day.date, today)}</strong>
                                <span className="spaces-muted small">
                                    {day.free.length
                                        ? day.free.map(stretch => `${timeOf(stretch.start)}–${timeOf(stretch.end)}`).join(", ")
                                        : day.slots.length ? "Booked up" : "Can't be booked yet"}
                                </span>
                                {day.free.length > 0 && <span className="spaces-muted small">{duration(day.free.reduce((total, stretch) => total + stretch.minutes, 0))} free</span>}
                            </div>
                            {daySpan && <>
                                <TimelineHours span={daySpan} />
                                <Timeline slots={day.slots} date={day.date} span={daySpan} />
                            </>}
                        </li>
                    );
                })}
            </ul>
            {!span && <p className="spaces-message">Nothing can be booked this week.</p>}
        </main>
    );
}
