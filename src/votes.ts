import { setTimeout as sleep } from "node:timers/promises";
import { getAccountsForVenue, getHomeAccount, rockbotVenue, type AccountWithClient, type VenueName } from "./accounts.js";
import { Pick, Song, type QueueEntry } from "./client.js";

// How often Zotify's picks in the queue get their votes topped up
export const REVOTE_INTERVAL_MS = 5 * 60 * 1000;
// Rockbot's list of who voted can lag a moment behind the votes themselves
const VERIFY_DELAY_MS = 1500;
// After the first round of votes, how many more times missing votes are re-sent
const VOTE_RETRIES = 2;

export interface VoteResult {
    // How many accounts were asked to vote (accounts that had already voted are skipped)
    requested: number;
    // How many of our accounts had already voted before this, or null if that couldn't be checked
    alreadyVoted: number | null;
    // How many of them Rockbot lists as having voted, or null if the list couldn't be checked
    confirmed: number | null;
    // Accounts still missing from Rockbot's list after every retry
    missing: string[];
}

type VoteSong = { name: string, artist: string, songId?: string };

export type VoteDirection = "up" | "down";

// When each pick last had votes sent, keyed by venue and pick ID
const lastVoted = new Map<string, number>();

const key = (venue: VenueName, pickId: string) => `${venue}:${pickId}`;

/** Records that a pick just had votes sent, so the periodic top-up leaves it alone for a while */
export function markVoted(venue: VenueName, pickId: string) {
    lastVoted.set(key(venue, pickId), Date.now());
}

/** How many accounts should vote: a positive count is exact, a negative one is "all but that many", and no count means all of them */
export function resolveVoteCount(count: number | undefined, available: number) {
    if (count === undefined) return available;

    const wanted = count < 0 ? available + count : count;
    return Math.max(0, Math.min(available, Math.trunc(wanted)));
}

function shuffle<T>(items: T[]) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** Each account checks in and votes on the pick. Failures are logged; the check afterwards decides what to retry */
async function voteWith(accounts: AccountWithClient[], venue: VenueName, pickId: string, song: VoteSong, direction: VoteDirection) {
    const votes = await Promise.allSettled(accounts.map(async account => {
        const accountVenue = rockbotVenue(account.client, venue);
        const pickSong = new Song(account.client, song.songId ?? "", song);

        await accountVenue.checkIn();
        await new Pick(account.client, pickId, { song: pickSong, venue: accountVenue }).vote(direction);
    }));

    votes.forEach((vote, i) => {
        if (vote.status === "rejected") console.error(`Account ${accounts[i].username} could not vote for "${song.name}":`, vote.reason);
    });
}

/**
 * Votes on a pick (up by default) from accounts allowed at this venue, then uses the venue's home account to check
 * Rockbot's list of who voted, re-sending any votes that didn't land. count picks how many accounts vote (see resolveVoteCount).
 */
export async function castVotes(venue: VenueName, pickId: string, song: VoteSong, count?: number, direction: VoteDirection = "up"): Promise<VoteResult> {
    const capacity = await getVoteCapacity(venue, pickId, direction)
        .catch(error => (console.error(`Could not check existing votes for "${song.name}":`, error), null));

    // Accounts that already voted don't need to again, so count is out of the ones that haven't.
    // If the existing votes couldn't be read, every account is a candidate; voting again is harmless
    const candidates = capacity?.remaining ?? await getAccountsForVenue(venue);
    const voters = shuffle(candidates).slice(0, resolveVoteCount(count, candidates.length));
    const alreadyVoted = capacity ? capacity.voted : null;

    if (!voters.length) return { requested: 0, alreadyVoted, confirmed: 0, missing: [] };

    // The home account stays checked in here, so it can always read the pick's votes
    const checker = rockbotVenue((await getHomeAccount(venue)).client, venue);
    let pending = voters;
    let verified = false;

    for (let round = 0; round <= VOTE_RETRIES && pending.length; round++) {
        if (round > 0) console.warn(`Re-sending ${pending.length} missing vote(s) for "${song.name}": ${pending.map(a => a.username).join(", ")}`);

        await voteWith(pending, venue, pickId, song, direction);
        await sleep(VERIFY_DELAY_MS);

        const votes = await checker.fetchPickVotes(pickId)
            .catch(error => (console.error(`Could not check votes for "${song.name}":`, error), null));

        // Without the list there's no telling which votes landed, so stop rather than vote blindly
        if (!votes) {
            verified = false;
            break;
        }

        const landed = new Set((direction === "up" ? votes.upvoters : votes.downvoters).map(name => name.toLowerCase()));
        pending = voters.filter(account => !landed.has(account.username.toLowerCase()));
        verified = true;
    }

    if (verified && pending.length) {
        console.error(`Votes for "${song.name}" still missing after ${VOTE_RETRIES} retries: ${pending.map(a => a.username).join(", ")}`);
    }

    return {
        requested: voters.length,
        alreadyVoted,
        confirmed: verified ? voters.length - pending.length : null,
        missing: verified ? pending.map(account => account.username) : []
    };
}

/**
 * How many of our accounts allowed at this venue have voted on a pick in this direction, and which could still add a vote.
 * Read with the venue's home account, which always stays checked in there
 */
export async function getVoteCapacity(venue: VenueName, pickId: string, direction: VoteDirection = "up") {
    const [eligible, home] = await Promise.all([getAccountsForVenue(venue), getHomeAccount(venue)]);
    const { upvoters, downvoters } = await rockbotVenue(home.client, venue).fetchPickVotes(pickId);
    const voted = new Set((direction === "up" ? upvoters : downvoters).map(name => name.toLowerCase()));
    const remaining = eligible.filter(account => !voted.has(account.username.toLowerCase()));

    return { total: eligible.length, voted: eligible.length - remaining.length, available: remaining.length, remaining };
}

/** Re-sends votes for any of these picks that haven't had votes sent recently. Runs in the background and never throws */
export function refreshVotes(venue: VenueName, entries: QueueEntry[]) {
    const now = Date.now();

    // Forget picks that are long gone from the queue
    for (const [pickKey, time] of lastVoted) {
        if (now - time > 12 * REVOTE_INTERVAL_MS) lastVoted.delete(pickKey);
    }

    for (const entry of entries) {
        const last = lastVoted.get(key(venue, entry.pickId));
        if (last !== undefined && now - last < REVOTE_INTERVAL_MS) continue;

        // Mark before voting so overlapping queue loads don't vote twice
        markVoted(venue, entry.pickId);
        castVotes(venue, entry.pickId, entry)
            .catch(error => console.error(`Could not refresh votes for "${entry.name}":`, error));
    }
}
