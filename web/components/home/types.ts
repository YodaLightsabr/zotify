import type { Venue } from "@/lib/api";

/** A Rockbot song, from a search or the venue queue */
export interface Song {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    album?: { cover?: { src?: string } };
    requestable?: boolean;
    // Where it can be requested instead, when it can't be here
    availableAt?: Venue;
    status?: "queued" | "cooldown" | string;
    // Songs in the queue have a pick, which can be voted on
    pickId?: string;
    queuedByZotify?: boolean;
    queuedAt?: number;
    boostedAt?: number;
}

/** A song in the venue queue */
export interface QueueEntry extends Song {
    zotify?: boolean;
    upvotes?: number;
    downvotes?: number;
    duration?: number;
    secondsRemaining?: number;
}

export interface VenueQueue {
    nowPlaying: QueueEntry | null;
    onDeck: QueueEntry[];
    comingUp: QueueEntry[];
}

export interface PlaylistTrack { title: string, artist: string }

export interface Playlist {
    name: string;
    owner?: string;
    mayBeTruncated?: boolean;
    tracks: PlaylistTrack[];
}

/** Opens the vote popup for a song in the queue */
export type OpenVote = (song: QueueEntry, venue: Venue) => void;
