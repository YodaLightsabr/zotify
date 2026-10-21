"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Venue } from "./api";
import { useSchool } from "./school";

// The venue someone's picked, remembered in localStorage so it's still chosen next visit, and shared by every page (and
// other tabs) so switching on one switches everywhere. Each school remembers its own. Storage can be missing or blocked,
// in which case it lasts until reload
const keyFor = (schoolId: string) => `zotify:venue:${schoolId}`;

const listeners = new Set<() => void>();
// What was picked this visit at each school, for when storage isn't available
const picked = new Map<string, Venue>();

function read(schoolId: string, venues: Venue[]): Venue {
    try {
        const stored = localStorage.getItem(keyFor(schoolId));
        if (stored && venues.includes(stored)) return stored;
    } catch {}

    const remembered = picked.get(schoolId);
    return remembered && venues.includes(remembered) ? remembered : venues[0] ?? "";
}

function save(schoolId: string, venue: Venue) {
    picked.set(schoolId, venue);

    try {
        localStorage.setItem(keyFor(schoolId), venue);
    } catch {}

    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    // Another tab picking a venue changes it here too
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith("zotify:venue:")) listener(); };
    window.addEventListener("storage", onStorage);

    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

/**
 * The current venue at this school and a way to change it. Pages are prerendered without storage, so they start on the
 * school's first venue and switch once loaded. Empty if the school has no venues yet
 */
export function useVenue(): [Venue, (venue: Venue) => void] {
    const school = useSchool();
    const ids = school.venues.map(venue => venue.id);
    const venue = useSyncExternalStore(subscribe, () => read(school.id, ids), () => ids[0] ?? "");
    const setVenue = useCallback((next: Venue) => save(school.id, next), [school.id]);

    return [venue, setVenue];
}

/** Whether a value is one of this school's venues, e.g. from a link's ?venue= */
export function useIsVenue() {
    const school = useSchool();
    return useCallback((value: unknown): value is Venue => school.venues.some(venue => venue.id === value), [school]);
}
