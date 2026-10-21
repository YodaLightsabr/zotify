import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, transaction } from "./db.js";

// The public API's credentials (see docs.zotify.app). Site admins decide who's a developer. Developers make personal access
// tokens for themselves and OAuth apps that anyone can sign in to. Every credential acts as the person it belongs to, limited
// to its scopes, and is only ever stored as a hash.
//
// Token formats, so they're easy to spot (and to scan for when leaked):
//   zotify_pat_...     personal access token
//   zotify_at_...      OAuth access token, which lasts an hour
//   zotify_rt_...      OAuth refresh token, which is swapped for a new one each time it's used
//   zotify_secret_...  an OAuth app's client secret
//   zotify_app_...     an OAuth app's client ID (not a secret)

export const SCOPES = {
    "music:read": "See venues' queues, search for songs, and see your picks and playlists",
    "music:write": "Request songs, vote on them, add playlists, and take your songs out of Zotify's queue",
    "meals:read": "See your favorite dishes on Zotify Meals",
    "meals:write": "Add and remove favorite dishes on Zotify Meals",
    admin: "Do what you can as a school's admin: downvote, rearrange and clear Zotify's queue, run the beta, and see the history"
} as const;

export type Scope = keyof typeof SCOPES;

export const isScope = (value: unknown): value is Scope => typeof value === "string" && Object.hasOwn(SCOPES, value);

// How long PATs can last, in days; null never expires
export const TOKEN_LIFETIMES = [7, 30, 90, 365, null] as const;

const CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000;
// How long a token's last use is trusted before it's written again, so every request doesn't write to the database
const LAST_USED_GRANULARITY_MS = 60 * 1000;

const MAX_TOKENS = 50;
const MAX_APPS = 20;
const MAX_REDIRECT_URIS = 10;

/** Something a developer asked for that can't be done. status is the HTTP status to answer with */
export class DeveloperError extends Error {
    status: number;

    constructor (message: string, status = 400) {
        super(message);
        this.name = "DeveloperError";
        this.status = status;
    }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const secret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

const joinScopes = (scopes: Scope[]) => [...new Set(scopes)].sort().join(" ");
const splitScopes = (scopes: string) => scopes.split(" ").filter(isScope);

/** Scopes from a space-separated string (OAuth) or an array (JSON). Null if any of them isn't a scope */
export function parseScopes(input: unknown): Scope[] | null {
    const list = typeof input === "string" ? input.split(/[\s,]+/).filter(Boolean) : Array.isArray(input) ? input : null;
    if (!list || !list.every(isScope)) return null;
    return [...new Set(list as Scope[])];
}

// Developers

interface DeveloperRow { email: string; added_by: string; added_at: number }

export const isDeveloper = (email: string) => !!db.prepare("SELECT 1 FROM developers WHERE email = ?").get(email);

export const listDevelopers = () => (db.prepare("SELECT * FROM developers ORDER BY added_at DESC").all() as unknown as DeveloperRow[])
    .map(row => ({ email: row.email, addedBy: row.added_by, addedAt: row.added_at }));

export function addDeveloper(email: string, addedBy: string) {
    db.prepare("INSERT OR IGNORE INTO developers (email, added_by, added_at) VALUES (?, ?, ?)").run(email, addedBy, Date.now());
}

/** Takes away someone's developer access. Their tokens are deleted; their apps keep working for the people signed in to them */
export function removeDeveloper(email: string) {
    transaction(() => {
        db.prepare("DELETE FROM developers WHERE email = ?").run(email);
        db.prepare("DELETE FROM api_tokens WHERE email = ?").run(email);
    });
}

// Personal access tokens

interface TokenRow {
    id: number; email: string; name: string; prefix: string; scopes: string;
    created_at: number; expires_at: number | null; last_used_at: number | null;
}

const toToken = (row: TokenRow) => ({
    id: row.id,
    name: row.name,
    // The start of the token, like "zotify_pat_Ab3d", to tell tokens apart
    prefix: row.prefix,
    scopes: splitScopes(row.scopes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at
});

export const listTokens = (email: string) =>
    (db.prepare("SELECT * FROM api_tokens WHERE email = ? ORDER BY created_at DESC").all(email) as unknown as TokenRow[]).map(toToken);

/** Makes a personal access token. The token itself is only returned here; afterwards only its hash is kept */
export function createToken(email: string, input: { name?: unknown, scopes?: unknown, expiresInDays?: unknown }) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const scopes = parseScopes(input.scopes);
    const days = input.expiresInDays ?? null;

    if (!name || name.length > 60) throw new DeveloperError("Give the token a name of up to 60 characters.");
    if (!scopes?.length) throw new DeveloperError(`Pick at least one scope: ${Object.keys(SCOPES).join(", ")}.`);
    if (!TOKEN_LIFETIMES.includes(days as never)) throw new DeveloperError("expiresInDays must be 7, 30, 90, 365, or null for no expiry.");

    const { count } = db.prepare("SELECT COUNT(*) AS count FROM api_tokens WHERE email = ?").get(email) as { count: number };
    if (count >= MAX_TOKENS) throw new DeveloperError(`You can have up to ${MAX_TOKENS} tokens. Delete one you don't use first.`, 409);

    const token = secret("zotify_pat_");
    const now = Date.now();
    const expiresAt = days === null ? null : now + (days as number) * 24 * 60 * 60 * 1000;
    const { lastInsertRowid } = db.prepare(`
        INSERT INTO api_tokens (email, name, token_hash, prefix, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(email, name, sha256(token), token.slice(0, 15), joinScopes(scopes), now, expiresAt);

    return { ...toToken(db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(lastInsertRowid) as unknown as TokenRow), token };
}

export function deleteToken(email: string, id: number) {
    const { changes } = db.prepare("DELETE FROM api_tokens WHERE id = ? AND email = ?").run(id, email);
    if (!changes) throw new DeveloperError("There's no token with that ID.", 404);
}

// OAuth apps

interface AppRow {
    id: string; owner: string; name: string; description: string | null; homepage_url: string | null;
    redirect_uris: string; confidential: number; secret_hash: string | null; created_at: number;
}

const toApp = (row: AppRow) => ({
    clientId: row.id,
    name: row.name,
    description: row.description,
    homepageUrl: row.homepage_url,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    // Confidential apps run on a server and keep a client secret; public ones (desktop, mobile, Raycast) use PKCE instead
    confidential: !!row.confidential,
    createdAt: row.created_at
});

export type OAuthApp = ReturnType<typeof toApp> & { owner: string };

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Whether an app may send people back to this address: https anywhere, http only to this computer, or an app's own scheme
 * (like raycast://oauth). Never fragments, or schemes that run code
 */
function validRedirectUri(uri: string) {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return false;
    }

    if (url.hash || uri.length > 500) return false;
    if (url.protocol === "https:") return true;
    if (url.protocol === "http:") return LOOPBACK_HOSTS.includes(url.hostname);
    return !["javascript:", "data:", "file:", "vbscript:", "blob:"].includes(url.protocol);
}

/** Whether a redirect_uri is one the app registered. Exact, except that loopback addresses can use any port (RFC 8252) */
export function matchesRedirectUri(app: { redirectUris: string[] }, uri: string) {
    if (app.redirectUris.includes(uri)) return true;

    const withoutPort = (value: string) => {
        try {
            const url = new URL(value);
            if (url.protocol !== "http:" || !LOOPBACK_HOSTS.includes(url.hostname)) return null;
            url.port = "";
            return url.toString();
        } catch {
            return null;
        }
    };

    const requested = withoutPort(uri);
    return !!requested && app.redirectUris.some(registered => withoutPort(registered) === requested);
}

function appFields(input: { name?: unknown, description?: unknown, homepageUrl?: unknown, redirectUris?: unknown }) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
    const homepageUrl = typeof input.homepageUrl === "string" && input.homepageUrl.trim() ? input.homepageUrl.trim() : null;
    const redirectUris = Array.isArray(input.redirectUris) ? input.redirectUris.map(uri => String(uri).trim()).filter(Boolean) : [];

    if (!name || name.length > 60) throw new DeveloperError("Give the app a name of up to 60 characters.");
    if (description && description.length > 300) throw new DeveloperError("Keep the description under 300 characters.");
    if (homepageUrl && !/^https?:\/\/\S+$/.test(homepageUrl)) throw new DeveloperError("The homepage has to be an http or https address.");
    if (!redirectUris.length || redirectUris.length > MAX_REDIRECT_URIS) throw new DeveloperError(`Add 1 to ${MAX_REDIRECT_URIS} redirect URIs.`);

    const invalid = redirectUris.find(uri => !validRedirectUri(uri));
    if (invalid) throw new DeveloperError(`${invalid} can't be a redirect URI. Use https, http on localhost, or your app's own scheme, without a #fragment.`);

    return { name, description, homepageUrl, redirectUris: [...new Set(redirectUris)] };
}

export function getApp(clientId: unknown): OAuthApp | null {
    if (typeof clientId !== "string") return null;
    const row = db.prepare("SELECT * FROM oauth_apps WHERE id = ?").get(clientId) as unknown as AppRow | undefined;
    return row ? { ...toApp(row), owner: row.owner } : null;
}

export const listApps = (owner: string) =>
    (db.prepare("SELECT * FROM oauth_apps WHERE owner = ? ORDER BY created_at DESC").all(owner) as unknown as AppRow[]).map(toApp);

function ownApp(owner: string, clientId: string) {
    const app = getApp(clientId);
    if (!app || app.owner !== owner) throw new DeveloperError("There's no app with that client ID.", 404);
    return app;
}

/** Registers an app. Confidential apps get a client secret, which is only returned here (or when it's replaced) */
export function createApp(owner: string, input: Parameters<typeof appFields>[0] & { confidential?: unknown }) {
    const fields = appFields(input);
    const confidential = input.confidential === true;

    const { count } = db.prepare("SELECT COUNT(*) AS count FROM oauth_apps WHERE owner = ?").get(owner) as { count: number };
    if (count >= MAX_APPS) throw new DeveloperError(`You can have up to ${MAX_APPS} apps. Delete one you don't use first.`, 409);

    const clientId = `zotify_app_${randomBytes(12).toString("hex")}`;
    const clientSecret = confidential ? secret("zotify_secret_") : null;

    db.prepare(`
        INSERT INTO oauth_apps (id, owner, name, description, homepage_url, redirect_uris, confidential, secret_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientId, owner, fields.name, fields.description, fields.homepageUrl, JSON.stringify(fields.redirectUris),
        confidential ? 1 : 0, clientSecret && sha256(clientSecret), Date.now());

    const { owner: _, ...app } = getApp(clientId)!;
    return { ...app, clientSecret };
}

/** Changes an app's name, description, homepage or redirect URIs. Whether it's confidential can't change */
export function updateApp(owner: string, clientId: string, input: Parameters<typeof appFields>[0]) {
    const app = ownApp(owner, clientId);
    const fields = appFields({ ...app, ...input });

    db.prepare("UPDATE oauth_apps SET name = ?, description = ?, homepage_url = ?, redirect_uris = ? WHERE id = ?")
        .run(fields.name, fields.description, fields.homepageUrl, JSON.stringify(fields.redirectUris), clientId);

    const { owner: _, ...updated } = getApp(clientId)!;
    return updated;
}

/** Deletes an app, signing everyone out of it */
export function deleteApp(owner: string, clientId: string) {
    ownApp(owner, clientId);

    transaction(() => {
        db.prepare("DELETE FROM oauth_grants WHERE app_id = ?").run(clientId);
        db.prepare("DELETE FROM oauth_codes WHERE app_id = ?").run(clientId);
        db.prepare("DELETE FROM oauth_apps WHERE id = ?").run(clientId);
    });
}

/** Replaces a confidential app's client secret; the old one stops working straight away */
export function resetAppSecret(owner: string, clientId: string) {
    const app = ownApp(owner, clientId);
    if (!app.confidential) throw new DeveloperError("Public apps don't have a client secret; they use PKCE.");

    const clientSecret = secret("zotify_secret_");
    db.prepare("UPDATE oauth_apps SET secret_hash = ? WHERE id = ?").run(sha256(clientSecret), clientId);
    return { clientSecret };
}

export function checkAppSecret(clientId: string, clientSecret: string) {
    const row = db.prepare("SELECT secret_hash FROM oauth_apps WHERE id = ?").get(clientId) as { secret_hash: string | null } | undefined;
    if (!row?.secret_hash) return false;
    return timingSafeEqual(Buffer.from(row.secret_hash, "hex"), Buffer.from(sha256(clientSecret), "hex"));
}

// Authorizing apps

/** An authorization code for the app to swap for tokens. Only works once, for a few minutes */
export function createAuthorizationCode(app: OAuthApp, email: string, scopes: Scope[], redirectUri: string, codeChallenge: string | null) {
    const code = randomBytes(32).toString("base64url");

    db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(Date.now());
    db.prepare(`
        INSERT INTO oauth_codes (code_hash, app_id, email, scopes, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sha256(code), app.clientId, email, joinScopes(scopes), redirectUri, codeChallenge, Date.now() + CODE_TTL_MS);

    return code;
}

/** Uses up an authorization code. Null if it doesn't exist, expired, or was given to a different app or redirect URI */
export function redeemAuthorizationCode(code: string, clientId: string, redirectUri: string | undefined) {
    const hash = sha256(code);
    const row = db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash) as
        { app_id: string, email: string, scopes: string, redirect_uri: string, code_challenge: string | null, expires_at: number } | undefined;

    // A code only works once, even when the attempt fails
    db.prepare("DELETE FROM oauth_codes WHERE code_hash = ?").run(hash);

    if (!row || row.expires_at < Date.now() || row.app_id !== clientId) return null;
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) return null;

    return { email: row.email, scopes: splitScopes(row.scopes), codeChallenge: row.code_challenge };
}

/** Whether a PKCE code_verifier matches the code_challenge it was sent with (S256 only) */
export function checkCodeVerifier(challenge: string, verifier: unknown) {
    if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

function tokenResponse(accessToken: string, refreshToken: string, scopes: Scope[]) {
    return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_MS / 1000,
        refresh_token: refreshToken,
        scope: joinScopes(scopes)
    };
}

/** Signs someone in to an app: a new access token and refresh token, in OAuth's token response format */
export function createGrant(clientId: string, email: string, scopes: Scope[]) {
    const accessToken = secret("zotify_at_");
    const refreshToken = secret("zotify_rt_");
    const now = Date.now();

    db.prepare(`
        INSERT INTO oauth_grants (app_id, email, scopes, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientId, email, joinScopes(scopes), sha256(accessToken), now + ACCESS_TTL_MS, sha256(refreshToken), now + REFRESH_TTL_MS, now);

    return tokenResponse(accessToken, refreshToken, scopes);
}

/**
 * Swaps a refresh token for new tokens; the old ones stop working. Asking for fewer scopes narrows the grant from then on.
 * Null if the refresh token isn't valid for this app
 */
export function refreshGrant(clientId: string, refreshToken: string, requested: Scope[] | null) {
    const grant = db.prepare("SELECT id, email, scopes, refresh_expires_at FROM oauth_grants WHERE refresh_hash = ? AND app_id = ?")
        .get(sha256(refreshToken), clientId) as { id: number, email: string, scopes: string, refresh_expires_at: number } | undefined;

    if (!grant || grant.refresh_expires_at < Date.now()) return null;

    const granted = splitScopes(grant.scopes);
    if (requested && !requested.every(scope => granted.includes(scope))) return "invalid_scope" as const;
    const scopes = requested ?? granted;

    const accessToken = secret("zotify_at_");
    const nextRefreshToken = secret("zotify_rt_");
    const now = Date.now();

    db.prepare(`
        UPDATE oauth_grants SET scopes = ?, access_hash = ?, access_expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?
    `).run(joinScopes(scopes), sha256(accessToken), now + ACCESS_TTL_MS, sha256(nextRefreshToken), now + REFRESH_TTL_MS, grant.id);

    return tokenResponse(accessToken, nextRefreshToken, scopes);
}

/** Revokes an access or refresh token (and the other half of its grant), or a PAT. Unknown tokens are ignored, per RFC 7009 */
export function revokeToken(token: string, clientId?: string) {
    const hash = sha256(token);

    if (token.startsWith("zotify_pat_")) {
        db.prepare("DELETE FROM api_tokens WHERE token_hash = ?").run(hash);
        return;
    }

    db.prepare(`DELETE FROM oauth_grants WHERE (access_hash = ? OR refresh_hash = ?) ${clientId ? "AND app_id = ?" : ""}`)
        .run(...[hash, hash, ...(clientId ? [clientId] : [])]);
}

/** The apps someone is signed in to, with the scopes they allowed and when each was last used */
export function listAuthorizations(email: string) {
    const rows = db.prepare(`
        SELECT a.id, a.name, a.description, a.homepage_url, g.scopes, MIN(g.created_at) AS created_at, MAX(g.last_used_at) AS last_used_at
        FROM oauth_grants g JOIN oauth_apps a ON a.id = g.app_id
        WHERE g.email = ? AND g.refresh_expires_at > ?
        GROUP BY a.id ORDER BY created_at DESC
    `).all(email, Date.now()) as { id: string, name: string, description: string | null, homepage_url: string | null, scopes: string, created_at: number, last_used_at: number | null }[];

    return rows.map(row => ({
        clientId: row.id,
        name: row.name,
        description: row.description,
        homepageUrl: row.homepage_url,
        scopes: splitScopes(row.scopes),
        authorizedAt: row.created_at,
        lastUsedAt: row.last_used_at
    }));
}

/** Whether someone is already signed in to an app with at least these scopes, so they needn't be asked again */
export function hasAuthorized(email: string, clientId: string, scopes: Scope[]) {
    const rows = db.prepare("SELECT scopes FROM oauth_grants WHERE email = ? AND app_id = ? AND refresh_expires_at > ?")
        .all(email, clientId, Date.now()) as { scopes: string }[];
    return rows.some(row => scopes.every(scope => splitScopes(row.scopes).includes(scope)));
}

/** Signs someone out of an app everywhere */
export function revokeAuthorization(email: string, clientId: string) {
    db.prepare("DELETE FROM oauth_grants WHERE email = ? AND app_id = ?").run(email, clientId);
}

// Using credentials

export interface TokenAuth {
    email: string;
    via: "token" | "oauth";
    scopes: Scope[];
    // Which PAT or OAuth app it is, for rate limits and logs
    credentialId: string;
}

/** Who a bearer token belongs to and what it may do. Null if it isn't valid, has expired, or its developer was removed */
export function resolveBearerToken(token: string): TokenAuth | null {
    const hash = sha256(token);
    const now = Date.now();

    if (token.startsWith("zotify_pat_")) {
        const row = db.prepare("SELECT id, email, scopes, expires_at, last_used_at FROM api_tokens WHERE token_hash = ?").get(hash) as
            { id: number, email: string, scopes: string, expires_at: number | null, last_used_at: number | null } | undefined;

        if (!row || (row.expires_at !== null && row.expires_at < now) || !isDeveloper(row.email)) return null;
        if (!row.last_used_at || now - row.last_used_at > LAST_USED_GRANULARITY_MS) {
            db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now, row.id);
        }

        return { email: row.email, via: "token", scopes: splitScopes(row.scopes), credentialId: `pat:${row.id}` };
    }

    if (token.startsWith("zotify_at_")) {
        const row = db.prepare("SELECT id, app_id, email, scopes, access_expires_at, last_used_at FROM oauth_grants WHERE access_hash = ?").get(hash) as
            { id: number, app_id: string, email: string, scopes: string, access_expires_at: number, last_used_at: number | null } | undefined;

        if (!row || row.access_expires_at < now) return null;
        if (!row.last_used_at || now - row.last_used_at > LAST_USED_GRANULARITY_MS) {
            db.prepare("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?").run(now, row.id);
        }

        return { email: row.email, via: "oauth", scopes: splitScopes(row.scopes), credentialId: `app:${row.app_id}:${row.email}` };
    }

    return null;
}
