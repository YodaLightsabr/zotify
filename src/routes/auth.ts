import type { NextFunction, Request, Response } from "express";
import { betaStatus, isApproved } from "../beta.js";
import { AuthError, emailForNetId, endSession, getSession, isAdmin, requestLoginCode, SESSION_TTL_MS, verifyLoginCode } from "../auth.js";

const SESSION_COOKIE = "zotify_session";

function sessionToken(req: Request) {
    for (const part of (req.headers.cookie ?? "").split(";")) {
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

/** The signed-in session for a request, if there is one */
export function currentSession(req: Request) {
    return getSession(sessionToken(req));
}

/** Lets a request through only with a signed-in session, which is put on res.locals.session */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const session = await currentSession(req);

    if (!session) {
        res.status(401).json({ error: "Sign in required" });
        return;
    }

    res.locals.session = session;
    next();
}

/** Lets a request through only for approved members (admins included). Signed-in people who aren't approved get a 403 */
export async function requireMember(req: Request, res: Response, next: NextFunction) {
    const session = await currentSession(req);

    if (!session) {
        res.status(401).json({ error: "Sign in required" });
        return;
    }

    if (!(await isApproved(session.email))) {
        res.status(403).json({ error: "Zotify is in private beta", notApproved: true });
        return;
    }

    res.locals.session = session;
    next();
}

/** Lets a request through only for admins */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const session = await currentSession(req);

    if (!session) {
        res.status(401).json({ error: "Sign in required" });
        return;
    }

    if (!isAdmin(session.email)) {
        res.status(403).json({ error: "Admins only" });
        return;
    }

    res.locals.session = session;
    next();
}

/** Body: { netid }. Makes a login code for that UCInetID */
export async function requestCode(req: Request, res: Response) {
    const email = emailForNetId(req.body?.netid);

    if (!email) {
        res.status(400).json({ error: "Enter your UCInetID, like panteater or panteater@uci.edu." });
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
    const email = emailForNetId(req.body?.netid);
    const code = typeof req.body?.code === "string" ? req.body.code : "";

    if (!email || !/^\s*\d{6}\s*$/.test(code)) {
        res.status(400).json({ error: "Enter the 6-digit code we sent you." });
        return;
    }

    try {
        setSessionCookie(req, res, await verifyLoginCode(email, code));
        res.json({ email, approved: await isApproved(email) });
    } catch (error) {
        sendAuthError(res, error, `Error checking a login code for ${email}:`);
    }
}

/** The signed-in user, or 401 */
export async function me(req: Request, res: Response) {
    const session = await getSession(sessionToken(req));

    if (!session) {
        res.status(401).json({ error: "Not signed in" });
        return;
    }

    res.json({ email: session.email, admin: isAdmin(session.email), ...(await betaStatus(session.email)) });
}

export async function logout(req: Request, res: Response) {
    await endSession(sessionToken(req));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
}
