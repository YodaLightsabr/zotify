"use client";

import { useEffect, useMemo, useState } from "react";
import type { Venue } from "@/lib/api";
import { cx, formatTime, plural, timeAgo } from "@/lib/format";
import type { OpenVote, QueueEntry, Song } from "./types";

const coverOf = (song: Partial<Song>) => song.cover ?? song.album?.cover?.src;

export function SongCover({ song }: { song: Partial<Song> }) {
    const src = coverOf(song);
    return src ? <img className="cover" src={src} alt="" loading="lazy" /> : <div className="cover">♪</div>;
}

export function SongBackdrop({ song }: { song: Partial<Song> }) {
    const src = coverOf(song);
    return src ? <img className="cover-backdrop" src={src} alt="" loading="lazy" /> : <div className="cover-backdrop" />;
}

// Songs in the queue have a pick, and clicking their cover opens the vote popup
export function VotableCover({ song, venue, onVote }: { song: QueueEntry, venue: Venue, onVote: OpenVote }) {
    if (!song.pickId) return <SongCover song={song} />;

    return (
        <button className="cover-button" type="button" title="Add votes" aria-label={`Add votes for ${song.name}`} onClick={() => onVote(song, venue)}>
            <SongCover song={song} />
        </button>
    );
}

export function QueuedBadge({ queuedAt }: { queuedAt?: number }) {
    return <span className="badge" title={queuedAt ? `Queued with Zotify ${timeAgo(queuedAt)}` : "In the queue"}>Queued</span>;
}

export function CooldownBadge({ song }: { song: Song }) {
    // Whichever Zotify did most recently: queued it, or boosted someone else's request
    const boosted = song.boostedAt && (!song.queuedAt || song.boostedAt > song.queuedAt);
    const title = boosted
        ? `Boosted with Zotify ${timeAgo(song.boostedAt!)} and already played`
        : `Queued with Zotify ${timeAgo(song.queuedAt ?? Date.now())} and already played`;

    return <span className="badge cooldown" title={title}>Cooldown</span>;
}

function VoteWidget({ upvotes, downvotes }: { upvotes: number, downvotes: number }) {
    const label = `${plural(upvotes, "upvote")}, ${plural(downvotes, "downvote")}`;

    return (
        <div className="votes" title={label} aria-label={label} role="img">
            <span className={cx("vote up", upvotes > 0 && "active")}>▲ {upvotes}</span>
            <span className={cx("vote down", downvotes > 0 && "active")}>▼ {downvotes}</span>
        </div>
    );
}

/** A song in the venue queue, with its votes. The song playing now also gets a progress bar */
export function QueueRow({ entry, venue, onVote, nowPlaying = false }: { entry: QueueEntry, venue: Venue, onVote: OpenVote, nowPlaying?: boolean }) {
    return (
        <li className={cx("song", nowPlaying && "now-playing", entry.zotify && "zotify")}>
            <VotableCover song={entry} venue={venue} onVote={onVote} />
            <SongBackdrop song={entry} />
            <div className="meta">
                <div className="title-row">
                    <div className="name">{entry.name || "Unknown song"}</div>
                    {entry.zotify && <span className="badge" title="Queued with Zotify">Zotify</span>}
                </div>
                <div className="artist">{entry.artist}</div>
            </div>
            {/* Votes can be missing if Rockbot didn't return them for this song */}
            {entry.upvotes !== undefined && entry.downvotes !== undefined && <VoteWidget upvotes={entry.upvotes} downvotes={entry.downvotes} />}
            {nowPlaying && entry.duration && entry.secondsRemaining !== undefined && <Progress duration={entry.duration} secondsRemaining={entry.secondsRemaining} />}
        </li>
    );
}

function Progress({ duration, secondsRemaining }: { duration: number, secondsRemaining: number }) {
    const [now, setNow] = useState(() => Date.now());
    // Counted from when this reading arrived; each queue refresh brings a new one
    const endsAt = useMemo(() => Date.now() + secondsRemaining * 1000, [secondsRemaining, duration]);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const remaining = Math.max(0, (endsAt - now) / 1000);

    return (
        <div className="progress-row">
            <span>{formatTime(duration - remaining)}</span>
            <div className="progress" role="progressbar" aria-label="Song progress">
                <div className="progress-fill" style={{ width: `${((duration - remaining) / duration) * 100}%` }} />
            </div>
            <span>-{formatTime(remaining)}</span>
        </div>
    );
}

/** A titled section of the queue. action goes beside the title, e.g. the Zotify queue's Clear button */
export function QueueGroup({ title, action, children }: { title: string, action?: React.ReactNode, children: React.ReactNode }) {
    return (
        <div className="queue-group">
            {action ? <div className="queue-group-heading"><h3>{title}</h3>{action}</div> : <h3>{title}</h3>}
            {children}
        </div>
    );
}
