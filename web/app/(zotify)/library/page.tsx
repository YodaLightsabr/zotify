"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SaveButton from "@/components/SaveButton";
import { Busy, Spinner } from "@/components/Spinner";
import { postJson, type Venue } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useLibrary, type LibrarySong } from "@/lib/library";
import { useSchool } from "@/lib/school";
import { useVenue } from "@/lib/venue";

type Sort = "recent" | "played" | "requested" | "name" | "artist";

const SORTS: { id: Sort, label: string }[] = [
    { id: "recent", label: "Recently saved" },
    { id: "played", label: "Last played" },
    { id: "requested", label: "Most requested" },
    { id: "name", label: "Title" },
    { id: "artist", label: "Artist" }
];

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

function sorted(songs: LibrarySong[], sort: Sort) {
    const copy = [...songs];
    // Songs you've never requested go after the rest, newest saved first
    if (sort === "played") return copy.sort((a, b) => (b.lastRequestedAt ?? 0) - (a.lastRequestedAt ?? 0) || b.savedAt - a.savedAt);
    if (sort === "requested") return copy.sort((a, b) => b.requests - a.requests || (b.lastRequestedAt ?? 0) - (a.lastRequestedAt ?? 0) || b.savedAt - a.savedAt);
    if (sort === "name") return copy.sort((a, b) => byText(a.name, b.name));
    if (sort === "artist") return copy.sort((a, b) => byText(a.artist, b.artist) || byText(a.name, b.name));
    return copy.sort((a, b) => b.savedAt - a.savedAt);
}

const shortDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Your saved songs. Songs that can't be played at the venue are tucked away, since they can't be requested from here */
export default function LibrarySongsPage() {
    const { reload } = useLibrary();
    const school = useSchool();
    const [venue] = useVenue();
    const [songs, setSongs] = useState<LibrarySong[] | null>(null);
    const [error, setError] = useState("");
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<Sort>("recent");
    const [showUnavailable, setShowUnavailable] = useState(false);

    // Kept as loaded: songs taken out stay listed (with an empty heart) until the page is opened again, so it can be undone
    useEffect(() => {
        reload().then(setSongs).catch(error => setError((error as Error).message));
    }, [reload]);

    const { available, unavailable } = useMemo(() => {
        const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const matching = (songs ?? []).filter(song => words.every(word => `${song.name} ${song.artist}`.toLowerCase().includes(word)));
        const all = sorted(matching, sort);
        // Songs never checked at this venue are shown; requesting one finds out
        return { available: all.filter(song => song.availability[venue] !== false), unavailable: all.filter(song => song.availability[venue] === false) };
    }, [songs, filter, sort, venue]);

    if (error) return <p className="message error-text">{error}</p>;
    if (!songs) return <div className="message"><Spinner /></div>;

    if (!songs.length) {
        return (
            <p className="library-empty">
                Nothing saved yet. Songs you request are saved here, and so are songs you save with the heart on the <Link href="/">homepage</Link> and
                songs from playlists you save.
            </p>
        );
    }

    const venueName = school.venueName(venue);

    return <>
        <div className="library-toolbar">
            <input type="search" className="library-filter" placeholder={`Filter ${plural(songs.length, "song")}`} aria-label="Filter your songs"
                value={filter} onChange={event => setFilter(event.target.value)} />
            <select className="library-sort" aria-label="Sort by" value={sort} onChange={event => setSort(event.target.value as Sort)}>
                {SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
        </div>

        {available.length ? (
            <ul className="library-grid">{available.map(song => <LibraryCard key={`${song.id}-${venue}`} song={song} venue={venue} />)}</ul>
        ) : (
            <p className="library-empty">{filter ? "Nothing matches that." : `None of your songs can be played at ${venueName} right now.`}</p>
        )}

        {unavailable.length > 0 && (
            <section className="library-unavailable">
                <button type="button" className="library-reveal" aria-expanded={showUnavailable} onClick={() => setShowUnavailable(!showUnavailable)}>
                    {showUnavailable ? "Hide" : "Show"} {plural(unavailable.length, "song")} that can&apos;t be played at {venueName}
                </button>
                {showUnavailable && <ul className="library-grid">{unavailable.map(song => <LibraryCard key={`${song.id}-${venue}`} song={song} venue={venue} />)}</ul>}
            </section>
        )}
    </>;
}

/** Why a song is in your Library, and how much you've played it */
function details(song: LibrarySong) {
    const parts: React.ReactNode[] = [];
    if (song.requests) parts.push(`Requested ${song.requests === 1 ? "once" : `${song.requests} times`}`);
    if (song.source === "playlist" && song.playlist) parts.push(<>From <Link href={`/playlist/${song.playlist.id}`}>{song.playlist.name}</Link></>);
    else if (song.source === "saved") parts.push(`Saved ${shortDate(song.savedAt)}`);
    else if (song.source === "liked") parts.push("From your Spotify likes");
    else if (!song.requests) parts.push(`Requested ${shortDate(song.savedAt)}`);
    return parts.map((part, i) => <span key={i}>{i > 0 && " · "}{part}</span>);
}

/** A saved song as a card: its cover, why it's saved, and buttons to queue it or take it out */
function LibraryCard({ song, venue }: { song: LibrarySong, venue: Venue }) {
    const school = useSchool();
    const [button, setButton] = useState<{ label: string, disabled?: boolean, done?: boolean }>({ label: "Queue" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const unavailableHere = song.availability[venue] === false;
    const elsewhere = unavailableHere ? school.venues.find(other => other.id !== venue && song.availability[other.id]) : null;

    // Into Zotify's queue, like the homepage's Queue button
    async function queue() {
        setBusy(true);
        setError("");

        try {
            const { response, data } = await postJson(`/v1/venues/${venue}/requests`, {
                songId: song.id,
                song: { id: song.id, name: song.name, artist: song.artist, cover: song.cover }
            });

            if (response.status === 409) {
                setButton({ label: "Played recently", disabled: true });
                setError(data?.error ?? "");
                return;
            }

            if (!response.ok) throw new Error(data?.error ?? `Couldn't queue it (${response.status})`);
            setButton({ label: "Queued ✓", disabled: true, done: true });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className={cx("library-card", unavailableHere && "unavailable")}>
            <div className="library-art">
                {song.cover ? <img src={song.cover} alt="" loading="lazy" /> : <div className="library-no-art" aria-hidden="true">♪</div>}
                <SaveButton song={song} />
            </div>
            {/* The cover, blurred behind the card's text, like the glow on song rows */}
            {song.cover && <img className="library-glow" src={song.cover} alt="" loading="lazy" aria-hidden="true" />}
            <div className="library-card-body">
                <div className="library-name" title={song.name}>{song.name}</div>
                <div className="library-artist" title={song.artist}>{song.artist}</div>
                <div className="library-details">{details(song)}</div>
                {elsewhere && <span className="badge elsewhere" title={`Not requestable here, but you can request it at ${elsewhere.name}`}>At {elsewhere.name}</span>}
                {error && <div className="library-error" role="alert">{error}</div>}
            </div>
            <button type="button" className={cx("queue-btn", button.done && "done", busy && "busy")} disabled={busy || button.disabled || unavailableHere}
                title={unavailableHere ? `Can't be requested at ${school.venueName(venue)} right now` : `Queue it at ${school.venueName(venue)}`} onClick={queue}>
                {busy ? <Busy label="Queuing…" /> : unavailableHere ? "Unavailable" : button.label}
            </button>
        </li>
    );
}
