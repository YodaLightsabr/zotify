"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SongBackdrop, SongCover } from "@/components/home/SongParts";
import { useLibraryView } from "@/components/library/LibraryFrame";
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

type Grouping = "artist" | "source" | "none";

const GROUPINGS: { id: Grouping, label: string }[] = [
    { id: "artist", label: "By artist" },
    { id: "source", label: "By where it's from" },
    { id: "none", label: "No groups" }
];

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * The artist a song is shelved under: the first one credited ("Stevie Wonder and Dionne Warwick", "Stevie Wonder feat. Ray
 * Charles") when that artist has songs of their own in the Library, and otherwise the whole credit, so bands like "Earth,
 * Wind & Fire" stay whole
 */
function shelfArtist(artist: string, known: Set<string>) {
    const first = artist.split(/,\s*|\s+(?:&|and|x|feat\.?|ft\.?|featuring|with)\s+/i)[0].trim();
    return first && first !== artist && known.has(first.toLowerCase()) ? first : artist;
}

/** Which group a song goes in, by its key and heading. known is every artist with songs in the Library, lowercased */
function groupOf(song: LibrarySong, grouping: Grouping, known: Set<string>): [string, string] {
    if (grouping === "artist") {
        const artist = shelfArtist(song.artist, known);
        return [artist.toLowerCase(), artist];
    }

    if (song.source === "playlist" && song.playlist) return [`playlist:${song.playlist.id}`, song.playlist.name];
    if (song.source === "liked") return ["liked", "Spotify likes"];
    if (song.source === "saved") return ["saved", "Saved by you"];
    return ["requested", "Requested"];
}

interface Group { key: string, title: string, songs: LibrarySong[] }

/**
 * Sorted songs in groups. Groups come in the order of their first song, so "Recently saved" puts the artist you saved most
 * recently first, except when sorting by title or artist, where groups go A to Z
 */
function grouped(songs: LibrarySong[], grouping: Grouping, sort: Sort): Group[] {
    const groups = new Map<string, Group>();
    const known = new Set(songs.map(song => song.artist.toLowerCase()));

    for (const song of songs) {
        const [key, title] = groupOf(song, grouping, known);
        if (!groups.has(key)) groups.set(key, { key, title, songs: [] });
        groups.get(key)!.songs.push(song);
    }

    const list = [...groups.values()];
    return sort === "name" || sort === "artist" ? list.sort((a, b) => byText(a.title, b.title)) : list;
}

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
    const [grouping, setGrouping] = useState<Grouping>("artist");
    const [showUnavailable, setShowUnavailable] = useState(false);
    const view = useLibraryView();

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
    const cards = (items: LibrarySong[]) => items.map(song => <LibraryCard key={`${song.id}-${venue}`} song={song} venue={venue} />);
    const rows = (items: LibrarySong[]) => <ul className="results library-list">{items.map(song => <LibraryRow key={`${song.id}-${venue}`} song={song} venue={venue} />)}</ul>;

    // Ungrouped, the grid wraps; grouped, each group is a shelf that scrolls sideways
    const list = (items: LibrarySong[]) => {
        if (grouping === "none") return view === "grid" ? <ul className="library-grid">{cards(items)}</ul> : rows(items);

        return grouped(items, grouping, sort).map(group => view === "grid"
            ? <Shelf key={group.key} title={group.title} count={group.songs.length}>{cards(group.songs)}</Shelf>
            : (
                <section className="library-group" key={group.key}>
                    <h3 className="library-group-title">{group.title} <span>{group.songs.length}</span></h3>
                    {rows(group.songs)}
                </section>
            ));
    };

    return <>
        <div className="library-toolbar">
            <input type="search" className="library-filter" placeholder={`Filter ${plural(songs.length, "song")}`} aria-label="Filter your songs"
                value={filter} onChange={event => setFilter(event.target.value)} />
            <select className="library-sort" aria-label="Group" value={grouping} onChange={event => setGrouping(event.target.value as Grouping)}>
                {GROUPINGS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <select className="library-sort" aria-label="Sort by" value={sort} onChange={event => setSort(event.target.value as Sort)}>
                {SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
        </div>

        {available.length ? (
            list(available)
        ) : (
            <p className="library-empty">{filter ? "Nothing matches that." : `None of your songs can be played at ${venueName} right now.`}</p>
        )}

        {unavailable.length > 0 && (
            <section className="library-unavailable">
                <button type="button" className="library-reveal" aria-expanded={showUnavailable} onClick={() => setShowUnavailable(!showUnavailable)}>
                    {showUnavailable ? "Hide" : "Show"} {plural(unavailable.length, "song")} that can&apos;t be played at {venueName}
                </button>
                {showUnavailable && list(unavailable)}
            </section>
        )}
    </>;
}

/** A group of cards in a row that scrolls sideways, with arrows on wide screens, like a streaming service's shelves */
function Shelf({ title, count, children }: { title: string, count: number, children: React.ReactNode }) {
    const track = useRef<HTMLUListElement>(null);
    const [edges, setEdges] = useState({ start: true, end: true });

    // Which way there's more to scroll, as it scrolls and as the window resizes
    useEffect(() => {
        const element = track.current;
        if (!element) return;

        const update = () => setEdges({
            start: element.scrollLeft <= 2,
            end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2
        });

        update();
        element.addEventListener("scroll", update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(element);

        return () => {
            element.removeEventListener("scroll", update);
            observer.disconnect();
        };
    }, [count]);

    const scroll = (direction: 1 | -1) => track.current?.scrollBy({ left: direction * track.current.clientWidth * 0.85, behavior: "smooth" });
    const arrow = (path: string) => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
    );

    return (
        <section className="library-shelf" aria-label={title}>
            <div className="library-shelf-head">
                <h3 className="library-group-title">{title} <span>{count}</span></h3>
                {!(edges.start && edges.end) && (
                    <div className="library-shelf-arrows">
                        <button type="button" className="row-icon" aria-label={`Scroll ${title} back`} disabled={edges.start} onClick={() => scroll(-1)}>{arrow("m15 18-6-6 6-6")}</button>
                        <button type="button" className="row-icon" aria-label={`Scroll ${title} on`} disabled={edges.end} onClick={() => scroll(1)}>{arrow("m9 18 6-6-6-6")}</button>
                    </div>
                )}
            </div>
            <ul className="library-shelf-track" ref={track}>{children}</ul>
        </section>
    );
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

/** Queuing a saved song at the venue, and whether it can be, for both views */
function useQueue(song: LibrarySong, venue: Venue) {
    const school = useSchool();
    const [button, setButton] = useState<{ label: string, disabled?: boolean, done?: boolean }>({ label: "Queue" });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const unavailableHere = song.availability[venue] === false;
    const elsewhere = unavailableHere ? school.venues.find(other => other.id !== venue && song.availability[other.id]) ?? null : null;

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

    const queueButton = (
        <button type="button" className={cx("queue-btn", button.done && "done", busy && "busy")} disabled={busy || button.disabled || unavailableHere}
            title={unavailableHere ? `Can't be requested at ${school.venueName(venue)} right now` : `Queue it at ${school.venueName(venue)}`} onClick={queue}>
            {busy ? <Busy label="Queuing…" /> : unavailableHere ? "Unavailable" : button.label}
        </button>
    );

    return { queueButton, error, unavailableHere, elsewhere };
}

const ElsewhereBadge = ({ venue, short }: { venue: { name: string }, short?: boolean }) => (
    <span className="badge elsewhere" title={`Not requestable here, but you can request it at ${venue.name}`}>{short ? "At" : "Available at"} {venue.name}</span>
);

/** A saved song as a row, like a search result */
function LibraryRow({ song, venue }: { song: LibrarySong, venue: Venue }) {
    const { queueButton, error, unavailableHere, elsewhere } = useQueue(song, venue);

    return (
        <li className={cx("song", unavailableHere && "unavailable")}>
            <SongCover song={song} />
            <SongBackdrop song={song} />
            <div className="meta">
                <div className="title-row">
                    <div className="name">{song.name}</div>
                    {elsewhere && <ElsewhereBadge venue={elsewhere} />}
                </div>
                <div className="artist">{song.artist}</div>
                <div className="library-details">{details(song)}</div>
                {error && <div className="error" role="alert">{error}</div>}
            </div>
            <SaveButton song={song} />
            {queueButton}
        </li>
    );
}

/** A saved song as a card: its cover, why it's saved, and buttons to queue it or take it out */
function LibraryCard({ song, venue }: { song: LibrarySong, venue: Venue }) {
    const { queueButton, error, unavailableHere, elsewhere } = useQueue(song, venue);

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
                {elsewhere && <ElsewhereBadge venue={elsewhere} short />}
                {error && <div className="library-error" role="alert">{error}</div>}
            </div>
            {queueButton}
        </li>
    );
}
