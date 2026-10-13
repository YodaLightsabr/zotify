import type { VenueName } from "./accounts.js";
import { searchSongs } from "./songSearch.js";

export interface Track {
    title: string;
    artist: string;
}

type SearchResult = Awaited<ReturnType<typeof searchSongs>>["songs"][number];

/** Whether one text contains the other, either way round, ignoring case */
export function overlaps(a: string | undefined, b: string | undefined) {
    const [x, y] = [(a ?? "").trim().toLowerCase(), (b ?? "").trim().toLowerCase()];
    return !!x && !!y && (x.includes(y) || y.includes(x));
}

/** The first result whose title and artist both overlap the track's. Anything looser counts as not found */
export function bestMatch(track: Track, songs: SearchResult[]) {
    return songs.find(song => overlaps(song.name, track.title) && overlaps(song.artist, track.artist)) ?? null;
}

/**
 * Finds a track on Rockbot by searching "title artist". If that misses but turns up other songs by the artist,
 * searches the artist alone too, since Rockbot sometimes leaves less popular songs out of title searches.
 * Search errors are thrown, so callers can tell a failure apart from "not found".
 */
export async function findTrack(venue: VenueName, track: Track) {
    const { songs } = await searchSongs(venue, `${track.title} ${track.artist}`);
    const match = bestMatch(track, songs);

    if (match) return { match, searchedArtist: false };
    if (!songs.some(song => overlaps(song.artist, track.artist))) return { match: null, searchedArtist: false };

    const { songs: artistSongs } = await searchSongs(venue, track.artist);
    return { match: bestMatch(track, artistSongs), searchedArtist: true };
}
