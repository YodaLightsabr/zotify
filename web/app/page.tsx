"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { QueueGroup, QueueRow } from "@/components/home/SongParts";
import { Loading, Message, SongResults } from "@/components/home/Results";
import type { OpenVote, QueueEntry, Song } from "@/components/home/types";
import VoteDialog from "@/components/home/VoteDialog";
import { FailuresButton, FailuresDialog, WaitingRow, type ZotifyQueue } from "@/components/home/ZotifyQueue";
import { fetchOrThrow, goToLogin, postJson, type Venue } from "@/lib/api";
import { cx, VENUE_LABELS, VENUES } from "@/lib/format";
import { useLiveVenue, useLiveZotifyQueue, type LiveVenue } from "@/lib/live";
import { useHomeReset } from "@/lib/navigation";
import { useUser } from "@/lib/user";
import "./home.css";

const SPOTIFY_PLAYLIST_LINK = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/[A-Za-z0-9]{22}|spotify:playlist:[A-Za-z0-9]{22}/i;

// What's shown under the search box after searching
type Output =
    | { kind: "loading" }
    | { kind: "message", text: string }
    | { kind: "results", songs: Song[], venue: Venue };

export default function HomePage() {
    return <Suspense><Home /></Suspense>;
}

function Home() {
    const { user } = useUser();
    const params = useSearchParams();
    const router = useRouter();

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

    // Live while the homepage shows the queue; the server pushes every change
    const live = useLiveVenue(venue, isHome);
    const zotify = useLiveZotifyQueue(venue);
    const [showFailures, setShowFailures] = useState(false);
    const failures = zotify?.failures ?? [];

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
            // A pasted Spotify playlist link is saved on the server, which says where its page is
            if (SPOTIFY_PLAYLIST_LINK.test(text)) {
                const { response, data } = await postJson("/api/playlists", { url: text });
                if (!response.ok) throw new Error(data?.error ?? `Couldn't read that playlist (${response.status})`);
                if (isCurrent()) router.push(`${data.redirect}?${new URLSearchParams({ venue: searchVenue })}`);
                return;
            }

            const songs = await fetchOrThrow<Song[]>("/api/search", { q: text, venue: searchVenue }, "Search failed");
            // Ignore stale responses if another search started while this one was loading
            if (isCurrent()) setOutput({ kind: "results", songs, venue: searchVenue });
        } catch (error) {
            if (isCurrent()) setOutput({ kind: "message", text: (error as Error).message || "Something went wrong. Please try again." });
        } finally {
            if (isCurrent()) setSearching(false);
        }
    }, [user, router]);

    function goHome() {
        searchId.current++;
        lastQuery.current = "";
        setSearching(false);
        setQuery("");
        queryInput.current?.focus();
        setOutput(null);
    }

    useHomeReset(goHome);

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
                    <div className="recent-heading">
                        <h2 id="recent-title">Up next at {VENUE_LABELS[venue]}</h2>
                        {failures.length > 0 && <FailuresButton count={failures.length} onClick={() => setShowFailures(true)} />}
                    </div>
                    <div id="recent-list" aria-live="polite">
                        {isHome && <QueueView live={live} zotify={zotify} venue={venue} onVote={openVote} />}
                    </div>
                </section>

                <div id="output" aria-live="polite">
                    {output && <OutputView output={output} onVote={openVote} />}
                </div>
            </main>

            <VoteDialog target={voteTarget} admin={!!user?.admin} onClose={() => setVoteTarget(null)}
                // Show the new counts on the Up next screen
                // The server sends the new counts to everyone watching
                onVoted={() => {}} />

            <FailuresDialog failures={failures} venue={venue} open={showFailures} onClose={() => setShowFailures(false)} />

            <footer>Made with ♪ by Anteaters</footer>

            {welcome && <div className="welcome-note" role="status">You&apos;re in! Welcome to Zotify.</div>}
        </div>
    );
}

function OutputView({ output, onVote }: { output: Output, onVote: OpenVote }) {
    if (output.kind === "loading") return <Loading />;
    if (output.kind === "message") return <Message text={output.text} />;

    return <SongResults songs={output.songs} venue={output.venue} onVote={onVote} />;
}

/** The venue's queue, with Zotify's own between On deck and Coming up for members */
function QueueView({ live, zotify, venue, onVote }: { live: LiveVenue | undefined, zotify: ZotifyQueue | undefined, venue: Venue, onVote: OpenVote }) {
    if (!live) return <Loading />;
    if (!live.queue) return <Message text={live.error ?? "Could not load the queue."} />;

    const { nowPlaying, onDeck, comingUp } = live.queue;
    // Songs waiting in Zotify's queue for room in the venue's
    const waiting = zotify?.waiting ?? [];
    if (!nowPlaying && !onDeck.length && !comingUp.length && !waiting.length) return <Message text={`Nothing is playing at ${VENUE_LABELS[venue]} right now.`} />;

    const key = (entry: QueueEntry, i: number) => entry.pickId ?? `${entry.id}-${i}`;

    return <>
        {nowPlaying && <QueueGroup title="Now playing"><ul className="results"><QueueRow entry={nowPlaying} venue={venue} onVote={onVote} nowPlaying /></ul></QueueGroup>}
        {onDeck.length > 0 && <QueueGroup title="On deck"><ul className="results">{onDeck.map((entry, i) => <QueueRow key={key(entry, i)} entry={entry} venue={venue} onVote={onVote} />)}</ul></QueueGroup>}
        {waiting.length > 0 && <QueueGroup title="Zotify queue"><ul className="results">{waiting.map(song => <WaitingRow key={song.id} song={song} />)}</ul></QueueGroup>}
        {comingUp.length > 0 && <QueueGroup title="Coming up"><ul className="results">{comingUp.map((entry, i) => <QueueRow key={key(entry, i)} entry={entry} venue={venue} onVote={onVote} />)}</ul></QueueGroup>}
    </>;
}
