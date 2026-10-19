import express, {} from "express";
import { fileURLToPath } from "node:url";
import { adminCache, adminHistory, adminPage, adminTestAccounts } from "./routes/admin.js";
import { logout, me, requestCode, requireAdmin, requireAuth, requireMember, verifyCode } from "./routes/auth.js";
import { betaPage, createCodeRoute, decideRequestRoute, invitePage, inviteRoute, magicLinkPage, overviewRoute, redeemCodeRoute, requestInviteRoute, revokeCodeRoute } from "./routes/beta.js";
import { boost } from "./routes/boost.js";
import { downvote, downvoteCheck } from "./routes/downvote.js";
import { match } from "./routes/match.js";
import { myPicks, myPicksPage } from "./routes/my-picks.js";
import { queue } from "./routes/queue.js";
import { queued } from "./routes/queued.js";
import { search } from "./routes/search.js";
import { spotifyPlaylist } from "./routes/spotify-playlist.js";
import { status } from "./routes/status.js";
import { venueQueue } from "./routes/venue-queue.js";
import { vote } from "./routes/vote.js";
import { voteCapacity } from "./routes/vote-capacity.js";
const app = express();
// Behind Cloudflare Tunnel, cloudflared connects from this machine and says the visitor used HTTPS.
// Trusting only local proxies lets session cookies be marked Secure without trusting headers from anyone else
app.set("trust proxy", "loopback");
app.use(express.json());
// Open to everyone: the homepage's live queue, and signing in
app.get("/api/status", status);
app.get("/api/venue-queue", venueQueue);
app.post("/api/auth/request-code", requestCode);
app.post("/api/auth/verify", verifyCode);
app.get("/api/auth/me", me);
app.post("/api/auth/logout", logout);
// Signed in, but not approved yet: asking to join, or using an invite code
app.post("/api/beta/request", requireAuth, requestInviteRoute);
app.post("/api/beta/redeem", requireAuth, redeemCodeRoute);
// Everything else needs an approved account during the beta
app.get("/api/search", requireMember, search);
app.get("/api/match", requireMember, match);
app.get("/api/queued", requireMember, queued);
app.get("/api/spotify-playlist", requireMember, spotifyPlaylist);
app.get("/api/vote-capacity", requireMember, voteCapacity);
app.post("/api/queue", requireMember, queue);
app.post("/api/vote", requireMember, vote);
app.post("/api/boost", requireMember, boost);
app.get("/api/my-picks", requireMember, myPicks);
// Admins only
app.get("/api/admin/cache", requireAdmin, adminCache);
app.get("/api/admin/test-accounts", requireAdmin, adminTestAccounts);
app.get("/api/admin/history", requireAdmin, adminHistory);
app.get("/api/admin/downvote", requireAdmin, downvoteCheck);
app.post("/api/admin/downvote", requireAdmin, downvote);
app.get("/api/admin/beta", requireAdmin, overviewRoute);
app.post("/api/admin/requests/decide", requireAdmin, decideRequestRoute);
app.post("/api/admin/invites", requireAdmin, inviteRoute);
app.post("/api/admin/codes", requireAdmin, createCodeRoute);
app.post("/api/admin/codes/revoke", requireAdmin, revokeCodeRoute);
// The pages live in app/ at the project root, which is one level up from both src/ (dev) and dist/ (build)
const appDirectory = fileURLToPath(new URL("../app", import.meta.url));
app.get("/login", (_req, res) => res.sendFile("login.html", { root: appDirectory }));
app.get("/admin", adminPage(appDirectory));
app.get("/beta", betaPage(appDirectory));
app.get("/my-picks", myPicksPage(appDirectory));
app.get("/my-picks.html", (_req, res) => res.redirect("/my-picks"));
app.get("/invite/:code", invitePage);
app.get("/login/magic", magicLinkPage);
app.get("/beta.html", (_req, res) => res.redirect("/beta"));
// The admin page is only reachable through /admin, never as a plain file
app.get("/admin.html", (_req, res) => res.redirect("/admin"));
app.use(express.static(appDirectory));
// Anything a route didn't handle, like a request with a malformed JSON body, gets a JSON error like the routes return
app.use((error, _req, res, _next) => {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status >= 500)
        console.error("Unhandled error:", error);
    res.status(status).json({ error: status < 500 ? "Bad request" : "Something went wrong. Please try again." });
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
//# sourceMappingURL=server.js.map