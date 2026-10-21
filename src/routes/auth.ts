import type { NextFunction, Request, Response } from "express";
import { betaStatus, isApproved } from "../beta.js";
import { AuthError, endSession, getSession, isAdmin, isSiteAdmin, requestLoginCode, SESSION_TTL_MS, signInEmail, signInHint, verifyLoginCode } from "../auth.js";
import { isDeveloper, resolveBearerToken, type Scope } from "../developers.js";
import { getSchools } from "../schools.js";
import { requestSchool } from "./params.js";

const SESSION_COOKIE = "zotify_session";

function sessionToken(req: Request) {
    return tokenFromCookies(req.headers.cookie);
}

function tokenFromCookies(cookieHeader: string | undefined) {
    for (const part of (cookieHeader ?? "").split(";")) {
        const [name, ...value] = part.trim().split("=");
        if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
    }
}

function sendAuthError(res: Response, error: unknown, fallback: string) {
    if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    console.error(fallback, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

export function setSessionCookie(req: Request, res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.secure,
        maxAge: SESSION_TTL_MS,
        path: "/"
    });
}

/** The signed-in session for a Cookie header, e.g. from a socket's handshake */
export function sessionFromCookies(cookieHeader: string | undefined) {
    return getSession(tokenFromCookies(cookieHeader));
}

/** The signed-in session for a request's cookie, if there is one. Bearer tokens don't count; see authenticate */
export function currentSession(req: Request) {
    return getSession(sessionToken(req));
}

/** Who a request is from, and what it may do. Sessions (Zotify's own pages) may do anything their person can */
export interface Auth {
    email: string;
    via: "session" | "token" | "oauth";
    // Null for sessions, which aren't limited
    scopes: Scope[] | null;
}

// Requests per minute for each token or app sign-in. Sessions aren't limited, since they're Zotify's own pages
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, { start: number, count: number }>();

/** Counts a request against a credential's limit, setting the X-RateLimit headers. False once it's over */
function withinRateLimit(credentialId: string, res: Response) {
    const now = Date.now();
    let window = rateWindows.get(credentialId);

    if (!window || now - window.start >= RATE_WINDOW_MS) {
        // Forget idle credentials now and then, so the map doesn't grow forever
        if (rateWindows.size > 10_000) for (const [id, old] of rateWindows) if (now - old.start >= RATE_WINDOW_MS) rateWindows.delete(id);
        window = { start: now, count: 0 };
        rateWindows.set(credentialId, window);
    }

    window.count++;
    const reset = Math.ceil((window.start + RATE_WINDOW_MS) / 1000);
    res.set({ "X-RateLimit-Limit": String(RATE_LIMIT), "X-RateLimit-Remaining": String(Math.max(0, RATE_LIMIT - window.count)), "X-RateLimit-Reset": String(reset) });

    if (window.count <= RATE_LIMIT) return true;
    res.set("Retry-After", String(Math.max(1, reset - Math.floor(now / 1000))));
    return false;
}

/** An error in the API's format: { error, code } plus anything extra */
export function deny(res: Response, status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    res.status(status).json({ error: message, code, ...extra });
}

/**
 * Works out who a request is from: a bearer token in the Authorization header if there is one (a personal access token or an
 * OAuth access token), otherwise the session cookie. Puts it on res.locals.auth (and res.locals.session, which routes use for
 * the email). Answers the request itself and returns null when it can't go on: a bad token, or over the rate limit
 */
async function authenticate(req: Request, res: Response): Promise<Auth | null | undefined> {
    const header = req.headers.authorization;

    if (header !== undefined) {
        const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
        const auth = token ? resolveBearerToken(token) : null;

        if (!auth) {
            res.set("WWW-Authenticate", 'Bearer error="invalid_token"');
            deny(res, 401, "invalid_token", "That token isn't valid. It may have expired or been revoked.");
            return null;
        }

        if (!withinRateLimit(auth.credentialId, res)) {
            deny(res, 429, "rate_limited", `Slow down: each token can make ${RATE_LIMIT} requests a minute.`);
            return null;
        }

        res.locals.auth = { email: auth.email, via: auth.via, scopes: auth.scopes } satisfies Auth;
        res.locals.session = { email: auth.email };
        return res.locals.auth;
    }

    const session = await currentSession(req);
    if (!session) return undefined;

    res.locals.auth = { email: session.email, via: "session", scopes: null } satisfies Auth;
    res.locals.session = session;
    return res.locals.auth;
}

/** Whether this request's credentials include a scope. Sessions include every scope */
export const hasScope = (res: Response, scope: Scope) => {
    const scopes = (res.locals.auth as Auth | undefined)?.scopes;
    return !scopes || scopes.includes(scope);
};

type Check = (auth: Auth, req: Request, res: Response) => boolean | Promise<boolean>;

/** Builds a guard: signed in (by session or token), with the scope if one is given, and passing check if there is one */
function guard(scope: Scope | null, check?: Check) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const auth = await authenticate(req, res);
            if (auth === null) return;

            if (!auth) {
                deny(res, 401, "unauthorized", "Sign in required. Send a token in the Authorization header: Bearer <token>.");
                return;
            }

            if (scope && !hasScope(res, scope)) {
                res.set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${scope}"`);
                deny(res, 403, "insufficient_scope", `This needs the ${scope} scope.`, { scope });
                return;
            }

            if (check && !(await check(auth, req, res))) return;
            next();
        } catch (error) {
            next(error);
        }
    };
}

/** Signed in, with the scope if one is given. /v1/me needs no scope */
export const signedIn = (scope: Scope | null = null) => guard(scope);

/** Approved members of the request's school (see params.ts), its admins included. Signed-in people who aren't approved get a 403 */
export const member = (scope: Scope) => guard(scope, async (auth, _req, res) => {
    if (await isApproved(auth.email, requestSchool(res).id)) return true;
    deny(res, 403, "not_approved", `You're not in ${requestSchool(res).name}'s Zotify yet. It's in private beta.`, { notApproved: true });
    return false;
});

/** Admins of the request's school, which includes site admins. Tokens need the admin scope */
export const schoolAdmin = guard("admin", (auth, _req, res) => {
    if (isAdmin(auth.email, requestSchool(res).id)) return true;
    deny(res, 403, "forbidden", "Admins only");
    return false;
});

/** Admins of any school */
export const anyAdmin = guard("admin", (auth, _req, res) => {
    if (isSiteAdmin(auth.email) || getSchools().some(school => isAdmin(auth.email, school.id))) return true;
    deny(res, 403, "forbidden", "Admins only");
    return false;
});

/** Only Zotify's own pages, signed in with the session cookie: never a token. For credentials, sign-in consent and the like */
export const sessionOnly = guard(null, (auth, _req, res) => {
    if (auth.via === "session") return true;
    deny(res, 403, "session_required", "Only Zotify's own pages can do this, not tokens.");
    return false;
});

/** Developers, on Zotify's own pages: their tokens and apps */
export const developer = guard(null, (auth, _req, res) => {
    if (auth.via !== "session") {
        deny(res, 403, "session_required", "Only Zotify's own pages can manage tokens and apps.");
        return false;
    }

    if (isDeveloper(auth.email)) return true;
    deny(res, 403, "not_developer", "You're not a developer yet. Ask a site admin to add you.");
    return false;
});

/** Site admins, on Zotify's own pages: every school, venue and Rockbot account */
export const siteAdmin = guard(null, (auth, _req, res) => {
    if (auth.via === "session" && isSiteAdmin(auth.email)) return true;
    deny(res, 403, "forbidden", "Site admins only");
    return false;
});

/** Body: { netid }. Makes a login code for that ID (like a UCInetID, at the request's school) or email address */
export async function requestCode(req: Request, res: Response) {
    const school = requestSchool(res);
    const email = signInEmail(req.body?.netid, school);

    if (!email) {
        res.status(400).json({ error: signInHint(school) });
        return;
    }

    try {
        const delivery = await requestLoginCode(email);
        res.json({ email, delivery });
    } catch (error) {
        sendAuthError(res, error, `Error making a login code for ${email}:`);
    }
}

/** Body: { netid, code }. Signs in with a login code and sets the session cookie */
export async function verifyCode(req: Request, res: Response) {
    const email = signInEmail(req.body?.netid, requestSchool(res));
    const code = typeof req.body?.code === "string" ? req.body.code : "";

    if (!email || !/^\s*\d{6}\s*$/.test(code)) {
        res.status(400).json({ error: "Enter the 6-digit code we sent you." });
        return;
    }

    try {
        setSessionCookie(req, res, await verifyLoginCode(email, code));
        res.json({ email, approved: await isApproved(email, requestSchool(res).id) });
    } catch (error) {
        sendAuthError(res, error, `Error checking a login code for ${email}:`);
    }
}

/** Who's signed in: whether they're a site admin or developer, and where they stand at each school */
export async function me(_req: Request, res: Response) {
    const auth: Auth = res.locals.auth;

    res.json({
        email: auth.email,
        // Can manage every school, venue, Rockbot account and developer
        siteAdmin: isSiteAdmin(auth.email),
        developer: isDeveloper(auth.email),
        // What this request's credentials may do; null for Zotify's own pages, which may do anything
        scopes: auth.scopes,
        schools: await Promise.all(getSchools().map(async school => ({
            id: school.id,
            name: school.name,
            admin: isAdmin(auth.email, school.id),
            ...(await betaStatus(auth.email, school.id))
        })))
    });
}

export async function logout(req: Request, res: Response) {
    await endSession(sessionToken(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
}
