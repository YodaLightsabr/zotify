import { getHomeAccount, getLiveAccounts, type VenueName } from "./accounts.js";
import type { QueueEntry } from "./client.js";
import { cache } from "./cache.js";
import { getRecentlyBoosted, getRecentlyQueued } from "./queued.js";
import { getVenueQueue, isFromZotify, queueEntries } from "./venueQueue.js";
import { castVotes, type VoteResult } from "./votes.js";

// An admin tool for meme songs nobody wants, like the Gummy Bear Song. These rules keep it from being used on anything with real support
export const ZOTIFY_DOWNVOTES = 6;
// Songs with positive karma (more upvotes than downvotes) are protected; neutral and negative ones aren't.
// Trolls can often get an upvote or two, so a raw upvote limit would protect them
// Someone outside Zotify has to have downvoted it first
const OUTSIDE_DOWNVOTES_NEEDED = 1;
// Picks never come back once played, so a day is plenty to remember them
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

interface DownvoteRecord {
    name: string;
    artist: string;
    by: string;
    downvotedAt: number;
    // Set when an admin overrode karma protection, with why and what the karma was
    override?: { reason: string, karma: number | null };
}

type DownvoteLog = Record<string, Record<string, DownvoteRecord>>;

export interface DownvoteCheck {
    allowed: boolean;
    // Why it isn't allowed, when it isn't
    reason: string | null;
    upvotes: number | null;
    downvotes: number | null;
    // Upvotes minus downvotes
    karma: number | null;
    outsideDownvotes: number | null;
    downvotedAt: number | null;
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

async function readLog(): Promise<DownvoteLog> {
    const log: DownvoteLog = (await cache.get(["downvoted"])) ?? {};
    const cutoff = Date.now() - RECORD_TTL_MS;

    for (const picks of Object.values(log)) {
        for (const [pickId, record] of Object.entries(picks)) {
            if (record.downvotedAt < cutoff) delete picks[pickId];
        }
    }

    return log;
}

// Two admins clicking at once shouldn't both get through before the record is saved
const inProgress = new Set<string>();

const refuse = (reason: string, counts: Partial<DownvoteCheck> = {}): DownvoteCheck =>
    ({ allowed: false, reason, upvotes: null, downvotes: null, karma: null, outsideDownvotes: null, downvotedAt: null, overridable: false, ...counts });

/** Whether Zotify may downvote this pick right now, checked against Rockbot's current votes */
export async function checkDownvote(venue: VenueName, pickId: string): Promise<DownvoteCheck & { entry?: QueueEntry }> {
    const record = (await readLog())[venue]?.[pickId];
    if (record) return refuse(`Already downvoted by ${record.by.replace(/@uci\.edu$/, "")}`, { downvotedAt: record.downvotedAt });
    if (inProgress.has(`${venue}:${pickId}`)) return refuse("Already being downvoted");

    const queue = await getVenueQueue(venue).queue;
    const entry = queueEntries(queue).find(entry => entry.pickId === pickId);
    if (!entry) return refuse("That song isn't in the queue anymore");

    const [queued, boosted] = await Promise.all([getRecentlyQueued(venue), getRecentlyBoosted(venue)]);
    if (isFromZotify(entry, queued)) return refuse("Zotify queued this song");
    if (boosted.some(song => song.pickId === pickId)) return refuse("Zotify boosted this song");

    // Fresh from Rockbot, not the queue cache, since votes change quickly
    const [{ upvoters, downvoters }, accounts] = await Promise.all([
        (await getHomeAccount(venue)).client[venue].fetchPickVotes(pickId),
        getLiveAccounts()
    ]);
    const ours = new Set(accounts.map(account => account.username.toLowerCase()));
    const outsideDownvotes = downvoters.filter(name => !ours.has(name.toLowerCase())).length;
    const karma = upvoters.length - downvoters.length;
    const counts = { upvotes: upvoters.length, downvotes: downvoters.length, karma, outsideDownvotes };

    if (upvoters.some(name => ours.has(name.toLowerCase()))) return refuse("Zotify accounts have upvoted it", counts);
    if (outsideDownvotes < OUTSIDE_DOWNVOTES_NEEDED) return refuse("Someone else needs to downvote it first", counts);

    // Upvotes usually mean real support, but coordinated groups can upvote their own griefing, so admins can override this one rule
    if (karma > 0) {
        return { ...refuse(`It has +${karma} karma (${upvoters.length} up, ${downvoters.length} down), so it's protected`, counts), overridable: true, entry };
    }

    return { allowed: true, reason: null, ...counts, downvotedAt: null, overridable: false, entry };
}

/**
 * Downvotes a pick from ZOTIFY_DOWNVOTES accounts, once, if every rule allows it. An admin can get past karma protection
 * (and only that) by giving a reason, which is recorded. Throws DownvoteRefusedError otherwise
 */
export async function downvotePick(venue: VenueName, pickId: string, adminEmail: string, overrideReason?: string): Promise<VoteResult> {
    const check = await checkDownvote(venue, pickId);
    const overriding = !check.allowed && check.overridable && !!overrideReason;

    if (!(check.allowed || overriding) || !check.entry) throw new DownvoteRefusedError(check);

    const key = `${venue}:${pickId}`;
    inProgress.add(key);

    try {
        const result = await castVotes(venue, pickId, check.entry, ZOTIFY_DOWNVOTES, "down");

        // Record it unless nothing at all went through, in which case it can be tried again
        if (result.confirmed !== 0 || !result.requested) {
            const log = await readLog();
            log[venue] = {
                ...log[venue],
                [pickId]: {
                    name: check.entry.name,
                    artist: check.entry.artist,
                    by: adminEmail,
                    downvotedAt: Date.now(),
                    ...(overriding ? { override: { reason: overrideReason!, karma: check.karma } } : {})
                }
            };
            await cache.set(["downvoted"], log);
        }

        const override = overriding ? ` (overrode +${check.karma} karma: "${overrideReason}")` : "";
        console.log(`${adminEmail} downvoted "${check.entry.name}" by ${check.entry.artist} at ${venue}${override}: ${result.confirmed ?? result.requested} of ${result.requested} downvotes`);
        return result;
    } finally {
        inProgress.delete(key);
    }
}
