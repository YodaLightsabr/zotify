import { EventEmitter } from "node:events";
import type { VenueName } from "./accounts.js";
import type { PlaylistQueueJob } from "./playlistQueue.js";

interface Events {
    // Something changed a venue's queue on Rockbot (a vote, a boost, a song we requested), so it's worth fetching again soon
    venueChanged: [venue: VenueName];
    // Zotify's own queue at a venue changed: a song was added, released, retried or failed
    zotifyQueueChanged: [venue: VenueName];
    // A playlist's "queue all" job moved on
    playlistJobChanged: [job: PlaylistQueueJob];
}

/** Lets the modules that change things tell live.ts, which broadcasts to the pages watching, without importing it */
export const events = new EventEmitter<Events>();
