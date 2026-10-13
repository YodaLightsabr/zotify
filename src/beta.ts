import { createHash, randomBytes, randomInt } from "node:crypto";
import { ADMIN_EMAILS, AuthError, createSession, isAdmin } from "./auth.js";
import { cache } from "./cache.js";
import { sendRequestNotification, sendWelcomeEmail } from "./email.js";

// Zotify is invite-only during the beta. Admins are always in; everyone else needs to be on the whitelist ("members")

export const MAGIC_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAGIC_LINK_DAYS = MAGIC_LINK_TTL_MS / (24 * 60 * 60 * 1000);

// Invite codes avoid characters that are easy to mix up, like 0/O and 1/I
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export type JoinedVia = "request" | "invite" | "code";

export interface Member {
    joinedVia: JoinedVia;
    joinedAt: number;
    // The admin who approved or invited them, or the code they used
    approvedBy?: string;
    code?: string;
    // Silent invites don't send an email
    silent?: boolean;
}

export interface JoinRequest {
    status: "pending" | "approved" | "rejected";
    requestedAt: number;
    decidedAt?: number;
    decidedBy?: string;
}

export interface InviteCode {
    createdBy: string;
    createdAt: number;
    // Null means unlimited
    maxUses: number | null;
    revokedAt?: number;
    uses: { email: string, usedAt: number }[];
}

interface MagicLink {
    email: string;
    createdAt: number;
    expiresAt: number;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const readMembers = async (): Promise<Record<string, Member>> => (await cache.get(["members"])) ?? {};
const readRequests = async (): Promise<Record<string, JoinRequest>> => (await cache.get(["joinRequests"])) ?? {};
const readCodes = async (): Promise<Record<string, InviteCode>> => (await cache.get(["inviteCodes"])) ?? {};

async function readMagicLinks(): Promise<Record<string, MagicLink>> {
    const links: Record<string, MagicLink> = (await cache.get(["magicLinks"])) ?? {};
    for (const [hash, link] of Object.entries(links)) if (link.expiresAt < Date.now()) delete links[hash];
    return links;
}

export async function isApproved(email: string) {
    return isAdmin(email) || !!(await readMembers())[email];
}

/** Where someone stands, for the beta screen */
export async function betaStatus(email: string) {
    const approved = await isApproved(email);
    const request = (await readRequests())[email];
    return { approved, request: request ? { status: request.status, requestedAt: request.requestedAt } : null };
}

async function addMember(email: string, member: Member) {
    const members = await readMembers();

    // Keep however they first got in
    if (!members[email]) {
        members[email] = member;
        await cache.set(["members"], members);
    }

    // A pending request is settled by any other way in
    const requests = await readRequests();
    if (requests[email]?.status === "pending") {
        requests[email] = { ...requests[email], status: "approved", decidedAt: Date.now(), decidedBy: member.approvedBy ?? member.code };
        await cache.set(["joinRequests"], requests);
    }
}

/** A one-time link that signs this person in. Only a hash is stored */
async function createMagicLink(email: string, baseUrl: string) {
    const token = randomBytes(32).toString("base64url");
    const links = await readMagicLinks();

    links[sha256(token)] = { email, createdAt: Date.now(), expiresAt: Date.now() + MAGIC_LINK_TTL_MS };
    await cache.set(["magicLinks"], links);

    return `${baseUrl}/login/magic?${new URLSearchParams({ token })}`;
}

/** Uses up a magic link and starts a session for its owner. Returns the session token */
export async function redeemMagicLink(token: string) {
    const links = await readMagicLinks();
    const link = links[sha256(token)];

    if (!link) throw new AuthError("That sign-in link has expired or was already used. Sign in with your UCInetID instead.");

    // A link only works once
    delete links[sha256(token)];
    await cache.set(["magicLinks"], links);

    return { email: link.email, token: await createSession(link.email) };
}

// Requests

/** Asks to join, once. Emails the admins */
export async function requestInvite(email: string, baseUrl: string) {
    if (await isApproved(email)) throw new AuthError("You're already in.", 409);

    const requests = await readRequests();
    if (requests[email]) throw new AuthError("You've already asked for an invitation.", 409);

    requests[email] = { status: "pending", requestedAt: Date.now() };
    await cache.set(["joinRequests"], requests);

    // The request is saved either way; a failed notification just gets logged
    await Promise.all(ADMIN_EMAILS.map(admin => sendRequestNotification(admin, email, `${baseUrl}/admin`)
        .catch(error => console.error(`Could not tell ${admin} about ${email}'s request:`, error))));

    return requests[email];
}

export async function decideRequest(email: string, decision: "approved" | "rejected", adminEmail: string, baseUrl: string) {
    const requests = await readRequests();
    const request = requests[email];

    if (!request) throw new AuthError("There's no request from that account.", 404);
    if (request.status !== "pending") throw new AuthError(`That request was already ${request.status}.`, 409);

    if (decision === "rejected") {
        requests[email] = { ...request, status: "rejected", decidedAt: Date.now(), decidedBy: adminEmail };
        await cache.set(["joinRequests"], requests);
        return { emailed: false };
    }

    await addMember(email, { joinedVia: "request", joinedAt: Date.now(), approvedBy: adminEmail });
    return { emailed: await welcome(email, "approved", baseUrl) };
}

/** Sends the "you're in" email with a magic link. Approval stands even if the email fails */
async function welcome(email: string, reason: "invited" | "approved", baseUrl: string) {
    try {
        await sendWelcomeEmail(email, await createMagicLink(email, baseUrl), reason, MAGIC_LINK_DAYS);
        return true;
    } catch (error) {
        console.error(`Could not email ${email} that they're in:`, error);
        return false;
    }
}

// Admin invites

/** Adds someone to the whitelist. Unless silent, emails them a magic link */
export async function inviteMember(email: string, adminEmail: string, silent: boolean, baseUrl: string) {
    if (await isApproved(email)) throw new AuthError(`${email} is already in.`, 409);

    await addMember(email, { joinedVia: "invite", joinedAt: Date.now(), approvedBy: adminEmail, silent });
    return { emailed: silent ? false : await welcome(email, "invited", baseUrl) };
}

// Invite codes

export function normalizeCode(input: unknown) {
    return typeof input === "string" ? input.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

export async function createInviteCode(adminEmail: string, maxUses: number | null) {
    const codes = await readCodes();
    let code: string;

    do {
        code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (codes[code]);

    codes[code] = { createdBy: adminEmail, createdAt: Date.now(), maxUses, uses: [] };
    await cache.set(["inviteCodes"], codes);
    return code;
}

export async function revokeInviteCode(code: string, adminEmail: string) {
    const codes = await readCodes();
    const invite = codes[normalizeCode(code)];

    if (!invite) throw new AuthError("There's no such invite code.", 404);
    if (!invite.revokedAt) {
        invite.revokedAt = Date.now();
        await cache.set(["inviteCodes"], codes);
        console.log(`${adminEmail} revoked invite code ${normalizeCode(code)}`);
    }
}

/** Lets someone in with an invite code, and records the use. Already-approved people don't use one up */
export async function redeemInviteCode(email: string, input: unknown) {
    const code = normalizeCode(input);
    const codes = await readCodes();
    const invite = codes[code];

    if (!invite || invite.revokedAt) throw new AuthError("That invite code isn't valid.", 404);
    if (await isApproved(email)) return { alreadyApproved: true };
    if (invite.maxUses !== null && invite.uses.length >= invite.maxUses) throw new AuthError("That invite code has been used up.", 410);

    invite.uses.push({ email, usedAt: Date.now() });
    await cache.set(["inviteCodes"], codes);
    await addMember(email, { joinedVia: "code", joinedAt: Date.now(), code });

    return { alreadyApproved: false };
}

/** Everything the admin dashboard shows */
export async function betaOverview() {
    const [members, requests, codes] = await Promise.all([readMembers(), readRequests(), readCodes()]);

    return {
        admins: ADMIN_EMAILS,
        members: Object.entries(members).map(([email, member]) => ({ email, ...member })).sort((a, b) => b.joinedAt - a.joinedAt),
        requests: Object.entries(requests).map(([email, request]) => ({ email, ...request })).sort((a, b) => b.requestedAt - a.requestedAt),
        codes: Object.entries(codes).map(([code, invite]) => ({ code, ...invite })).sort((a, b) => b.createdAt - a.createdAt)
    };
}
