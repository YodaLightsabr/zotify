import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { VenueName } from "./accounts.js";
import { isApproved } from "./beta.js";
import { RockbotClient } from "./client.js";
import { events } from "./events.js";
import { getPlaylistQueueJob, type PlaylistQueueJob } from "./playlistQueue.js";
import { getRecentlyQueued } from "./queued.js";
import { sessionFromCookies } from "./routes/auth.js";
import { getVenue, getVenues, schoolForOrigin } from "./schools.js";
import { describeVenueQueue, getVenueQueue, isFromZotify, queueEntries } from "./venueQueue.js";
import { refreshVotes } from "./votes.js";
import { describeZotifyQueue, getWaiting, processSoon } from "./zotifyQueue.js";

// Live updates over socket.io. The server fetches each venue's queue from Rockbot once per poll and broadcasts it to every
// page watching, instead of every page polling. Zotify's queue and playlist "queue all" progress are pushed as they change.
//
// Each connection belongs to the school whose site opened it (by its Origin), and can only watch that school's venues.
//
// Rooms:
//   venue:{venue}             the venue's queue, for anyone at its school's site
//   zotify:{venue}            Zotify's own queue and its failures there, for the school's approved members
//   playlist:{id}:{venue}     a playlist's "queue all" progress there, for the school's approved members

// How often each venue's queue is fetched from Rockbot, while anyone is watching it or Zotify has songs waiting there
const POLL_MS = 15_000;
// After a vote or a request, Rockbot takes a moment to show it, so fetch again after this long
const CHANGE_DELAY_MS = 2_000;

const isPlaylistId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9]{22}$/.test(value);

interface SocketData {
    email: string | null;
    // The school whose site this connection came from
    school: string;
    // Whether they're an approved member there
    member: boolean;
}

type LiveSocket = Socket<any, any, any, SocketData>;

let io: Server<any, any, any, SocketData> | null = null;

// The latest broadcast for each venue, sent straight away to pages that start watching
const latest = new Map<VenueName, { queue: Awaited<ReturnType<typeof describeVenueQueue>> | null, error: string | null, fetchedAt: number }>();

const watchers = (room: string) => io?.sockets.adapter.rooms.get(room)?.size ?? 0;

// One fetch at a time per venue; a poll asked for while one is running shares it
const polling = new Map<VenueName, Promise<void>>();

/** Fetches a venue's queue from Rockbot, broadcasts it, tops up votes on Zotify's picks and lets Zotify's queue move along */
function poll(venue: VenueName) {
    const running = polling.get(venue);
    if (running) return running;

    const run = (async () => {
        try {
            const { queue: queuePromise, fetchedAt } = getVenueQueue(venue, { fresh: true });
            const [queue, queued] = await Promise.all([queuePromise, getRecentlyQueued(venue)]);

            latest.set(venue, { queue: await describeVenueQueue(venue, queue, fetchedAt), error: null, fetchedAt });
            refreshVotes(venue, queueEntries(queue).filter(entry => isFromZotify(entry, queued)));
        } catch (error) {
            // A closed venue is normal, so it's not worth a stack trace every poll
            const closed = error instanceof RockbotClient.Errors.VenueUnavailableError;
            if (closed) console.warn(`${venue} isn't taking check-ins right now`);
            else console.error(`Could not load the queue at ${venue}:`, error);
            // Keep showing the last queue if there was one
            const last = latest.get(venue);
            const message = closed ? `${getVenue(venue)?.name ?? "This venue"} isn't taking requests right now.` : "Could not load the queue.";
            // Keep showing the last queue for a hiccup, but not for a closed venue, whose queue is over
            latest.set(venue, { queue: closed ? null : last?.queue ?? null, error: message, fetchedAt: last?.fetchedAt ?? Date.now() });
        }

        sendVenue(venue);
        processSoon(venue);
    })().finally(() => polling.delete(venue));

    polling.set(venue, run);
    return run;
}

/** The venue's latest queue, with the playing song's time left counted from now */
function venuePayload(venue: VenueName) {
    const state = latest.get(venue);
    if (!state) return null;

    const elapsed = Math.floor((Date.now() - state.fetchedAt) / 1000);
    const nowPlaying = state.queue?.nowPlaying;
    const queue = state.queue && {
        ...state.queue,
        nowPlaying: nowPlaying && {
            ...nowPlaying,
            secondsRemaining: nowPlaying.secondsRemaining !== undefined ? Math.max(0, nowPlaying.secondsRemaining - elapsed) : undefined
        }
    };

    return { venue, queue, error: state.error };
}

function sendVenue(venue: VenueName, to?: LiveSocket) {
    const payload = venuePayload(venue);
    if (!payload) return;

    if (to) to.emit("venueQueue", payload);
    else io?.to(`venue:${venue}`).emit("venueQueue", payload);
}

/** Zotify's queue marks each person's own songs, so it goes to each member separately */
async function sendZotifyQueue(venue: VenueName, to?: LiveSocket) {
    const sockets = to ? [to] : await io?.in(`zotify:${venue}`).fetchSockets() ?? [];

    for (const socket of sockets) {
        socket.emit("zotifyQueue", { venue, ...describeZotifyQueue(venue, socket.data.email) });
    }
}

function sendPlaylistJob(job: PlaylistQueueJob) {
    io?.to(`playlist:${job.playlistId}:${job.venue}`).emit("playlistQueue", { playlistId: job.playlistId, venue: job.venue, job });
}

// Changes coming in quick succession share one fetch
const pendingChanges = new Map<VenueName, NodeJS.Timeout>();

function pollSoon(venue: VenueName) {
    if (pendingChanges.has(venue)) return;

    pendingChanges.set(venue, setTimeout(() => {
        pendingChanges.delete(venue);
        poll(venue);
    }, CHANGE_DELAY_MS));
}

function handleConnection(socket: LiveSocket) {
    // Only the school's own venues
    const isVenue = (value: unknown): value is VenueName => getVenue(value)?.schoolId === socket.data.school;

    socket.on("watch", async ({ venue }: { venue?: unknown } = {}) => {
        if (!isVenue(venue)) return;

        socket.join(`venue:${venue}`);
        if (latest.has(venue)) sendVenue(venue, socket);
        else poll(venue);

        if (socket.data.member) {
            socket.join(`zotify:${venue}`);
            sendZotifyQueue(venue, socket);
        }
    });

    socket.on("unwatch", ({ venue }: { venue?: unknown } = {}) => {
        if (!isVenue(venue)) return;
        socket.leave(`venue:${venue}`);
        socket.leave(`zotify:${venue}`);
    });

    socket.on("watchPlaylist", ({ id, venue }: { id?: unknown, venue?: unknown } = {}) => {
        if (!socket.data.member || !isPlaylistId(id) || !isVenue(venue)) return;

        socket.join(`playlist:${id}:${venue}`);
        socket.emit("playlistQueue", { playlistId: id, venue, job: getPlaylistQueueJob(id, venue) });
    });

    socket.on("unwatchPlaylist", ({ id, venue }: { id?: unknown, venue?: unknown } = {}) => {
        if (isPlaylistId(id) && isVenue(venue)) socket.leave(`playlist:${id}:${venue}`);
    });
}

/** Starts socket.io on the API's HTTP server, and the polling that feeds it */
export function startLive(server: HttpServer) {
    io = new Server(server, {
        // Each school's frontend is on its own origin and sends the session cookie with the handshake
        cors: { origin: (origin, callback) => callback(null, !!schoolForOrigin(origin)), credentials: true }
    });

    // Who's connecting, and from which school's site, decides what they can watch. Pages reconnect when someone signs in or out
    io.use(async (socket, next) => {
        try {
            const school = schoolForOrigin(socket.handshake.headers.origin);
            if (!school) return next(new Error("Connect from a school's Zotify"));

            const session = await sessionFromCookies(socket.handshake.headers.cookie);
            socket.data.email = session?.email ?? null;
            socket.data.school = school.id;
            socket.data.member = session ? await isApproved(session.email, school.id) : false;
            next();
        } catch (error) {
            console.error("Could not check a socket's session:", error);
            next(new Error("Couldn't check your session"));
        }
    });

    io.on("connection", handleConnection);

    events.on("venueChanged", pollSoon);
    events.on("zotifyQueueChanged", venue => { sendZotifyQueue(venue).catch(error => console.error("Could not send Zotify's queue:", error)); });
    events.on("playlistJobChanged", sendPlaylistJob);

    // Only venues someone is watching, or where Zotify has songs to move into Rockbot, are fetched
    const tick = () => {
        for (const { id: venue } of getVenues()) {
            if (watchers(`venue:${venue}`) || getWaiting(venue).length) poll(venue);
        }
    };

    tick();
    setInterval(tick, POLL_MS);
}
