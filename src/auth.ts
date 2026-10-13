import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cache } from "./cache.js";
import { codeDelivery, sendLoginCode } from "./email.js";

// Login codes are short-lived, and a few wrong guesses use one up
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
// How long someone must wait before asking for another code
const CODE_RESEND_MS = 30 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const EMAIL_DOMAIN = "uci.edu";

// UCInetIDs that can open the admin dashboard
const ADMIN_NET_IDS = ["imadden"];

export const ADMIN_EMAILS = ADMIN_NET_IDS.map(netId => `${netId}@${EMAIL_DOMAIN}`);

export function isAdmin(email: string) {
    return ADMIN_EMAILS.includes(email);
}

interface LoginCode {
    hash: string;
    expiresAt: number;
    createdAt: number;
    attempts: number;
}

interface Session {
    email: string;
    createdAt: number;
    expiresAt: number;
}

export class AuthError extends Error {
    status: number;

    constructor (message: string, status = 400) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * The UCI email for what someone typed: "panteater" or "panteater@uci.edu", in any case.
 * Null for anything else, including other domains
 */
export function emailForNetId(input: unknown): string | null {
    if (typeof input !== "string") return null;

    const value = input.trim().toLowerCase();
    const netId = value.endsWith(`@${EMAIL_DOMAIN}`) ? value.slice(0, -(EMAIL_DOMAIN.length + 1)) : value;

    return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(netId) ? `${netId}@${EMAIL_DOMAIN}` : null;
}

async function readLog<T>(key: "loginCodes" | "sessions"): Promise<Record<string, T>> {
    const log: Record<string, T & { expiresAt: number }> = (await cache.get([key])) ?? {};

    // Drop anything expired while we're here
    for (const [id, entry] of Object.entries(log)) {
        if (entry.expiresAt < Date.now()) delete log[id];
    }

    return log;
}

/** Makes a 6-digit login code and emails it (or prints it, without a Resend key). The cache only keeps a hash. Returns how it was delivered */
export async function requestLoginCode(email: string) {
    const codes = await readLog<LoginCode>("loginCodes");
    const existing = codes[email];

    if (existing && Date.now() - existing.createdAt < CODE_RESEND_MS) {
        const wait = Math.ceil((CODE_RESEND_MS - (Date.now() - existing.createdAt)) / 1000);
        throw new AuthError(`Please wait ${wait} seconds before asking for another code.`, 429);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

    codes[email] = {
        // Hashed with the email so a leaked cache file doesn't give away codes
        hash: sha256(`${email}:${code}`),
        createdAt: Date.now(),
        expiresAt: Date.now() + CODE_TTL_MS,
        attempts: 0
    };

    await cache.set(["loginCodes"], codes);

    try {
        await sendLoginCode(email, code, CODE_TTL_MS / 60000);
    } catch (error) {
        // Nobody got this code, so drop it and let them ask again right away
        delete codes[email];
        await cache.set(["loginCodes"], codes);

        console.error(`Could not send a login code to ${email}:`, error);
        throw new AuthError("Couldn't send the code. Please try again in a moment.", 502);
    }

    return codeDelivery;
}

/** Checks a login code and starts a session. Returns the session token for the cookie */
export async function verifyLoginCode(email: string, code: string) {
    const codes = await readLog<LoginCode>("loginCodes");
    const entry = codes[email];

    if (!entry) throw new AuthError("That code has expired. Please ask for a new one.");

    const expected = Buffer.from(entry.hash, "hex");
    const actual = Buffer.from(sha256(`${email}:${code.trim()}`), "hex");

    if (!timingSafeEqual(expected, actual)) {
        entry.attempts++;

        if (entry.attempts >= MAX_CODE_ATTEMPTS) {
            delete codes[email];
            await cache.set(["loginCodes"], codes);
            throw new AuthError("Too many wrong codes. Please ask for a new one.");
        }

        await cache.set(["loginCodes"], codes);
        throw new AuthError("That code isn't right. Please check it and try again.");
    }

    // A code only works once
    delete codes[email];
    await cache.set(["loginCodes"], codes);

    return createSession(email);
}

/** Starts a session for this email and returns its token, for the cookie */
export async function createSession(email: string) {
    const token = randomBytes(32).toString("base64url");
    const sessions = await readLog<Session>("sessions");

    // Only a hash of the token is stored, so the cache file can't be used to sign in
    sessions[sha256(token)] = { email, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
    await cache.set(["sessions"], sessions);

    return token;
}

export async function getSession(token: string | undefined): Promise<Session | null> {
    if (!token) return null;

    const session = (await readLog<Session>("sessions"))[sha256(token)];
    return session && session.expiresAt > Date.now() ? session : null;
}

export async function endSession(token: string | undefined) {
    if (!token) return;

    const sessions = await readLog<Session>("sessions");
    delete sessions[sha256(token)];
    await cache.set(["sessions"], sessions);
}
