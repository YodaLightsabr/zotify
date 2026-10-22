"use client";

import { useEffect, useState } from "react";
import { todayIn } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { timeOf, useSpaces, type SpaceRoom, type SpaceSlot } from "@/lib/spaces";
import { minuteOf } from "./Timeline";

// Zotify Spaces' footer: every room's day at once, midnight to midnight, one thin stripe each. Free is lighter than the page
// and booked is darker; closed is the page itself. The booking sites never list a slot once it's started, so the part of
// today that's gone is hatched instead. It refreshes like the pages do

const DAY_MINUTES = 24 * 60;

interface Day {
    rooms: (SpaceRoom & { slots: SpaceSlot[] })[];
}

type Run = { from: number, to: number, free: boolean };

/** A room's slots joined into runs of free or not, in minutes since midnight */
function runsOf(slots: SpaceSlot[], date: string): Run[] {
    const runs: Run[] = [];

    for (const slot of slots) {
        const from = minuteOf(slot.start, date);
        const to = Math.min(minuteOf(slot.end, date), DAY_MINUTES);
        const free = slot.status === "available";
        const last = runs.at(-1);

        if (last && last.to === from && last.free === free) last.to = to;
        else runs.push({ from, to, free });
    }

    return runs;
}

const percent = (minute: number) => `${(minute / DAY_MINUTES) * 100}%`;

export default function SpacesFooter() {
    const school = useSchool();
    const day = useSpaces<Day>(`/${school.id}/availability?date=today`);
    const [now, setNow] = useState<number | null>(null);

    // Where now is on the day, moved along every minute
    useEffect(() => {
        const update = () => {
            const [hours, minutes] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
                .format(new Date()).split(":").map(Number);
            setNow(hours * 60 + minutes);
        };
        update();
        const timer = setInterval(update, 60_000);
        return () => clearInterval(timer);
    }, []);

    const rooms = day.data?.rooms ?? [];
    if (!rooms.length) return null;

    const date = todayIn("America/Los_Angeles");

    return (
        <footer className="spaces-footer" aria-label="Every room today">
            <div className="spaces-footer-head">
                <span>Every room, today</span>
                <span className="spaces-footer-legend">
                    <i className="free" /> Free <i className="booked" /> Booked
                </span>
            </div>

            <div className="spaces-footer-chart">
                {[6, 12, 18].map(hour => <span key={hour} className="spaces-footer-hour" style={{ left: percent(hour * 60) }} />)}
                {now !== null && <>
                    <span className="spaces-footer-past" style={{ width: percent(now) }} />
                    <span className="spaces-footer-now" style={{ left: percent(now) }} />
                </>}

                {rooms.map((room, i) => (
                    // A little gap between locations
                    <div key={room.id} className={`spaces-footer-room${i > 0 && rooms[i - 1].location !== room.location ? " new-location" : ""}`}
                        title={`${room.name}, ${room.locationName}${room.slots.some(slot => slot.status === "available") ? `: free from ${timeOf(room.slots.find(slot => slot.status === "available")!.start)}` : ""}`}>
                        {runsOf(room.slots, date).map(run => (
                            <span key={run.from} className={run.free ? "free" : "booked"} style={{ left: percent(run.from), width: percent(run.to - run.from) }} />
                        ))}
                    </div>
                ))}
            </div>

            <div className="spaces-footer-hours" aria-hidden="true">
                <span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span>
            </div>
        </footer>
    );
}
