import { filterLeafBlocks, findLeafBlock } from "./block.js";
import { Block } from "./block.js"

export class RockbotClient {
    token?: string;
    refreshToken: string;
    key: string;
    debug: boolean;

    static BRANDYWINE = "162286";
    static ANTEATERY = "162285";

    static Errors = class {
        static PickLimitReachedError = class PickLimitReachedError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "PickLimitReachedError";
            }
        }

        static RepeatLimitReachedError = class RepeatLimitReachedError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "RepeatLimitReachedError";
            }
        }

        static SongQueueError = class SongQueueError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "SongQueueError";
            }
        }

        // Rockbot won't let anyone check in right now, e.g. outside the venue's hours
        static VenueUnavailableError = class VenueUnavailableError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "VenueUnavailableError";
            }
        }

        static AuthorizationError = class AuthorizationError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "AuthorizationError";
            }
        }
    }

    constructor ({ token, refreshToken, key, debug }: { token?: string, refreshToken: string, key: string, debug?: boolean }) {
        this.token = token;
        this.refreshToken = refreshToken;
        this.key = key;
        this.debug = !!debug;
    }

    /** A venue on Rockbot by its ID, like 162285 for UCI's Anteatery. Zotify's venues are in the database (see schools.ts) */
    venue (id: string, name?: string) {
        return new Venue(this, id, { name });
    }

    async account () {
        const response = await this.fetch("/account");

        return response;
    }
    
    async fetch(url: string, options?: RequestInit & { headers?: Record<string, string> }, retry: boolean = true): Promise<any> {
        if (!this.token) await this.refresh();
        if (!this.token) throw new RockbotClient.Errors.AuthorizationError("No token provided");
        if (!options) options = {};
        if (!options.headers) options.headers = {};
        options.headers = {
            "Accept": "*/*",
            "auth-token": this.token,
            "User-Agent": "Rockbot DJ/3.6.5 (com.roqbot.clientapp; build:176; iOS 27.0.0) Alamofire/4.9.1",
            "app-version": "3.6.5",
            "lindyn-version": 12,
            "device-id": "37AEF048-281B-4991-BEB0-8036EF7BFB03",
            "lindyn-width": 402,
            "Accept-Encoding": "gzip;q=1.0, compress;q=0.5",
            "Accept-Language": "en-US;q=1.0",
            "lindyn-height": 776,
            "app": "dj",
            "platform": "ios",
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "build": "176",
            ...options.headers
        } as any;
        const fullUrl = `https://api.rockbot.com/v4${url}`;
        // Rockbot's responses are loosely shaped JSON
        const json: any = await fetch(fullUrl, options).then(res => res.json());
        if (this.debug) console.log({ fullUrl, json });
        if (json?.error) {
            if (json.error?.status_code == 401 && json.error?.description?.includes("token")) {
                if (retry) {
                    await this.refresh();
                    options.headers!["auth-token"] = this.token;
                    return await this.fetch(url, options, false);
                } else {
                    throw new RockbotClient.Errors.AuthorizationError("Invalid or expired token");
                }
            }
        }
        return json;
    }
    
    #refreshing?: Promise<void>;

    /** Gets a new token. Concurrent callers share one request, since clients are reused across requests */
    async refresh () {
        this.#refreshing ??= this.#refresh().finally(() => { this.#refreshing = undefined; });
        return await this.#refreshing;
    }

    async #refresh () {
        const params = new URLSearchParams({
            key: this.key,
        });
        const response = await fetch("https://securetoken.googleapis.com/v1/token?" + params.toString(), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "accept": "*/*",
                "x-client-version": "iOS/FirebaseSDK/10.16.0/FirebaseCore-iOS",
                "x-ios-bundle-identifier": "com.roqbot.clientapp",
                "priority": "u=3, i",
                "accept-encoding": "gzip, deflate, br",
                "accept-language": "en",
                "user-agent": "FirebaseAuth.iOS/10.16.0 com.roqbot.clientapp/3.6.5 iPhone/27.0 hw/iPhone18_3",
                "x-firebase-gmpid": "1:1090758170403:ios:10f033fa7ecc17c1"
            },
            body: JSON.stringify({
                grantType: "refresh_token",
                refreshToken: this.refreshToken
            }),
            signal: AbortSignal.timeout(10_000)
        }).then(res => res.json() as Promise<any>);

        if (!response?.access_token) {
            throw new RockbotClient.Errors.AuthorizationError(`Could not refresh token: ${response?.error?.message ?? "no token returned"}`);
        }

        this.token = response.access_token;
    }
}

/** Throws unless Rockbot returned a real screen. Valid responses, even empty ones, always have a lindyn block */
function assertScreen(response: any, action: string) {
    if (response?.error || !response?.lindyn) {
        const reason = response?.error?.message ?? (response?.error ? JSON.stringify(response.error) : "no screen in response");
        throw new Error(`Rockbot couldn't ${action}: ${reason}`);
    }
}

/** Album and artist image IDs among a block's images. Anything else, like the requester's avatar, is ignored */
function imageIds(...images: any[]) {
    const idFor = (key: string) => {
        const id = images.find((image) => image?.url_fix?.key === key)?.url_fix?.id;
        return id !== undefined && id !== null && id !== "" ? String(id) : undefined;
    };

    return { albumId: idFor("albums"), artistId: idFor("artists") };
}

/** The album cover if there is one, otherwise the artist's photo, otherwise nothing. Album and artist IDs only work with their own URLs */
function coverUrl(client: RockbotClient, { albumId, artistId }: { albumId?: string, artistId?: string }) {
    if (albumId) return new Album(client, albumId).cover.src;
    if (artistId) return new Artist(client, artistId).cover.src;
    return undefined;
}

// A pick's cover never changes, so remember covers looked up from pick details by pick ID (null means it has none)
const pickCovers = new Map<string, string | null>();

export class Venue {
    client: RockbotClient;
    id: string;
    name?: string;

    constructor(client: RockbotClient, id: string, { name }: { name?: string }) {
        this.client = client;
        this.id = id;
        this.name = name;
    }

    async checkIn () {
        const response = await this.client.fetch("/venue/dj/checkin", {
            method: "POST",
            body: new URLSearchParams({
                venue_id: this.id
            })
        });

        // Rockbot's own words for a venue that's closed to check-ins, e.g. "This venue is not currently available for checkin"
        if (/not currently available/i.test(response?.error?.user_message ?? "")) {
            throw new RockbotClient.Errors.VenueUnavailableError(`${this.name ?? this.id} isn't available for check-in right now`);
        }

        assertScreen(response, `check in to ${this.name ?? this.id}`);
        return response;
    }

    async search ({ query }: { query: string }) {
        const params = new URLSearchParams({ query, venue_id: this.id }).toString();
        const response = await this.client.fetch("/search/dj/pick_music?" + params);

        // Without this, an error response would look like a search with no results
        assertScreen(response, `search for "${query}"`);

        const blocks = filterLeafBlocks(response, (block) => block.action?.path === "/v4/dj/song/details");
        // Songs after this heading can't be requested here. When every result can be, Rockbot leaves the heading out
        const delimiterIndex = findLeafBlock(response, (block) => block.txt1?.text === "UNAVAILABLE AT THIS VENUE")?.getIndex?.();
        const songs = blocks.map((block) => Song.fromSearchBlock(this.client, block, delimiterIndex));

        return songs;
    }

    async fetchQueue (): Promise<VenueQueue> {
        const response = await this.client.fetch("/dj/home", {
            method: "POST",
            body: new URLSearchParams({
                venue_id: this.id
            })
        });

        // Rockbot returns a "Check In" screen instead of the queue when the account isn't checked in here
        if (response?.venue_id === -1) {
            throw new Error(`Account is not checked in to ${this.name ?? this.id}`);
        }

        const toEntry = (block: Block): QueueEntry => {
            const songId = block.btn2?.action?.params?.song_id;
            // Picks someone requested often only carry their avatar here; those covers are filled in from pick details below
            const cover = coverUrl(this.client, imageIds(block.img1, block.img2));

            return {
                pickId: String(block.attributes?.pick_id ?? block.action?.params?.pick_id ?? block.id),
                songId: songId !== undefined ? String(songId) : undefined,
                name: block.txt1?.text ?? "",
                artist: block.txt2?.text ?? "",
                cover
            };
        };

        const nowPlayingBlock = findLeafBlock(response, (block) => block.type === "pick" && block.layout === "pick_now_playing");
        let nowPlaying: NowPlaying | null = null;

        if (nowPlayingBlock) {
            nowPlaying = toEntry(nowPlayingBlock);
            const progress = findLeafBlock(response, (block) => block.type === "progress" && String(block.attributes?.pick_id) === nowPlaying!.pickId);
            nowPlaying.duration = progress?.attributes?.duration;
            nowPlaying.secondsRemaining = progress?.attributes?.seconds_remaining;
        }

        // On deck picks are cards nested inside the on_deck block; coming up picks are plain pick rows
        const onDeck = filterLeafBlocks(response, (block) => block.layout === "card_i1i2b1b2t1t2" && block.action?.path === "/v4/pick/details").map(toEntry);
        const comingUp = filterLeafBlocks(response, (block) => block.type === "pick" && !block.layout).map(toEntry);

        // Now playing and coming up picks are followed by an interactions block listing their votes; no block means no votes
        const interactions = filterLeafBlocks(response, (block) => block.type === "interactions");
        for (const entry of [...(nowPlaying ? [nowPlaying] : []), ...comingUp]) {
            const votes = interactions.find((block) => String(block.action?.params?.pick_id ?? block.id) === entry.pickId)?.attributes;
            entry.upvotes = votes?.upvotes?.length ?? 0;
            entry.downvotes = votes?.downvotes?.length ?? 0;
        }

        // On deck cards don't come with votes, and picks without art here need their cover, so look those up individually
        const needsDetails = (entry: QueueEntry) => onDeck.includes(entry) || (!entry.cover && !pickCovers.has(entry.pickId));

        await Promise.all([...(nowPlaying ? [nowPlaying] : []), ...onDeck, ...comingUp].map(async (entry) => {
            if (needsDetails(entry)) {
                const details = await this.fetchPickDetails(entry.pickId).catch(() => null);

                if (details) pickCovers.set(entry.pickId, details.cover ?? null);
                if (onDeck.includes(entry)) {
                    entry.upvotes = details?.upvotes;
                    entry.downvotes = details?.downvotes;
                }
            }

            entry.cover ??= pickCovers.get(entry.pickId) ?? undefined;
        }));

        // Keep the remembered covers from growing forever
        if (pickCovers.size > 1000) pickCovers.clear();

        return { nowPlaying, onDeck, comingUp };
    }

    /** Counts a pick's votes from its details screen, which lists each vote with a thumbs up or down icon */
    /** A pick's votes, from its details screen */
    async fetchPickVotes (pickId: string) {
        const { upvotes, downvotes, upvoters, downvoters } = await this.fetchPickDetails(pickId);
        return { upvotes, downvotes, upvoters, downvoters };
    }

    /** A pick's details screen: who voted which way, and the song's cover */
    async fetchPickDetails (pickId: string) {
        const response = await this.client.fetch(`/pick/details?${new URLSearchParams({ pick_id: pickId })}`);
        assertScreen(response, `load pick ${pickId}`);

        const expanded = findLeafBlock(response, (block) => block.layout === "pick_expanded");
        const cover = coverUrl(this.client, imageIds(expanded?.img1, expanded?.img2));

        // Each vote is a row like "wahoofish67 likes it" with a thumbs up or down icon
        const rows = filterLeafBlocks(response, (block) => block.layout === "row_i1i2_t1");
        const voters = (icon: string, suffix: RegExp) => rows
            .filter((block) => block.img2?.filename === icon)
            .map((block) => String(block.txt1?.text ?? "").replace(suffix, ""));

        const upvoters = voters("icon_thumbs_up", / likes it$/);
        const downvoters = voters("icon_thumbs_down", / dislikes it$/);

        return { upvotes: upvoters.length, downvotes: downvoters.length, upvoters, downvoters, cover };
    }

    async addSong ({ songId }: { songId: string }) {
        return await this.client.fetch("/pick/add_song", {
            method: "POST",
            body: new URLSearchParams({
                song_id: songId
            })
        })
    }
}

export interface QueueEntry {
    pickId: string;
    // Rockbot only includes the song ID on the now playing pick
    songId?: string;
    name: string;
    artist: string;
    cover?: string;
    upvotes?: number;
    downvotes?: number;
}

export interface NowPlaying extends QueueEntry {
    duration?: number;
    secondsRemaining?: number;
}

export interface VenueQueue {
    nowPlaying: NowPlaying | null;
    onDeck: QueueEntry[];
    comingUp: QueueEntry[];
}

export class Song {
    client: RockbotClient;
    id: string;
    name: string;
    artist: string;
    artistObject?: Artist;
    album?: Album;
    requestable?: boolean;

    constructor(client: RockbotClient, id: string, { name, artist, album, requestable }: { name: string, artist: string, album?: Album, requestable?: boolean }) {
        this.client = client;
        this.id = id;
        this.name = name;
        this.artist = artist;
        this.album = album;
        this.requestable = requestable;
    }

    /** delimiterIndex is where the "UNAVAILABLE AT THIS VENUE" heading is; undefined when there isn't one, so everything is requestable */
    static fromSearchBlock(client: RockbotClient, block: Block, delimiterIndex: number | undefined): Song {
        // Search results carry album art when Rockbot has it, otherwise the artist's photo; url_fix.key says which
        const { albumId, artistId } = imageIds(block.img1, block.img2);

        const song = new Song(client, block.action.params.song_id, {
            name: block.txt1.text,
            artist: block.txt2.text,
            album: albumId ? new Album(client, albumId) : undefined,
            requestable: delimiterIndex === undefined || block.getIndex() < delimiterIndex
        });

        if (artistId) song.artistObject = new Artist(client, artistId);

        return song;
    }

    async getDetails({ venue }: { venue: Venue }) {
        const params = new URLSearchParams({ song_id: this.id, venue_id: venue.id }).toString();
        const response = await this.client.fetch(`/dj/song/details?${params}`);
        const requestable = !!findLeafBlock(response, (block) => block?.btn1?.text === "REQUEST song");

        const block = findLeafBlock(response, (block) => block?.type === "pick" && block?.layout === "pick_expanded" && block?.img2?.url_fix?.id);

        const { albumId, artistId } = imageIds(block?.img1, block?.img2);

        this.album = albumId ? new Album(this.client, albumId) : undefined;
        this.artistObject = artistId ? new Artist(this.client, artistId) : undefined;
        this.requestable = requestable;

        return this;
    }

    async request({ venue }: { venue: Venue }) {
        const params = new URLSearchParams({ client_pay: '1', song_id: this.id, venue_id: venue.id, playlist_id: '0' });
        const response = await this.client.fetch(`/pick/add_song`, {
            method: "POST",
            body: params
        });

        const success = !!findLeafBlock(response, (block) => block?.txt1?.text === "Song Added to Queue!");
        const pickId = findLeafBlock(response, (block) => block?.type === "pick" && block?.layout === "pick_expanded")?.id;

        if (!success || !pickId) {
            if (response?.log?.name == "hit_pick_limit") {
                throw new RockbotClient.Errors.PickLimitReachedError("Your pick limit has been reached");
            } else if (response?.log?.name == "hit_song_repeat_limit") {
                throw new RockbotClient.Errors.RepeatLimitReachedError("This song has been requested too recently");
            } else {
                const reason = response?.error?.message ?? response?.log?.name;
                throw new RockbotClient.Errors.SongQueueError(`Could not add song to queue${reason ? ` (${reason})` : ""}`);
            }
        }

        return new Pick(this.client, pickId, { song: this, venue });
    }

    get cover() {
        return this.album?.cover || this.artistObject?.cover;
    }
}

export class Pick {
    client: RockbotClient;
    id: string;
    song: Song;
    venue: Venue;

    constructor(client: RockbotClient, id: string, { song, venue }: { song: Song, venue: Venue }) {
        this.client = client;
        this.id = id;
        this.song = song;
        this.venue = venue;
    }

    async vote(direction: "up" | "down" = "up") {
        const response = await this.client.fetch(direction === "up" ? `/pick/vote_up` : `/pick/vote_down`, {
            method: "POST",
            body: new URLSearchParams({ pick_id: this.id })
        });

        if (response?.error) {
            throw new Error(`Could not vote for pick ${this.id}: ${response.error?.message ?? JSON.stringify(response.error)}`);
        }

        return response;
    }
}

export class Album {
    client: RockbotClient;
    id: string;
    name?: string;

    constructor(client: RockbotClient, id: string, name?: string) {
        this.client = client;
        this.id = id;
        this.name = name;
    }

    get cover() {
        return new Asset(this.client, `https://s.rockbot.com/upload/live/albums/500/${this.id.charAt(this.id.length - 1)}/${this.id}.jpg`);
    }
}

export class Artist {
    client: RockbotClient;
    id: string;
    name?: string;

    constructor(client: RockbotClient, id: string, name?: string) {
        this.client = client;
        this.id = id;
        this.name = name;
    }

    get cover() {
        return new Asset(this.client, `https://s.rockbot.com/upload/live/artists/500/${this.id.charAt(this.id.length - 1)}/${this.id}.jpg`);
    }
}

export class Asset {
    client: RockbotClient;
    src: string;

    constructor(client: RockbotClient, src: string) {
        this.client = client;
        this.src = src;
    }
}
