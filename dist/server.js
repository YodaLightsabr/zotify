import express, {} from "express";
import { API_PORT, FRONTEND_URL } from "./config.js";
import { adminCache, adminHistory, adminTestAccounts, adminVersion, publicVersion } from "./routes/admin.js";
import { logout, me, requestCode, requireAdmin, requireAuth, requireMember, requireSiteAdmin, verifyCode } from "./routes/auth.js";
import { createCodeRoute, decideRequestRoute, inviteRoute, magicLinkRoute, overviewRoute, redeemCodeRoute, requestInviteRoute, revokeCodeRoute } from "./routes/beta.js";
import { boost } from "./routes/boost.js";
import { downvote, downvoteCheck } from "./routes/downvote.js";
import { match } from "./routes/match.js";
import { mealsDay, mealsIndex, mealsItem, mealsLocation, mealsSchool, mealsStatus } from "./routes/meals.js";
import { myPicks } from "./routes/my-picks.js";
import { addPlaylist, myPlaylists, playlist, playlistQueueStatus, queuePlaylist } from "./routes/playlists.js";
import { queue } from "./routes/queue.js";
import { schoolOfRequest } from "./routes/params.js";
import { queued } from "./routes/queued.js";
import { adminSchools, deleteRockbotAccount, deleteSchoolRoute, deleteVenueRoute, rockbotAccounts, saveRockbotAccount, saveSchoolRoute, saveVenueRoute, school, schoolAdminRoute, schools } from "./routes/schools.js";
import { search } from "./routes/search.js";
import { status } from "./routes/status.js";
import { venueQueue } from "./routes/venue-queue.js";
import { vote } from "./routes/vote.js";
import { voteCapacity } from "./routes/vote-capacity.js";
import { clearZotifyQueue, removeFromZotifyQueue, reorderZotifyQueue, zotifyQueue } from "./routes/zotify-queue.js";
import { startLive } from "./live.js";
import { startMealsSync } from "./meals/sync.js";
import { schoolForOrigin } from "./schools.js";
const app = express();
// Behind Cloudflare Tunnel, cloudflared connects from this machine and says the visitor used HTTPS.
// Trusting only local proxies lets session cookies be marked Secure without trusting headers from anyone else
app.set("trust proxy", "loopback");
// Each school's frontend runs on its own origin (zotify.app, uf.zotify.app...), so it calls this API cross-origin with the
// session cookie. Only schools' origins are allowed, and preflights cover JSON POSTs
app.use((req, res, next) => {
    // Zotify Meals is public and read-only, so any site can use it, without cookies
    if (req.path.startsWith("/api/meals")) {
        res.set("Access-Control-Allow-Origin", "*");
    }
    else if (schoolForOrigin(req.headers.origin)) {
        res.set({ "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Credentials": "true" });
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
// Which school's site a request came from decides whose venues, beta and admins it's about (see routes/params.ts)
app.use((req, res, next) => {
    res.locals.school = schoolOfRequest(req);
    next();
});
// Open to everyone: the homepage's live queue, and signing in
app.get("/api/status", status);
app.get("/api/version", publicVersion);
app.get("/api/venue-queue", venueQueue);
app.post("/api/auth/request-code", requestCode);
app.post("/api/auth/verify", verifyCode);
app.get("/api/auth/me", me);
app.post("/api/auth/logout", logout);
app.post("/api/auth/magic", magicLinkRoute);
app.get("/api/school", school);
// Zotify Meals: public dining hall menus (see routes/meals.ts). More specific paths come before /:location
app.get("/api/meals", mealsIndex);
app.get("/api/meals/:school", mealsSchool);
app.get("/api/meals/:school/status", mealsStatus);
app.get("/api/meals/:school/items/:sku", mealsItem);
app.get("/api/meals/:school/:location", mealsLocation);
app.get("/api/meals/:school/:location/:date", mealsDay);
app.get("/api/schools", schools);
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
// Site admins only: every school, venue and Rockbot account, and the raw data
app.get("/api/admin/schools", requireSiteAdmin, adminSchools);
app.post("/api/admin/schools", requireSiteAdmin, saveSchoolRoute);
app.post("/api/admin/schools/delete", requireSiteAdmin, deleteSchoolRoute);
app.post("/api/admin/schools/admins", requireSiteAdmin, schoolAdminRoute);
app.post("/api/admin/venues", requireSiteAdmin, saveVenueRoute);
app.post("/api/admin/venues/delete", requireSiteAdmin, deleteVenueRoute);
app.get("/api/admin/rockbot-accounts", requireSiteAdmin, rockbotAccounts);
app.post("/api/admin/rockbot-accounts", requireSiteAdmin, saveRockbotAccount);
app.post("/api/admin/rockbot-accounts/delete", requireSiteAdmin, deleteRockbotAccount);
app.get("/api/admin/cache", requireSiteAdmin, adminCache);
app.get("/api/admin/test-accounts", requireSiteAdmin, adminTestAccounts);
// Each school's admins (and site admins): its beta, history and queue
app.get("/api/admin/history", requireAdmin, adminHistory);
app.get("/api/admin/version", requireAdmin, adminVersion);
app.get("/api/admin/downvote", requireAdmin, downvoteCheck);
app.post("/api/admin/downvote", requireAdmin, downvote);
app.post("/api/admin/zotify-queue/reorder", requireAdmin, reorderZotifyQueue);
app.post("/api/admin/zotify-queue/clear", requireAdmin, clearZotifyQueue);
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
// Keeps Zotify Meals' menus fresh: two weeks nightly and on first start, today and tomorrow hourly
startMealsSync();
//# sourceMappingURL=server.js.map