"use client";

import { useEffect, useState } from "react";
import { addDays, dayLabel } from "@/lib/meals";
import { cx } from "@/lib/format";
import type { AreaError } from "@/lib/spaces";

// Pieces Zotify Spaces' pages share

/** "Updated 12:34:56" and a refresh button, so it's clear the availability is live */
export function Updated({ at, loading, onRefresh }: { at?: number, loading: boolean, onRefresh: () => void }) {
    // Re-render now and then so "just now" stays true
    const [, tick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => tick(count => count + 1), 10_000);
        return () => clearInterval(timer);
    }, []);

    const seconds = at ? Math.round((Date.now() - at) / 1000) : null;
    const label = seconds === null ? "Loading…" : seconds < 10 ? "Updated just now" : `Updated ${seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`} ago`;

    return (
        <button type="button" className={cx("spaces-updated", loading && "loading")} onClick={onRefresh} title="Refresh">
            <span className="spaces-live-dot" aria-hidden="true" /> {loading && at ? "Refreshing…" : label}
        </button>
    );
}

// Booking sites take bookings about two weeks ahead
export const BOOKABLE_DAYS = 14;

/** Today and the next two weeks, as chips */
export function DatePicker({ value, today, onChange }: { value: string, today: string, onChange: (date: string) => void }) {
    return (
        <div className="spaces-chips spaces-dates" role="tablist" aria-label="Day">
            {Array.from({ length: BOOKABLE_DAYS }, (_, i) => addDays(today, i)).map(date => (
                <button key={date} type="button" role="tab" aria-selected={date === value} className={cx("spaces-chip", date === value && "current")}
                    onClick={() => onChange(date)}>{dayLabel(date, today)}</button>
            ))}
        </div>
    );
}

/** Booking sites that couldn't be reached, so their rooms are missing */
export function Problems({ errors }: { errors?: AreaError[] }) {
    if (!errors?.length) return null;
    return <p className="spaces-problem" role="status">Some rooms are missing: {errors.map(error => error.error).join("; ")}.</p>;
}
