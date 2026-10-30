import express, { type NextFunction, type Request, type Response } from "express";
import { API_PORT, DOCS_URL, FRONTEND_URL } from "./config.js";
import { adminCache, adminDeploys, adminHistory, adminTestAccounts, adminVersion, publicVersion } from "./routes/admin.js";
import {
    anyAdmin, developer, logout, me, member, requestCode, schoolAdmin, sessionOnly, signedIn, siteAdmin, verifyCode
} from "./routes/auth.js";
import {
    createCodeRoute, decideRequestRoute, inviteRoute, magicLinkRoute, overviewRoute,
    redeemCodeRoute, requestInviteRoute, revokeCodeRoute
} from "./routes/beta.js";
import {
    createAppRoute, createTokenRoute, deleteAppRoute, deleteTokenRoute, developerRoute, developers, myApps, myAuthorizations,
    myTokens, resetSecretRoute, revokeAuthorizationRoute, updateAppRoute
} from "./routes/developers.js";
import {
    createTokenRoute as createKeysTokenRoute, deleteDeviceRoute, deleteTokenRoute as deleteKeysTokenRoute, keysOverview, otpRoute,
    raiseCounterRoute, randomSecretsRoute, saveDeviceRoute, whoamiRoute
} from "./routes/keys.js";
import {
    libraryPlaylists, librarySongs, removePlaylistRoute, removeSongRoute, savePlaylistRoute, saveSongRoute
} from "./routes/library.js";
import { match } from "./routes/match.js";
import {
    addFavoriteRoute, mealsDay, mealsIndex, mealsItem, mealsLocation, mealsSchool, mealsStatus, myFavorites, removeFavoriteRoute
} from "./routes/meals.js";
import { myPicks } from "./routes/my-picks.js";
import { spacesDay, spacesFree, spacesIndex, spacesNow, spacesRoom, spacesSchool } from "./routes/spaces.js";
import { decideAuthorization, describeAuthorization, metadata, revoke, token } from "./routes/oauth.js";
import { openApi } from "./routes/openapi.js";
import { schoolOfRequest, schoolParam, venueParam } from "./routes/params.js";
import { addPlaylist, matchPlaylist, myPlaylists, playlist, playlistMatches, playlistQueueStatus, queuePlaylist } from "./routes/playlists.js";
import { requestSong } from "./routes/requests.js";
import {
    adminSchools, deleteRockbotAccount, deleteSchoolRoute, deleteVenueRoute, rockbotAccounts, saveRockbotAccount, saveSchoolRoute,
    saveVenueRoute, school, schoolAdminRoute, schools
} from "./routes/schools.js";
import { search } from "./routes/search.js";
import {
    spotifyAuthorize, spotifyCallback, spotifyDisconnect, spotifyImport, spotifyImportStatus, spotifyLibrary, spotifyStatus
} from "./routes/spotify.js";
import { venueQueue } from "./routes/venue-queue.js";
import { pickVotes, votePick } from "./routes/votes.js";
import { clearZotifyQueue, removeFromZotifyQueue, reorderZotifyQueue, zotifyQueue } from "./routes/zotify-queue.js";
import { SCOPES, TOKEN_LIFETIMES } from "./developers.js";
import { recordGoLive } from "./deploys.js";
import { startLive } from "./live.js";
import { startMealsSync } from "./meals/sync.js";
import { startSpacesRecorder } from "./spaces/availability.js";
import { schoolForOrigin } from "./schools.js";

const app = express();

// Behind Cloudflare Tunnel, cloudflared connects from this machine and says the visitor used HTTPS.
// Trusting only local proxies lets session cookies be marked Secure without trusting headers from anyone else
app.set("trust proxy", "loopback");

// Each school's frontend runs on its own origin (www.zotify.app, uf.zotify.app...), so it calls this API cross-origin with the
// session cookie: only schools' origins get credentials. Any other site can still call the API with a bearer token (or Zotify
// Meals without one), but never with someone's cookie
app.use((req, res, next) => {
    if (schoolForOrigin(req.headers.origin)) {
        res.set({ "Access-Control-Allow-Origin": req.headers.origin, "Access-Control-Allow-Credentials": "true" });
    } else {
        res.set("Access-Control-Allow-Origin", "*");
    }

    res.vary("Origin");

    if (req.method === "OPTIONS") {
        res.set({
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After",
            "Access-Control-Max-Age": "600"
        });
        res.sendStatus(204);
        return;
    }

    next();
});

app.use(express.json());
// OAuth's token and revoke endpoints take forms
app.use(express.urlencoded({ extended: false }));

// Which school's site a request came from, for sign-in. Routes under /v1/venues/:venue and /v1/schools/:school replace it with
// the school they're about (see params.ts)
app.use((req, res, next) => {
    res.locals.school = schoolOfRequest(req);
    next();
});

// The API, documented at docs.zotify.app from the OpenAPI description at /v1/openapi.json (src/openapi.ts). Zotify's own pages
// use it with the session cookie; everyone else uses personal access tokens or OAuth (see developers.ts). Scopes are in signedIn,
// member and the rest of auth.ts's guards
const v1 = express.Router();

// For everyone
v1.get("/", (_req, res) => res.json({ docs: DOCS_URL, openapi: "/v1/openapi.json", scopes: SCOPES, tokenLifetimes: TOKEN_LIFETIMES }));
v1.get("/openapi.json", openApi);
v1.get("/status", (_req, res) => res.type("text/plain").send("OK"));
v1.get("/version", publicVersion);
v1.get("/schools", schools);
v1.get("/schools/:school", schoolParam, school);
v1.get("/venues/:venue/queue", venueParam, venueQueue);

// Signing in on Zotify's own pages
v1.post("/auth/code", requestCode);
v1.post("/auth/session", verifyCode);
v1.post("/auth/magic-link", magicLinkRoute);
v1.delete("/auth/session", logout);

// You
v1.get("/me", signedIn(), me);
v1.get("/me/picks", signedIn("music:read"), myPicks);
v1.get("/me/playlists", signedIn("music:read"), myPlaylists);
v1.post("/me/playlists", signedIn("music:write"), addPlaylist);
v1.get("/playlists/:id", signedIn("music:read"), playlist);
v1.get("/me/library/songs", signedIn("music:read"), librarySongs);
v1.put("/me/library/songs/:songId", signedIn("music:write"), saveSongRoute);
v1.delete("/me/library/songs/:songId", signedIn("music:write"), removeSongRoute);
v1.get("/me/library/playlists", signedIn("music:read"), libraryPlaylists);
v1.delete("/me/library/playlists/:id", signedIn("music:write"), removePlaylistRoute);

// Connecting Spotify and importing from it, for site admins on Zotify's own pages: Spotify only lets a handful of accounts
// connect. Their connection also looks up playlist covers and album art for everyone (see spotifyArt.ts)
v1.get("/me/spotify", siteAdmin, spotifyStatus);
v1.post("/me/spotify/authorize", siteAdmin, spotifyAuthorize);
v1.post("/me/spotify/callback", siteAdmin, spotifyCallback);
v1.delete("/me/spotify", siteAdmin, spotifyDisconnect);
v1.get("/me/spotify/library", siteAdmin, spotifyLibrary);
v1.get("/me/spotify/import", siteAdmin, spotifyImportStatus);

// Joining a school's Zotify during the beta
v1.post("/schools/:school/join-request", schoolParam, signedIn(), requestInviteRoute);
v1.post("/schools/:school/invite-codes/redeem", schoolParam, signedIn(), redeemCodeRoute);

// Music at a venue, for members of its school
v1.get("/venues/:venue/search", venueParam, member("music:read"), search);
v1.get("/venues/:venue/match", venueParam, member("music:read"), match);
v1.post("/venues/:venue/requests", venueParam, member("music:write"), requestSong);
v1.get("/venues/:venue/picks/:pickId/votes", venueParam, member("music:read"), pickVotes);
v1.post("/venues/:venue/picks/:pickId/votes", venueParam, member("music:write"), votePick);
v1.get("/venues/:venue/zotify-queue", venueParam, signedIn("music:read"), zotifyQueue);
v1.delete("/venues/:venue/zotify-queue/:id", venueParam, member("music:write"), removeFromZotifyQueue);
v1.put("/venues/:venue/zotify-queue/order", venueParam, schoolAdmin, reorderZotifyQueue);
v1.delete("/venues/:venue/zotify-queue", venueParam, schoolAdmin, clearZotifyQueue);
v1.post("/venues/:venue/playlists/:id/matches", venueParam, member("music:read"), matchPlaylist);
v1.get("/venues/:venue/playlists/:id/matches", venueParam, member("music:read"), playlistMatches);
v1.post("/venues/:venue/playlists/:id/queue", venueParam, member("music:write"), queuePlaylist);
v1.get("/venues/:venue/playlists/:id/queue", venueParam, member("music:read"), playlistQueueStatus);
v1.put("/venues/:venue/playlists/:id/library", venueParam, member("music:write"), savePlaylistRoute);
v1.post("/venues/:venue/spotify/import", venueParam, siteAdmin, member("music:write"), spotifyImport);

// Zotify Meals: public menus, and your favorites. More specific paths come before /:location
const meals = express.Router();
meals.get("/", mealsIndex);
meals.get("/:school", mealsSchool);
meals.get("/:school/status", mealsStatus);
meals.get("/:school/favorites", signedIn("meals:read"), myFavorites);
meals.put("/:school/favorites/:recipeId", signedIn("meals:write"), addFavoriteRoute);
meals.delete("/:school/favorites/:recipeId", signedIn("meals:write"), removeFavoriteRoute);
meals.get("/:school/items/:sku", mealsItem);
meals.get("/:school/:location", mealsLocation);
meals.get("/:school/:location/:date", mealsDay);
v1.use("/meals", meals);

// Zotify Spaces: public study room availability, fetched live from LibCal
v1.get("/spaces", spacesIndex);
v1.get("/spaces/:school", spacesSchool);
v1.get("/spaces/:school/now", spacesNow);
v1.get("/spaces/:school/availability", spacesDay);
v1.get("/spaces/:school/free", spacesFree);
v1.get("/spaces/:school/rooms/:room", spacesRoom);

// Zotify Keys (see routes/keys.ts), for anyone signed in, not just the beta: managed on keys.zotify.app, and the extension's OTPs, by its own API keys
v1.get("/keys", sessionOnly, keysOverview);
v1.put("/keys/device", sessionOnly, saveDeviceRoute);
v1.patch("/keys/device", sessionOnly, raiseCounterRoute);
v1.delete("/keys/device", sessionOnly, deleteDeviceRoute);
v1.get("/keys/random", sessionOnly, randomSecretsRoute);
v1.post("/keys/tokens", sessionOnly, createKeysTokenRoute);
v1.delete("/keys/tokens/:id", sessionOnly, deleteKeysTokenRoute);
v1.post("/keys/otp", otpRoute);
v1.get("/keys/whoami", whoamiRoute);

// A school's admins (and site admins): its beta, history and Zotify's queue (above)
v1.get("/schools/:school/beta", schoolParam, schoolAdmin, overviewRoute);
v1.post("/schools/:school/beta/decisions", schoolParam, schoolAdmin, decideRequestRoute);
v1.post("/schools/:school/beta/invites", schoolParam, schoolAdmin, inviteRoute);
v1.post("/schools/:school/invite-codes", schoolParam, schoolAdmin, createCodeRoute);
v1.delete("/schools/:school/invite-codes/:code", schoolParam, schoolAdmin, revokeCodeRoute);
v1.get("/schools/:school/history", schoolParam, schoolAdmin, adminHistory);
v1.get("/admin/version", anyAdmin, adminVersion);
v1.get("/admin/deploys", anyAdmin, adminDeploys);

// Developers' tokens and apps, and the apps you've signed in to: Zotify's own pages only
v1.get("/me/tokens", developer, myTokens);
v1.post("/me/tokens", developer, createTokenRoute);
v1.delete("/me/tokens/:id", developer, deleteTokenRoute);
v1.get("/me/apps", developer, myApps);
v1.post("/me/apps", developer, createAppRoute);
v1.patch("/me/apps/:clientId", developer, updateAppRoute);
v1.delete("/me/apps/:clientId", developer, deleteAppRoute);
v1.post("/me/apps/:clientId/secret", developer, resetSecretRoute);
v1.get("/me/authorizations", sessionOnly, myAuthorizations);
v1.delete("/me/authorizations/:clientId", sessionOnly, revokeAuthorizationRoute);

// OAuth (see routes/oauth.ts)
v1.get("/oauth/authorize", sessionOnly, describeAuthorization);
v1.post("/oauth/authorize", sessionOnly, decideAuthorization);
v1.post("/oauth/token", token);
v1.post("/oauth/revoke", revoke);

// Site admins, on Zotify's own pages: every school, venue, Rockbot account and developer, and the raw data
v1.get("/admin/schools", siteAdmin, adminSchools);
v1.post("/admin/schools", siteAdmin, saveSchoolRoute);
v1.delete("/admin/schools/:id", siteAdmin, deleteSchoolRoute);
v1.put("/admin/schools/:id/admins/:email", siteAdmin, schoolAdminRoute);
v1.delete("/admin/schools/:id/admins/:email", siteAdmin, schoolAdminRoute);
v1.post("/admin/venues", siteAdmin, saveVenueRoute);
v1.delete("/admin/venues/:id", siteAdmin, deleteVenueRoute);
v1.get("/admin/rockbot-accounts", siteAdmin, rockbotAccounts);
v1.post("/admin/rockbot-accounts", siteAdmin, saveRockbotAccount);
v1.delete("/admin/rockbot-accounts/:username", siteAdmin, deleteRockbotAccount);
v1.get("/admin/developers", siteAdmin, developers);
v1.put("/admin/developers/:email", siteAdmin, developerRoute);
v1.delete("/admin/developers/:email", siteAdmin, developerRoute);
v1.get("/admin/cache", siteAdmin, adminCache);
v1.get("/admin/test-accounts", siteAdmin, adminTestAccounts);

v1.use((_req, res) => res.status(404).json({ error: "There's nothing here. See the docs at " + DOCS_URL, code: "not_found" }));

app.use("/v1", v1);

// Zotify Meals started out at /api/meals, which keeps working for anyone already using it
app.use("/api/meals", meals);
app.get("/.well-known/oauth-authorization-server", metadata);

// Pages are the frontend's job now; anyone opening the API in a browser is sent there
app.get("/", (_req, res) => res.redirect(FRONTEND_URL));

// Anything a route didn't handle, like a request with a malformed JSON body, gets a JSON error like the routes return
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = error?.status ?? error?.statusCode ?? 500;
    if (status >= 500) console.error("Unhandled error:", error);
    res.status(status).json({ error: status < 500 ? "Bad request" : "Something went wrong. Please try again." });
});

const server = app.listen(API_PORT, () => {
    console.log(`API running at http://localhost:${API_PORT}/ for ${FRONTEND_URL}`);
});

// How long this release took to go live, for the deploy progress bar
recordGoLive();

// Live updates for pages, on the same port
startLive(server);

// Keeps Zotify Meals' menus fresh: two weeks nightly and on first start, today and tomorrow hourly
startMealsSync();

// Keeps a record of study room availability, so a whole day can be shown after its slots have started
startSpacesRecorder();
