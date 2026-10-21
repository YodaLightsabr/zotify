import { clock } from "@/lib/meals";
import { timeOf, type SpaceSlot } from "@/lib/spaces";

/** Minutes since midnight on date for an ISO time; times on the next day count past 1440 */
export function minuteOf(iso: string, date: string) {
    const minutes = Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
    return iso.slice(0, 10) > date ? minutes + 1440 : minutes;
}

/** The hours a set of timelines should span: from the earliest slot to the latest, to the hour */
export function spanOf(slotLists: SpaceSlot[][], date: string): [number, number] | null {
    const slots = slotLists.flat();
    if (!slots.length) return null;

    const start = Math.min(...slots.map(slot => minuteOf(slot.start, date)));
    const end = Math.max(...slots.map(slot => minuteOf(slot.end, date)));
    return [Math.floor(start / 60) * 60, Math.ceil(end / 60) * 60];
}

const STATUS = { available: "Free", booked: "Booked", unavailable: "Can't be booked" };

/** A day's slots as a bar: free in green, booked and unbookable in gray. Times outside the slots are blank */
export function Timeline({ slots, date, span }: { slots: SpaceSlot[], date: string, span: [number, number] }) {
    const [from, to] = span;
    const position = (minute: number) => `${((minute - from) / (to - from)) * 100}%`;

    return (
        <div className="spaces-timeline" role="img" aria-label={slots.filter(slot => slot.status === "available").length ? "Free at times" : "Not free"}>
            {slots.map(slot => {
                const start = minuteOf(slot.start, date);
                const end = minuteOf(slot.end, date);
                return (
                    <span key={slot.start} className={`spaces-slot ${slot.status}`} title={`${timeOf(slot.start)}–${timeOf(slot.end)}: ${STATUS[slot.status]}`}
                        style={{ left: position(start), width: `calc(${position(end)} - ${position(start)})` }} />
                );
            })}
        </div>
    );
}

/** Hour labels to line up above timelines, every two hours */
export function TimelineHours({ span }: { span: [number, number] }) {
    const [from, to] = span;
    const hours = [];
    for (let minute = from; minute <= to; minute += 120) hours.push(minute);

    return (
        <div className="spaces-hours" aria-hidden="true">
            {hours.map(minute => (
                <span key={minute} style={{ left: `${((minute - from) / (to - from)) * 100}%` }}>
                    {clock(`${Math.floor(minute / 60) % 24}:00`)}
                </span>
            ))}
        </div>
    );
}
