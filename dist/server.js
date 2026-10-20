import express, {} from "express";
import { API_PORT, FRONTEND_URL } from "./config.js";
import { adminCache, adminHistory, adminTestAccounts } from "./routes/admin.js";
import { logout, me, requestCode, requireAdmin, requireAuth, requireMember, verifyCode } from "./routes/auth.js";
import { createCodeRoute, decideRequestRoute, inviteRoute, magicLinkRoute, overviewRoute, redeemCodeRoute, requestInviteRoute, revokeCodeRoute } from "./routes/beta.js";
import { boost } from "./routes/boost.js";
import { downvote, downvoteCheck } from "./routes/downvote.js";
import { match } from "./routes/match.js";
import { myPicks } from "./routes/my-picks.js";
import { addPlaylist, myPlaylists, playlist, playlistQueueStatus, queuePlaylist } from "./routes/playlists.js";
import { queue } from "./routes/queue.js";
import { queued } from "./routes/queued.js";
import { search } from "./routes/search.js";
import { status } from "./routes/status.js";
import { venueQueue } from "./routes/venue-queue.js";
import { vote } from "./routes/vote.js";
import { voteCapacity } from "./routes/vote-capacity.js";
import { removeFromZotifyQueue, reorderZotifyQueue, zotifyQueue } from "./routes/zotify-queue.js";
import { startLive } from "./live.js";
const app = express();
// Behind Cloudflare Tunnel, cloudflared connects from this machine and says the visitor used HTTPS.
// Trusting only local proxies lets session cookies be marked Secure without trusting headers from anyone else
app.set("trust proxy", "loopback");
// The frontend runs on its own origin (see config.ts), so it calls this API cross-origin with the session cookie.
// Only that origin is allowed, and preflights cover JSON POSTs
app.use((req, res, next) => {
    if (req.headers.origin === FRONTEND_URL) {
        res.set({ "Access-Control-Allow-Origin": FRONTEND_URL, "Access-Control-Allow-Credentials": "true" });
    }
    res.vary("Origin");
    if (req.method === "OPTIONS") {
        res.set({ "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" });
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());
// Open to everyone: the homepage's live queue, and signing in
app.get("/api/status", status);
app.get("/api/venue-queue", venueQueue);
app.post("/api/auth/request-code", requestCode);
app.post("/api/auth/verify", verifyCode);
app.get("/api/auth/me", me);
app.post("/api/auth/logout", logout);
app.post("/api/auth/magic", magicLinkRoute);
// Signed in, but not approved yet: asking to join, or using an invite code
app.post("/api/beta/request", requireAuth, requestInviteRoute);
app.post("/api/beta/redeem", requireAuth, redeemCodeRoute);
// Everything else needs an approved account during the beta
app.get("/api/search", requireMember, search);
app.get("/api/match", requireMember, match);
app.get("/api/queued", requireMember, queued);
app.post("/api/playlists", requireMember, addPlaylist);
app.get("/api/playlists", requireMember, myPlaylists);
app.get("/api/playlists/:id", requireMember, playlist);
app.post("/api/playlists/:id/queue", requireMember, queuePlaylist);
app.get("/api/playlists/:id/queue", requireMember, playlistQueueStatus);
app.get("/api/vote-capacity", requireMember, voteCapacity);
app.post("/api/queue", requireMember, queue);
app.get("/api/zotify-queue", requireAuth, zotifyQueue);
app.post("/api/zotify-queue/remove", requireMember, removeFromZotifyQueue);
app.post("/api/vote", requireMember, vote);
app.post("/api/boost", requireMember, boost);
app.get("/api/my-picks", requireMember, myPicks);
// Admins only
app.get("/api/admin/cache", requireAdmin, adminCache);
app.get("/api/admin/test-accounts", requireAdmin, adminTestAccounts);
app.get("/api/admin/history", requireAdmin, adminHistory);
app.get("/api/admin/downvote", requireAdmin, downvoteCheck);
app.post("/api/admin/downvote", requireAdmin, downvote);
app.post("/api/admin/zotify-queue/reorder", requireAdmin, reorderZotifyQueue);
app.get("/api/admin/beta", requireAdmin, overviewRoute);
app.post("/api/admin/requests/decide", requireAdmin, decideRequestRoute);
app.post("/api/admin/invites", requireAdmin, inviteRoute);
app.post("/api/admin/codes", requireAdmin, createCodeRoute);
app.post("/api/admin/codes/revoke", requireAdmin, revokeCodeRoute);
// Pages are the frontend's job now; anyone opening the API in a browser is sent there
app.get("/", (_req, res) => res.redirect(FRONTEND_URL));
// Anything a route didn't handle, like a request with a malformed JSON body, gets a JSON error like the routes return
app.use((error, _req, res, _next) => {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status >= 500)
        console.error("Unhandled error:", error);
    res.status(status).json({ error: status < 500 ? "Bad request" : "Something went wrong. Please try again." });
});
const server = app.listen(API_PORT, () => {
    console.log(`API running at http://localhost:${API_PORT}/ for ${FRONTEND_URL}`);
});
// Live updates for pages, on the same port
startLive(server);
//# sourceMappingURL=server.js.map