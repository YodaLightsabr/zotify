import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { cache } from "./cache.js";
import { codeDelivery, sendLoginCode, type CodeDelivery } from "./email.js";
import { isSchoolAdminEmail, type School } from "./schools.js";

// Login codes are short-lived, and a few wrong guesses use one up
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
// How long someone must wait before asking for another code
const CODE_RESEND_MS = 30 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Site admins run every school's Zotify: its schools, venues and Rockbot accounts, and each school's beta
export const SITE_ADMIN_EMAILS = ["imadden@uci.edu"];

export const isSiteAdmin = (email: string) => SITE_ADMIN_EMAILS.includes(email);

/** Whether someone can run this school's Zotify: site admins, and the school's own admins (added on the dashboard) */
export function isAdmin(email: string, schoolId: string) {
    return isSiteAdmin(email) || isSchoolAdminEmail(schoolId, email);
}

// Test accounts nobody reads the inbox of: their login codes always go to the server console, never by email
export const TEST_EMAILS = ["panteater@uci.edu"];

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
// Set this to false to only allow each school's own email domain
const ALLOW_ANY_EMAIL = true;

/**
 * The email someone signs in with at a school. A bare ID ("panteater") becomes panteater@uci.edu with the school's email domain,
 * in any case. Full addresses work for any domain while ALLOW_ANY_EMAIL is on, otherwise only the school's. Null for anything else
 */
export function signInEmail(input: unknown, school: Pick<School, "emailDomain">): string | null {
    if (typeof input !== "string") return null;

    const value = input.trim().toLowerCase();
    const domain = school.emailDomain;

    if (!value.includes("@")) return domain && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? `${value}@${domain}` : null;
    if (!ALLOW_ANY_EMAIL && (!domain || !value.endsWith(`@${domain}`))) return null;

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
        // Report the same delivery as anyone else would get, so the sign-in page doesn't reveal it's a test account
        return codeDelivery;
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

/** What to ask for when a school's sign-in field doesn't make sense, e.g. "Enter your UCInetID or email address, like panteater." */
export function signInHint(school: Pick<School, "emailDomain" | "idLabel" | "idPlaceholder">) {
    if (!school.emailDomain) return "Enter your email address.";

    const example = school.idPlaceholder ?? "you";
    return `Enter your ${school.idLabel ?? "ID"} or email address, like ${example} or ${example}@${school.emailDomain}.`;
}
