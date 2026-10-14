import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cache } from "./cache.js";
import { codeDelivery, sendLoginCode, type CodeDelivery } from "./email.js";

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

// Test accounts nobody reads the inbox of: their login codes always go to the server console, never by email
const TEST_NET_IDS = ["panteater"];

export const TEST_EMAILS = TEST_NET_IDS.map(netId => `${netId}@${EMAIL_DOMAIN}`);

export const isTestAccount = (email: string) => TEST_EMAILS.includes(email);

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

// During the testing phase anyone can sign in with any email address; approval still decides who gets in.
// Set this to false to go back to UCI accounts only
const ALLOW_ANY_EMAIL = true;

/**
 * The email someone signs in with. A bare UCInetID ("panteater") becomes panteater@uci.edu, in any case.
 * Full addresses work for any domain while ALLOW_ANY_EMAIL is on, otherwise only @uci.edu. Null for anything else
 */
export function signInEmail(input: unknown): string | null {
    if (typeof input !== "string") return null;

    const value = input.trim().toLowerCase();

    if (!value.includes("@")) return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? `${value}@${EMAIL_DOMAIN}` : null;
    if (!ALLOW_ANY_EMAIL && !value.endsWith(`@${EMAIL_DOMAIN}`)) return null;

    // A light check: one @, no spaces, a dot in the domain, and a sensible length
    return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
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
export async function requestLoginCode(email: string): Promise<CodeDelivery> {
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

    if (isTestAccount(email)) {
        console.log(`Login code for test account ${email}: ${code}`);
        return "console";
    }

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

/** Whether each test account has a login code waiting, for the admin dashboard. Codes are hashed, so this never includes the code itself */
export async function testAccountCodes() {
    const codes = await readLog<LoginCode>("loginCodes");

    return TEST_EMAILS.map(email => {
        const code = codes[email];
        return { email, activeCode: code ? { createdAt: code.createdAt, expiresAt: code.expiresAt, attempts: code.attempts } : null };
    });
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
