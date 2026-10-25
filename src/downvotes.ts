import { getAccountsForVenue, getHomeAccount, getLiveAccounts, rockbotVenue, type VenueName } from "./accounts.js";
import type { QueueEntry } from "./client.js";
import { cache } from "./cache.js";
import { getRecentlyBoosted, getRecentlyQueued } from "./queued.js";
import { getVenueQueue, isFromZotify, queueEntries } from "./venueQueue.js";
import { castVotes, type VoteResult } from "./votes.js";

// An admin tool for meme songs nobody wants, like the Gummy Bear Song. These rules keep it from being used on anything with real support.
// Zotify adds at most this many downvotes to a pick in all. Admins add as few as will do, and more later if they need to
export const ZOTIFY_DOWNVOTES = 6;
// Songs with positive karma (more upvotes than downvotes) are protected; neutral and negative ones aren't.
// Trolls can often get an upvote or two, so a raw upvote limit would protect them.
// Nobody else has to have downvoted it first: admins asked to act on meme songs (like Swans) the moment they're queued
// Picks never come back once played, so a day is plenty to remember them
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

// Who downvoted what, and why when they overrode karma protection: each time, since a pick can be downvoted more than once
interface DownvoteRecord {
    pickId: string;
    name: string;
    artist: string;
    by: string;
    count: number;
    downvotedAt: number;
    override?: { reason: string, karma: number | null };
}

export interface DownvoteCheck {
    allowed: boolean;
    // Why it isn't allowed, when it isn't
    reason: string | null;
    upvotes: number | null;
    downvotes: number | null;
    // Upvotes minus downvotes
    karma: number | null;
    // Downvotes from people outside Zotify, for information
    outsideDownvotes: number | null;
    // Downvotes Zotify has added already
    zotifyDownvotes: number | null;
    // How many more Zotify can add now: what's left of ZOTIFY_DOWNVOTES, among accounts that haven't downvoted it
    count: number;
    // True when karma protection is the only thing in the way, so an admin can override it with a reason
    overridable: boolean;
}

export class DownvoteRefusedError extends Error {
    check: DownvoteCheck;

    constructor (check: DownvoteCheck) {
        super(check.reason ?? "This song can't be downvoted");
        this.name = "DownvoteRefusedError";
        this.check = check;
    }
}

/** Adds a downvote to the record, dropping ones from more than a day ago */
async function record(entry: DownvoteRecord, venue: VenueName) {
    const log: Record<string, DownvoteRecord[]> = (await cache.get(["downvoted"])) ?? {};
    const cutoff = Date.now() - RECORD_TTL_MS;
    // Records from before a pick could be downvoted more than once were one object per pick, not a list
    const kept = Array.isArray(log[venue]) ? log[venue].filter(old => old.downvotedAt >= cutoff) : [];

    log[venue] = [...kept, entry];
    await cache.set(["downvoted"], log);
}

// Two admins clicking at once shouldn't both get through before Rockbot shows the first one's downvotes
const inProgress = new Set<string>();

const refuse = (reason: string, counts: Partial<DownvoteCheck> = {}): DownvoteCheck =>
    ({ allowed: false, reason, upvotes: null, downvotes: null, karma: null, outsideDownvotes: null, zotifyDownvotes: null, count: 0, overridable: false, ...counts });

/** Whether Zotify may downvote this pick right now, and how many more times, checked against Rockbot's current votes */
export async function checkDownvote(venue: VenueName, pickId: string): Promise<DownvoteCheck & { entry?: QueueEntry }> {
    if (inProgress.has(`${venue}:${pickId}`)) return refuse("It's being downvoted right now");

    const queue = await getVenueQueue(venue).queue;
    const entry = queueEntries(queue).find(entry => entry.pickId === pickId);
    if (!entry) return refuse("That song isn't in the queue anymore");

    const [queued, boosted] = await Promise.all([getRecentlyQueued(venue), getRecentlyBoosted(venue)]);
    if (isFromZotify(entry, queued)) return refuse("Zotify queued this song");
    if (boosted.some(song => song.pickId === pickId)) return refuse("Zotify boosted this song");

    // Fresh from Rockbot, not the queue cache, since votes change quickly
    const [{ upvoters, downvoters }, accounts, eligible] = await Promise.all([
        rockbotVenue((await getHomeAccount(venue)).client, venue).fetchPickVotes(pickId),
        getLiveAccounts(),
        getAccountsForVenue(venue)
    ]);
    const ours = new Set(accounts.map(account => account.username.toLowerCase()));
    const downvoted = new Set(downvoters.map(name => name.toLowerCase()));
    const zotifyDownvotes = downvoters.filter(name => ours.has(name.toLowerCase())).length;
    const karma = upvoters.length - downvoters.length;

    // What's left of the cap, among this venue's accounts that haven't downvoted it yet
    const left = eligible.filter(account => !downvoted.has(account.username.toLowerCase())).length;
    const count = Math.max(0, Math.min(ZOTIFY_DOWNVOTES - zotifyDownvotes, left));
    const counts = { upvotes: upvoters.length, downvotes: downvoters.length, karma, outsideDownvotes: downvoters.length - zotifyDownvotes, zotifyDownvotes, count };

    if (upvoters.some(name => ours.has(name.toLowerCase()))) return refuse("Zotify accounts have upvoted it", counts);
    if (!count) return refuse(`Zotify has added ${zotifyDownvotes} downvotes, the most it will`, counts);

    // Upvotes usually mean real support, but coordinated groups can upvote their own griefing, so admins can override this one rule
    if (karma > 0) {
        return { ...refuse(`It has +${karma} karma (${upvoters.length} up, ${downvoters.length} down), so it's protected`, counts), overridable: true, entry };
    }

    return { allowed: true, reason: null, ...counts, overridable: false, entry };
}

/**
 * Downvotes a pick with count more of Zotify's accounts, if every rule allows it, up to ZOTIFY_DOWNVOTES in all; asking for more
 * than are left adds what's left. An admin can get past karma protection (and only that) by giving a reason, which is recorded.
 * Throws DownvoteRefusedError otherwise
 */
export async function downvotePick(venue: VenueName, pickId: string, adminEmail: string, overrideReason?: string, count?: number): Promise<VoteResult> {
    const check = await checkDownvote(venue, pickId);
    const overriding = !check.allowed && check.overridable && !!overrideReason;

    if (!(check.allowed || overriding) || !check.entry) throw new DownvoteRefusedError(check);

    const key = `${venue}:${pickId}`;
    inProgress.add(key);

    try {
        const result = await castVotes(venue, pickId, check.entry, Math.min(Math.max(1, count ?? check.count), check.count), "down");

        if (result.requested) {
            await record({
                pickId,
                name: check.entry.name,
                artist: check.entry.artist,
                by: adminEmail,
                count: result.confirmed ?? result.requested,
                downvotedAt: Date.now(),
                ...(overriding ? { override: { reason: overrideReason!, karma: check.karma } } : {})
            }, venue);
        }

        const override = overriding ? ` (overrode +${check.karma} karma: "${overrideReason}")` : "";
        console.log(`${adminEmail} downvoted "${check.entry.name}" by ${check.entry.artist} at ${venue}${override}: ${result.confirmed ?? result.requested} of ${result.requested} downvotes`);
        return result;
    } finally {
        inProgress.delete(key);
    }
}
