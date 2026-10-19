import { Server } from "socket.io";
import { isApproved } from "./beta.js";
import { FRONTEND_URL } from "./config.js";
import { events } from "./events.js";
import { getPlaylistQueueJob } from "./playlistQueue.js";
import { getRecentlyQueued } from "./queued.js";
import { sessionFromCookies } from "./routes/auth.js";
import { describeVenueQueue, getVenueQueue, isFromZotify, queueEntries } from "./venueQueue.js";
import { refreshVotes } from "./votes.js";
import { describeZotifyQueue, getWaiting, processSoon } from "./zotifyQueue.js";
// Live updates over socket.io. The server fetches each venue's queue from Rockbot once per poll and broadcasts it to every
// page watching, instead of every page polling. Zotify's queue and playlist "queue all" progress are pushed as they change.
//
// Rooms:
//   venue:{venue}             the venue's queue, for anyone
//   zotify:{venue}            Zotify's own queue and its failures there, for approved members
//   playlist:{id}:{venue}     a playlist's "queue all" progress there, for approved members
// How often each venue's queue is fetched from Rockbot, while anyone is watching it or Zotify has songs waiting there
const POLL_MS = 15_000;
// After a vote or a request, Rockbot takes a moment to show it, so fetch again after this long
const CHANGE_DELAY_MS = 2_000;
const VENUES = ["anteatery", "brandywine"];
const isVenue = (value) => VENUES.includes(value);
const isPlaylistId = (value) => typeof value === "string" && /^[A-Za-z0-9]{22}$/.test(value);
let io = null;
// The latest broadcast for each venue, sent straight away to pages that start watching
const latest = new Map();
const watchers = (room) => io?.sockets.adapter.rooms.get(room)?.size ?? 0;
// One fetch at a time per venue; a poll asked for while one is running shares it
const polling = new Map();
/** Fetches a venue's queue from Rockbot, broadcasts it, tops up votes on Zotify's picks and lets Zotify's queue move along */
function poll(venue) {
    const running = polling.get(venue);
    if (running)
        return running;
    const run = (async () => {
        try {
            const { queue: queuePromise, fetchedAt } = getVenueQueue(venue, { fresh: true });
            const [queue, queued] = await Promise.all([queuePromise, getRecentlyQueued(venue)]);
            latest.set(venue, { queue: await describeVenueQueue(venue, queue, fetchedAt), error: null, fetchedAt });
            refreshVotes(venue, queueEntries(queue).filter(entry => isFromZotify(entry, queued)));
        }
        catch (error) {
            console.error(`Could not load the queue at ${venue}:`, error);
            // Keep showing the last queue if there was one
            const last = latest.get(venue);
            latest.set(venue, { queue: last?.queue ?? null, error: "Could not load the queue.", fetchedAt: last?.fetchedAt ?? Date.now() });
        }
        sendVenue(venue);
        processSoon(venue);
    })().finally(() => polling.delete(venue));
    polling.set(venue, run);
    return run;
}
/** The venue's latest queue, with the playing song's time left counted from now */
function venuePayload(venue) {
    const state = latest.get(venue);
    if (!state)
        return null;
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
function sendVenue(venue, to) {
    const payload = venuePayload(venue);
    if (!payload)
        return;
    if (to)
        to.emit("venueQueue", payload);
    else
        io?.to(`venue:${venue}`).emit("venueQueue", payload);
}
/** Zotify's queue marks each person's own songs, so it goes to each member separately */
async function sendZotifyQueue(venue, to) {
    const sockets = to ? [to] : await io?.in(`zotify:${venue}`).fetchSockets() ?? [];
    for (const socket of sockets) {
        socket.emit("zotifyQueue", { venue, ...describeZotifyQueue(venue, socket.data.email) });
    }
}
function sendPlaylistJob(job) {
    io?.to(`playlist:${job.playlistId}:${job.venue}`).emit("playlistQueue", { playlistId: job.playlistId, venue: job.venue, job });
}
// Changes coming in quick succession share one fetch
const pendingChanges = new Map();
function pollSoon(venue) {
    if (pendingChanges.has(venue))
        return;
    pendingChanges.set(venue, setTimeout(() => {
        pendingChanges.delete(venue);
        poll(venue);
    }, CHANGE_DELAY_MS));
}
function handleConnection(socket) {
    socket.on("watch", async ({ venue } = {}) => {
        if (!isVenue(venue))
            return;
        socket.join(`venue:${venue}`);
        if (latest.has(venue))
            sendVenue(venue, socket);
        else
            poll(venue);
        if (socket.data.member) {
            socket.join(`zotify:${venue}`);
            sendZotifyQueue(venue, socket);
        }
    });
    socket.on("unwatch", ({ venue } = {}) => {
        if (!isVenue(venue))
            return;
        socket.leave(`venue:${venue}`);
        socket.leave(`zotify:${venue}`);
    });
    socket.on("watchPlaylist", ({ id, venue } = {}) => {
        if (!socket.data.member || !isPlaylistId(id) || !isVenue(venue))
            return;
        socket.join(`playlist:${id}:${venue}`);
        socket.emit("playlistQueue", { playlistId: id, venue, job: getPlaylistQueueJob(id, venue) });
    });
    socket.on("unwatchPlaylist", ({ id, venue } = {}) => {
        if (isPlaylistId(id) && isVenue(venue))
            socket.leave(`playlist:${id}:${venue}`);
    });
}
/** Starts socket.io on the API's HTTP server, and the polling that feeds it */
export function startLive(server) {
    io = new Server(server, {
        // The frontend is on its own origin and sends the session cookie with the handshake
        cors: { origin: FRONTEND_URL, credentials: true }
    });
    // Who's connecting decides what they can watch. Pages reconnect when someone signs in or out
    io.use(async (socket, next) => {
        try {
            const session = await sessionFromCookies(socket.handshake.headers.cookie);
            socket.data.email = session?.email ?? null;
            socket.data.member = session ? await isApproved(session.email) : false;
            next();
        }
        catch (error) {
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
        for (const venue of VENUES) {
            if (watchers(`venue:${venue}`) || getWaiting(venue).length)
                poll(venue);
        }
    };
    tick();
    setInterval(tick, POLL_MS);
}
//# sourceMappingURL=live.js.map