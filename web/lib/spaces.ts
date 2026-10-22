"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { API_URL } from "./config";
import { clock } from "./meals";

// Zotify Spaces' data, from the public API (src/routes/spaces.ts). Availability is live, so it's fetched fresh every time
// and refreshed while the page is open; only the list of rooms is reused

export interface SpaceRoom {
    id: string;
    name: string;
    capacity: number;
    location: string;
    locationName: string;
    // What people call it, like "Langson"
    locationShortName: string;
    group: string;
    image: string | null;
    description: string | null;
    directions: string | null;
    bookingUrl: string;
}

export interface SpaceLocation {
    id: string;
    name: string;
    shortName: string;
    site: string;
    siteName: string;
    url: string;
    rooms: number;
}

export interface SpaceSlot {
    start: string;
    end: string;
    status: "available" | "booked" | "unavailable";
}

export interface FreeTime {
    start: string;
    end: string;
    minutes: number;
}

export type FreeRoom = SpaceRoom & { freeFrom: string, freeUntil: string, minutes: number, startsInMinutes?: number };

export interface SpacesOverview {
    school: string;
    timezone: string;
    locations: SpaceLocation[];
    rooms: SpaceRoom[];
}

export interface AreaError {
    location: string;
    error: string;
}

// How often availability is fetched again while a page is open and visible
const REFRESH_MS = 30_000;

/**
 * Fetches a path under /v1/spaces, and again every 30 seconds while the page is visible (and when it comes back into view).
 * Keeps showing the last answer while refreshing. null skips it
 */
export function useSpaces<T>(path: string | null, refresh = true) {
    const [state, setState] = useState<{ data?: T, error?: string, loading: boolean, updatedAt?: number }>({ loading: !!path });
    const current = useRef(path);
    current.current = path;

    const load = useCallback(async () => {
        if (!path) return;
        setState(previous => ({ ...previous, loading: true }));

        try {
            const response = await fetch(`${API_URL}/v1/spaces${path}`, { cache: "no-store" });
            const body = await response.json().catch(() => null);
            if (current.current !== path) return;
            if (!response.ok) throw new Error(body?.error ?? `Couldn't load this (${response.status})`);
            setState({ data: body as T, loading: false, updatedAt: Date.now() });
        } catch (error) {
            if (current.current !== path) return;
            setState(previous => ({ ...previous, error: (error as Error).message, loading: false }));
        }
    }, [path]);

    useEffect(() => {
        // A new question shouldn't show the last one's answer
        setState({ loading: !!path });
        load();
        if (!refresh || !path) return;

        const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
        const onVisible = () => { if (!document.hidden) load(); };
        document.addEventListener("visibilitychange", onVisible);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [load, path, refresh]);

    return { ...state, reload: load };
}

// A transparent pixel, which leaves a photo's placeholder background showing
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** For room photos: some sites won't serve theirs to other sites, so a photo that fails shows just its placeholder */
export const hideBrokenPhoto = (event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.src = BLANK; };

// Times from the API are ISO 8601 in the school's timezone, so the date and clock time can be read straight off them

/** "2026-10-21T14:30:00-07:00" → "2:30 PM" */
export const timeOf = (iso: string) => clock(iso.slice(11, 16));

/** "2026-10-21T14:30:00-07:00" → "2026-10-21" */
export const dateOf = (iso: string) => iso.slice(0, 10);

/** 135 → "2h 15m", 45 → "45m" */
export function duration(minutes: number) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}

/** "Free until 4:30 PM", with the day when it runs past midnight */
export function freeUntil(room: Pick<FreeRoom, "freeFrom" | "freeUntil">) {
    const nextDay = dateOf(room.freeUntil) !== dateOf(room.freeFrom) && room.freeUntil.slice(11, 16) !== "00:00";
    return `${timeOf(room.freeUntil)}${nextDay ? " tomorrow" : ""}`;
}

// Filters, remembered in the browser

export interface SpaceFilters {
    // At least this many people; 0 for any
    capacity: number;
    // Location IDs; empty for all
    locations: string[];
}

const FILTERS_KEY = "zotify-spaces:filters";
const DEFAULT_FILTERS: SpaceFilters = { capacity: 0, locations: [] };
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedFilters = DEFAULT_FILTERS;

function readFilters() {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(FILTERS_KEY);
    } catch {}

    if (raw !== cachedRaw) {
        cachedRaw = raw;
        try {
            cachedFilters = raw ? { ...DEFAULT_FILTERS, ...JSON.parse(raw) } : DEFAULT_FILTERS;
        } catch {
            cachedFilters = DEFAULT_FILTERS;
        }
    }

    return cachedFilters;
}

export function useSpaceFilters(): [SpaceFilters, (filters: SpaceFilters) => void] {
    const filters = useSyncExternalStore(
        listener => (listeners.add(listener), () => listeners.delete(listener)),
        readFilters,
        () => DEFAULT_FILTERS
    );

    const setFilters = useCallback((next: SpaceFilters) => {
        try {
            localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
        } catch {}
        listeners.forEach(listener => listener());
    }, []);

    return [filters, setFilters];
}

/** The filters as query parameters for the API */
export function filterQuery(filters: SpaceFilters) {
    const params = new URLSearchParams();
    if (filters.capacity) params.set("capacity", String(filters.capacity));
    if (filters.locations.length) params.set("location", filters.locations.join(","));
    return params;
}
