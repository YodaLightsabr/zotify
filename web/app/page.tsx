"use client";

import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { QueueGroup, QueueRow } from "@/components/home/SongParts";
import { ResultRow, TrackRow, type TrackState } from "@/components/home/ResultRow";
import type { OpenVote, Playlist, PlaylistTrack, QueueEntry, Song, VenueQueue } from "@/components/home/types";
import VoteDialog from "@/components/home/VoteDialog";
import Navbar from "@/components/Navbar";
import { Spinner } from "@/components/Spinner";
import { getJson, goToLogin, type Venue } from "@/lib/api";
import { cx, otherVenue, VENUE_LABELS, VENUES } from "@/lib/format";
import { useUser } from "@/lib/user";
import "./home.css";

const QUEUE_REFRESH_MS = 20_000;

const SPOTIFY_PLAYLIST_LINK = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/[A-Za-z0-9]{22}|spotify:playlist:[A-Za-z0-9]{22}/i;

// Only this many playlist searches run at once, to go easy on Rockbot
const PLAYLIST_SEARCH_CONCURRENCY = 3;

/** Runs worker over items with at most `limit` running at once. Stops starting new ones once shouldStop() is true */
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>, shouldStop = () => false) {
    let next = 0;
    const runner = async () => {
        while (next < items.length && !shouldStop()) {
            const index = next++;
            await worker(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

/** GET that throws the API's error message */
async function fetchOrThrow<T>(path: string, params: Record<string, string>, failure: string) {
    const { response, data } = await getJson(path, params);
    if (!response.ok) throw new Error(data?.error ?? `${failure} (${response.status})`);
    return data as T;
}

/** Finds a playlist track's Rockbot song on the server, which also tries the artist alone if needed. Null means not on Rockbot */
const fetchMatch = async (track: PlaylistTrack, venue: Venue) =>
    (await fetchOrThrow<{ match: Song | null }>("/api/match", { title: track.title, artist: track.artist, venue }, "Search failed")).match;

type NotFound = PlaylistTrack & { failed: boolean };

// What's shown under the search box after searching
type Output =
    | { kind: "loading" }
    | { kind: "message", text: string }
    | { kind: "results", songs: Song[], venue: Venue, notFound: NotFound[], playlist?: Playlist }
    | { kind: "playlist", playlist: Playlist, states: TrackState[], finished: number };

export default function HomePage() {
    return <Suspense><Home /></Suspense>;
}

function Home() {
    const { user } = useUser();
    const params = useSearchParams();

    const [venue, setVenue] = useState<Venue>("anteatery");
    const [query, setQuery] = useState("");
    const [output, setOutput] = useState<Output | null>(null);
    const [searching, setSearching] = useState(false);
    const [welcome, setWelcome] = useState(false);
    const [voteTarget, setVoteTarget] = useState<{ song: QueueEntry, venue: Venue } | null>(null);

    const searchId = useRef(0);
    const lastQuery = useRef("");
    const queryInput = useRef<HTMLInputElement>(null);
    const isHome = output === null;

    const queue = useVenueQueue(venue, isHome);

    // Searching and voting need an approved account. Signed-out people sign in; signed-in people who aren't approved see the private beta screen
    const needsAccount = (next?: string) => {
        if (user?.approved) return false;
        goToLogin(next, !!user);
        return true;
    };

    const openVote: OpenVote = (song, songVenue) => {
        if (!needsAccount()) setVoteTarget({ song, venue: songVenue });
    };

    const search = useCallback(async (rawQuery: string, searchVenue: Venue) => {
        const text = rawQuery.trim();
        if (!text) return;

        // The query comes back with them after signing in
        if (!user?.approved) {
            goToLogin(`/?${new URLSearchParams({ q: text, venue: searchVenue })}`, !!user);
            return;
        }

        const id = ++searchId.current;
        const isCurrent = () => id === searchId.current;
        lastQuery.current = text;
        setSearching(true);
        setOutput({ kind: "loading" });

        try {
            // A pasted Spotify playlist link finds each of its tracks instead
            if (SPOTIFY_PLAYLIST_LINK.test(text)) await searchPlaylist(text, searchVenue, isCurrent, setOutput);
            else {
                const songs = await fetchOrThrow<Song[]>("/api/search", { q: text, venue: searchVenue }, "Search failed");
                // Ignore stale responses if another search started while this one was loading
                if (isCurrent()) setOutput({ kind: "results", songs, venue: searchVenue, notFound: [] });
            }
        } catch (error) {
            if (isCurrent()) setOutput({ kind: "message", text: (error as Error).message || "Something went wrong. Please try again." });
        } finally {
            if (isCurrent()) setSearching(false);
        }
    }, [user]);

    function goHome() {
        searchId.current++;
        lastQuery.current = "";
        setSearching(false);
        setQuery("");
        queryInput.current?.focus();
        if (isHome) queue.reload();
        else setOutput(null);
    }

    function changeVenue(next: Venue) {
        setVenue(next);
        // Searching again shows the results for the new venue; at home the queue follows the venue by itself
        if (!isHome && lastQuery.current) search(lastQuery.current, next);
    }

    // Once we know who's signed in: pick up a search someone started before signing in, and welcome people just let in
    const handledParams = useRef(false);

    useEffect(() => {
        if (user === undefined || handledParams.current) return;
        handledParams.current = true;

        const pendingQuery = params.get("q");
        const pendingVenue = params.get("venue");
        if (!pendingQuery && !params.has("welcome")) return;

        history.replaceState(null, "", "/");

        // Just let in by an invite link, magic link or code
        if (params.has("welcome") && user?.approved) {
            setWelcome(true);
            setTimeout(() => setWelcome(false), 5000);
        }

        if (pendingQuery) {
            const searchVenue = pendingVenue === "anteatery" || pendingVenue === "brandywine" ? pendingVenue : venue;
            setVenue(searchVenue);

            if (user) {
                setQuery(pendingQuery);
                search(pendingQuery, searchVenue);
            }
        }
    }, [user, params, search, venue]);

    return (
        <div className="page-home">
            <Navbar onHome={goHome} />

            <main className={cx(!isHome && "has-results")}>
                <section className="hero">
                    <h1>Pick the <span>soundtrack</span>.</h1>
                    <p>Zot your song into the queue.</p>
                </section>

                <form className="search" role="search" onSubmit={event => { event.preventDefault(); search(query, venue); }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input ref={queryInput} id="query" type="search" name="q" placeholder="Search songs, artists…" autoComplete="off" autoFocus aria-label="Search songs"
                        value={query} onChange={event => setQuery(event.target.value)} />
                    <button type="submit" id="search-btn" disabled={searching}>Search</button>
                </form>

                <div className="venues" role="radiogroup" aria-label="Venue">
                    {VENUES.map(([value, label]) => <Fragment key={value}>
                        <input type="radio" name="venue" id={`venue-${value}`} value={value} checked={venue === value} onChange={() => changeVenue(value)} />
                        <label htmlFor={`venue-${value}`}>{label}</label>
                    </Fragment>)}
                </div>

                <section className="recent" aria-labelledby="recent-title">
                    <h2 id="recent-title">Up next at {VENUE_LABELS[venue]}</h2>
                    <div id="recent-list" aria-live="polite">
                        {isHome && <QueueView state={queue.state} venue={venue} onVote={openVote} />}
                    </div>
                </section>

                <div id="output" aria-live="polite">
                    {output && <OutputView output={output} onVote={openVote} />}
                </div>
            </main>

            <VoteDialog target={voteTarget} admin={!!user?.admin} onClose={() => setVoteTarget(null)}
                // Show the new counts on the Up next screen
                onVoted={() => { if (isHome) queue.reload({ quiet: true }); }} />

            <footer>Made with ♪ by Anteaters</footer>

            {welcome && <div className="welcome-note" role="status">You&apos;re in! Welcome to Zotify.</div>}
        </div>
    );
}

/** Reads a Spotify playlist, then finds each track on Rockbot, showing progress as it goes */
async function searchPlaylist(link: string, venue: Venue, isCurrent: () => boolean, setOutput: (output: Output) => void) {
    const playlist = await fetchOrThrow<Playlist>("/api/spotify-playlist", { url: link }, "Couldn't read that playlist");
    if (!isCurrent()) return;

    const states: TrackState[] = playlist.tracks.map(() => "waiting");
    const matches: (Song | null)[] = playlist.tracks.map(() => null);
    let finished = 0;

    const show = () => { if (isCurrent()) setOutput({ kind: "playlist", playlist, states: [...states], finished }); };
    const setState = (i: number, state: TrackState) => { states[i] = state; show(); };
    show();

    // A failed search is retried once; if it fails again the track is marked failed and the rest carry on
    await runWithConcurrency(playlist.tracks, PLAYLIST_SEARCH_CONCURRENCY, async (track, i) => {
        setState(i, "searching");

        try {
            try {
                matches[i] = await fetchMatch(track, venue);
            } catch {
                setState(i, "retrying");
                matches[i] = await fetchMatch(track, venue);
            }

            states[i] = matches[i] ? "found" : "missing";
        } catch {
            states[i] = "failed";
        }

        finished++;
        show();
    }, () => !isCurrent());

    if (!isCurrent()) return;

    // Top match per track in playlist order, each song once; grouping then takes priority over this order
    const seen = new Set<string>();
    const songs: Song[] = [];
    const notFound: NotFound[] = [];

    playlist.tracks.forEach((track, i) => {
        const match = matches[i];
        if (!match) notFound.push({ ...track, failed: states[i] === "failed" });
        else if (!seen.has(match.id)) {
            seen.add(match.id);
            songs.push(match);
        }
    });

    setOutput({ kind: "results", songs, venue, notFound, playlist });
}

// Which group a search result belongs in. Queued songs are already waiting, so like cooldown songs they can't be queued again
function resultGroup(song: Song) {
    if (song.requestable === false) return song.availableAt ? "elsewhere" : "unavailable";
    if (song.status === "queued" && song.queuedByZotify === false) return "others";
    if (song.status === "queued" || song.status === "cooldown") return "cooldown";
    return "available";
}

function PlaylistHeading({ playlist }: { playlist: Playlist }) {
    const note = playlist.mayBeTruncated ? ` Spotify only shared the first ${playlist.tracks.length} tracks, so this playlist may have more.` : "";

    return (
        <div className="playlist-heading">
            <h2>{playlist.name}{playlist.owner ? ` by ${playlist.owner}` : ""}</h2>
            <p>{playlist.tracks.length} tracks.{note}</p>
        </div>
    );
}

const Message = ({ text }: { text: string }) => <p className="message">{text}</p>;
const Loading = () => <div className="message"><Spinner /></div>;

function OutputView({ output, onVote }: { output: Output, onVote: OpenVote }) {
    if (output.kind === "loading") return <Loading />;
    if (output.kind === "message") return <Message text={output.text} />;

    if (output.kind === "playlist") {
        const { playlist, states, finished } = output;
        return <>
            <PlaylistHeading playlist={playlist} />
            <p className="playlist-progress">Finding songs on Rockbot: {finished} of {playlist.tracks.length}</p>
            <ul className="results">{playlist.tracks.map((track, i) => <TrackRow key={i} track={track} state={states[i]} />)}</ul>
        </>;
    }

    const { songs, venue, notFound, playlist } = output;
    if (!songs.length && !notFound.length) return <Message text="No songs found. Try a different search." />;

    const groups: [string, React.ReactNode[]][] = [
        ["cooldown", "On cooldown"],
        ["others", "Requested by others"],
        ["available", "Available to play"],
        ["elsewhere", `Only available at ${VENUE_LABELS[otherVenue(venue)]}`],
        ["unavailable", "Unavailable anywhere"]
    ].map(([key, title]) => [title, songs.filter(song => resultGroup(song) === key).map(song =>
        <ResultRow key={song.id} song={song} venue={venue} onVote={onVote} />)] as [string, React.ReactNode[]]);

    groups.push(["Not found", notFound.map((track, i) => <TrackRow key={i} track={track} state={track.failed ? "failed" : "not-found"} />)]);

    return <>
        {playlist && <PlaylistHeading playlist={playlist} />}
        {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
            <QueueGroup key={title} title={`${title} (${rows.length})`}><ul className="results">{rows}</ul></QueueGroup>
        ))}
    </>;
}

type QueueState = { kind: "loading" } | { kind: "error", text: string } | { kind: "loaded", queue: VenueQueue };

/** The venue's queue: loaded when the venue changes or the homepage shows again, and refreshed every 20 seconds while visible */
function useVenueQueue(venue: Venue, active: boolean) {
    const [state, setState] = useState<QueueState>({ kind: "loading" });
    const loadId = useRef(0);

    const reload = useCallback(async ({ quiet = false } = {}) => {
        const id = ++loadId.current;
        if (!quiet) setState({ kind: "loading" });

        try {
            const queue = await fetchOrThrow<VenueQueue>("/api/venue-queue", { venue }, "Could not load the queue");
            // Ignore stale responses if the venue changed or another load started
            if (id === loadId.current) setState({ kind: "loaded", queue });
        } catch (error) {
            // Keep showing the last queue if a background refresh fails
            if (id === loadId.current && !quiet) setState({ kind: "error", text: (error as Error).message || "Could not load the queue" });
        }
    }, [venue]);

    useEffect(() => {
        if (!active) return;
        reload();

        const refresh = () => { if (!document.hidden) reload({ quiet: true }); };
        const timer = setInterval(refresh, QUEUE_REFRESH_MS);
        document.addEventListener("visibilitychange", refresh);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [active, reload]);

    return { state, reload };
}

function QueueView({ state, venue, onVote }: { state: QueueState, venue: Venue, onVote: OpenVote }) {
    if (state.kind === "loading") return <Loading />;
    if (state.kind === "error") return <Message text={state.text} />;

    const { nowPlaying, onDeck, comingUp } = state.queue;
    if (!nowPlaying && !onDeck.length && !comingUp.length) return <Message text={`Nothing is playing at ${VENUE_LABELS[venue]} right now.`} />;

    const key = (entry: QueueEntry, i: number) => entry.pickId ?? `${entry.id}-${i}`;

    return <>
        {nowPlaying && <QueueGroup title="Now playing"><ul className="results"><QueueRow entry={nowPlaying} venue={venue} onVote={onVote} nowPlaying /></ul></QueueGroup>}
        {onDeck.length > 0 && <QueueGroup title="On deck"><ul className="results">{onDeck.map((entry, i) => <QueueRow key={key(entry, i)} entry={entry} venue={venue} onVote={onVote} />)}</ul></QueueGroup>}
        {comingUp.length > 0 && <QueueGroup title="Coming up"><ul className="results">{comingUp.map((entry, i) => <QueueRow key={key(entry, i)} entry={entry} venue={venue} onVote={onVote} />)}</ul></QueueGroup>}
    </>;
}
