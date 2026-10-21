"use client";

import { Spinner } from "@/components/Spinner";
import type { Venue } from "@/lib/api";
import { listOf } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { QueueGroup } from "./SongParts";
import { ResultRow, TrackRow } from "./ResultRow";
import type { OpenVote, PlaylistTrack, Song } from "./types";

export type NotFound = PlaylistTrack & { failed: boolean };

export const Message = ({ text }: { text: string }) => <p className="message">{text}</p>;
export const Loading = () => <div className="message"><Spinner /></div>;

// Which group a search result belongs in. Queued songs are already waiting, so like cooldown songs they can't be queued again
export function resultGroup(song: Song) {
    if (song.requestable === false) return song.availableAt ? "elsewhere" : "unavailable";
    if (song.status === "queued" && song.queuedByZotify === false) return "others";
    if (song.status === "queued" || song.status === "cooldown") return "cooldown";
    return "available";
}

/** Songs grouped by whether they can be queued, used for searches and playlists. notFound lists playlist tracks Rockbot doesn't have */
export function SongResults({ songs, venue, notFound = [], onVote }: { songs: Song[], venue: Venue, notFound?: NotFound[], onVote: OpenVote }) {
    const school = useSchool();
    if (!songs.length && !notFound.length) return <Message text="No songs found. Try a different search." />;

    // The school's other venues, which songs that can't be played here might be at
    const others = school.venues.filter(other => other.id !== venue).map(other => other.name);

    const groups: [string, React.ReactNode[]][] = [
        ["cooldown", "On cooldown"],
        ["others", "Requested by others"],
        ["available", "Available to play"],
        ["elsewhere", `Only available at ${listOf(others)}`],
        ["unavailable", "Unavailable anywhere"]
    ].map(([key, title]) => [title, songs.filter(song => resultGroup(song) === key).map(song =>
        <ResultRow key={song.id} song={song} venue={venue} onVote={onVote} />)] as [string, React.ReactNode[]]);

    groups.push(["Not found", notFound.map((track, i) => <TrackRow key={i} track={track} state={track.failed ? "failed" : "not-found"} />)]);

    return <>
        {groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
            <QueueGroup key={title} title={`${title} (${rows.length})`}><ul className="results">{rows}</ul></QueueGroup>
        ))}
    </>;
}
