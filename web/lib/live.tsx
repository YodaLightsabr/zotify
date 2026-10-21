"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";
import type { VenueQueue } from "@/components/home/types";
import type { ZotifyQueue } from "@/components/home/ZotifyQueue";
import type { Venue } from "./api";
import { API_URL } from "./config";
import { useUser } from "./user";

// Live updates from the API over socket.io (see src/live.ts). One connection, opened by the root layout, stays up while
// people move between pages, and fills a store that pages read with the hooks below. Pages say what they want to watch,
// and the server sends the latest straight away, then every update after.

export type Outcome = "waiting" | "working" | "queued" | "not-found" | "unavailable" | "already-queued" | "played-recently" | "duplicate" | "failed";

/** A playlist's "queue all" job on the server (see src/playlistQueue.ts) */
export interface QueueJob {
    venue: Venue;
    startedAt: number;
    finishedAt: number | null;
    stoppedEarly: string | null;
    tracks: { title: string, artist: string, outcome: Outcome, error?: string }[];
}

export interface LiveVenue {
    // Null if the server has never managed to load it
    queue: VenueQueue | null;
    error: string | null;
    // When it arrived, which the playing song's time left counts from
    receivedAt: number;
}

interface LiveState {
    venues: Partial<Record<Venue, LiveVenue>>;
    // Only sent to approved members
    zotify: Partial<Record<Venue, ZotifyQueue>>;
    // Keyed by "{playlist id}:{venue}"; null when nobody has started one lately
    playlistJobs: Record<string, QueueJob | null>;
}

// The store: plain state that's replaced on every update, so each hook re-renders only when its own part changes
let state: LiveState = { venues: {}, zotify: {}, playlistJobs: {} };
const listeners = new Set<() => void>();

function update(change: (current: LiveState) => LiveState) {
    state = change(state);
    listeners.forEach(listener => listener());
}

function useLive<T>(select: (state: LiveState) => T) {
    return useSyncExternalStore(
        listener => { listeners.add(listener); return () => listeners.delete(listener); },
        () => select(state),
        () => select(state)
    );
}

// What pages are watching, counted so two components watching the same venue only ask once
type Watch = { event: "watch", payload: { venue: Venue } } | { event: "watchPlaylist", payload: { id: string, venue: Venue } };
const watching = new Map<string, { watch: Watch, count: number }>();
let socket: Socket | null = null;

function watch(key: string, watch: Watch) {
    const current = watching.get(key);

    if (current) {
        current.count++;
    } else {
        watching.set(key, { watch, count: 1 });
        socket?.emit(watch.event, watch.payload);
    }

    return () => {
        const entry = watching.get(key);
        if (!entry || --entry.count > 0) return;

        watching.delete(key);
        socket?.emit(watch.event === "watch" ? "unwatch" : "unwatchPlaylist", watch.payload);
    };
}

/**
 * Keeps the connection open for the whole visit. Signing in or out reconnects, since the server decides what each connection
 * may watch from the session cookie it was opened with
 */
export function LiveProvider({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const known = user !== undefined;
    const email = user?.email ?? null;
    const approved = !!user?.approved;

    useEffect(() => {
        // Wait until we know who's signed in, so the first connection is the right one
        if (!known) return;

        const connection = io(API_URL, { withCredentials: true });
        socket = connection;

        // Rooms don't survive a reconnect, so ask for everything again. The server answers each with the latest
        connection.on("connect", () => {
            for (const { watch } of watching.values()) connection.emit(watch.event, watch.payload);
        });

        connection.on("venueQueue", ({ venue, queue, error }: { venue: Venue, queue: VenueQueue | null, error: string | null }) =>
            update(current => ({ ...current, venues: { ...current.venues, [venue]: { queue, error, receivedAt: Date.now() } } })));

        connection.on("zotifyQueue", ({ venue, waiting, failures }: { venue: Venue } & ZotifyQueue) =>
            update(current => ({ ...current, zotify: { ...current.zotify, [venue]: { waiting, failures } } })));

        connection.on("playlistQueue", ({ playlistId, venue, job }: { playlistId: string, venue: Venue, job: QueueJob | null }) =>
            update(current => ({ ...current, playlistJobs: { ...current.playlistJobs, [`${playlistId}:${venue}`]: job } })));

        return () => {
            connection.disconnect();
            if (socket === connection) socket = null;
            // What this connection was allowed to see may not apply to the next one
            update(current => ({ ...current, zotify: {}, playlistJobs: {} }));
        };
    }, [known, email, approved]);

    return <>{children}</>;
}

/** A venue's queue, kept up to date. Undefined until the first update arrives. Pass false to stop watching */
export function useLiveVenue(venue: Venue, enabled = true) {
    useEffect(() => enabled ? watch(`venue:${venue}`, { event: "watch", payload: { venue } }) : undefined, [venue, enabled]);
    return useLive(current => enabled ? current.venues[venue] : undefined);
}

/** Several venues' queues at once, in the same order, kept up to date. Each is undefined until its first update arrives */
export function useLiveVenues(venues: Venue[], enabled = true) {
    const key = venues.join(",");

    useEffect(() => {
        if (!enabled) return;
        const stops = key.split(",").filter(Boolean).map(venue => watch(`venue:${venue}`, { event: "watch", payload: { venue } }));
        return () => stops.forEach(stop => stop());
    }, [key, enabled]);

    // The whole map is stable between updates; the list is made from it only when it changes
    const all = useLive(current => current.venues);
    return useMemo(() => venues.map(venue => enabled ? all[venue] : undefined), [all, key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Zotify's own queue at a venue, for approved members. Watch the venue with useLiveVenue to get it */
export function useLiveZotifyQueue(venue: Venue) {
    return useLive(current => current.zotify[venue]);
}

/** A playlist's "queue all" job at a venue. Undefined until the server answers, then null if there isn't one */
export function useLivePlaylistJob(id: string, venue: Venue) {
    useEffect(() => watch(`playlist:${id}:${venue}`, { event: "watchPlaylist", payload: { id, venue } }), [id, venue]);
    return useLive(current => current.playlistJobs[`${id}:${venue}`]);
}

/** Lets a page show what came back from starting something before the server's broadcast arrives */
export function setPlaylistJob(id: string, venue: Venue, job: QueueJob) {
    update(current => ({ ...current, playlistJobs: { ...current.playlistJobs, [`${id}:${venue}`]: job } }));
}
