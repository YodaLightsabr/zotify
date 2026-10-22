"use client";

import { useEffect, useState } from "react";
import { todayIn } from "@/lib/meals";
import { useSchool } from "@/lib/school";
import { timeOf, useSpaces, type SpaceRoom, type SpaceSlot } from "@/lib/spaces";
import { minuteOf } from "./Timeline";

// Zotify Spaces' footer: every room's day at once, midnight to midnight, one thin stripe each, across the whole page. Free is
// lighter than the page and booked is darker; closed is the page itself. Each location's rooms are together, with its name in
// the top left corner. Slots that have started come from Zotify's record
// of them (see src/spaces/availability.ts). It refreshes like the pages do

const DAY_MINUTES = 24 * 60;

interface Day {
    rooms: (SpaceRoom & { slots: (SpaceSlot & { past?: true })[] })[];
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

/** Rooms grouped by location, in the order they come */
function sections(rooms: Day["rooms"]) {
    const groups: { name: string, rooms: Day["rooms"] }[] = [];
    for (const room of rooms) {
        const last = groups.at(-1);
        if (last && last.rooms[0].location === room.location) last.rooms.push(room);
        else groups.push({ name: room.locationShortName, rooms: [room] });
    }
    return groups;
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

    // Rooms that can't be booked at all today would only be empty rows
    const rooms = day.data?.rooms.filter(room => room.slots.some(slot => slot.status !== "unavailable")) ?? [];
    if (!rooms.length) return null;

    const date = todayIn("America/Los_Angeles");

    return (
        <footer className="spaces-footer" aria-label="Every room today">
            <div className="spaces-footer-chart">
                {[6, 12, 18].map(hour => <span key={hour} className="spaces-footer-hour" style={{ left: percent(hour * 60) }} />)}
                {now !== null && <span className="spaces-footer-now" style={{ left: percent(now) }} />}

                {sections(rooms).map(({ name, rooms: here }) => (
                    <section key={here[0].location} className="spaces-footer-location" aria-label={name}>
                        <span className="spaces-footer-label">{name}</span>
                        {here.map(room => (
                            <div key={room.id} className="spaces-footer-room"
                                title={`${room.name}, ${room.locationName}${room.slots.some(slot => slot.status === "available" && !slot.past) ? `: free from ${timeOf(room.slots.find(slot => slot.status === "available" && !slot.past)!.start)}` : ""}`}>
                                {runsOf(room.slots, date).map(run => (
                                    <span key={run.from} className={run.free ? "free" : "booked"} style={{ left: percent(run.from), width: percent(run.to - run.from) }} />
                                ))}
                            </div>
                        ))}
                    </section>
                ))}
            </div>

            <div className="spaces-footer-hours" aria-hidden="true">
                <span>12 AM</span><span>6 AM</span><span>Noon</span><span>6 PM</span><span>12 AM</span>
            </div>
        </footer>
    );
}
