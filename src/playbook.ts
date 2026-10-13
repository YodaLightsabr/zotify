import type { AccountWithClient } from "./accounts.js";
import { Pick, RockbotClient, Song, type Venue } from "./client.js";
import { clearPickLimited, getPickLimited, markPickLimited } from "./pickLimits.js";


class Playbook {
    static Operation = class Operation<T extends Record<string, any> | undefined> {
        accounts: AccountWithClient[];
        params: T;

        constructor (accounts: AccountWithClient[], params: T) {
            this.accounts = accounts;
            this.params = params;
        }

        async run (): Promise<any> {
            return null;
        }
    }
}

export class QueueSongs extends Playbook.Operation<{ songs: string[], venue: "anteatery" | "brandywine" }> {
    async run () {
        const songs = this.params.songs;
        const venueName = this.params.venue;
        let skips = 0;

        const picks = [];

        const pickLimitsReached: string[] = [];

        try {
            let accountNumber = 0;
            for (let i = 0; i < songs.length; i++) {
                const account = this.accounts[accountNumber % this.accounts.length];
                accountNumber++;

                if (pickLimitsReached.includes(account.username)) {
                    i--;
                    continue;
                }

                const venue = account.client[venueName];
                await venue.checkIn();
                const results = await venue.search({ query: songs[i] });

                const song = results[0];

                try {
                    const pick = await song.request({ venue });

                    picks.push(pick);
                } catch (error) {
                    if (error instanceof RockbotClient.Errors.PickLimitReachedError) {
                        pickLimitsReached.push(account.username);
                        i--;
                        continue;
                    }
                }
            }
        } catch (error) {
            console.error(`Error occurred while running queue:`, error);
        }

        for (const { id, song, venue } of picks) {
            for (const account of this.accounts) {
                const pick = new Pick(account.client, id, { song, venue });

                await pick.vote();
            }
        }
    }
}

export class SearchSongs extends Playbook.Operation<{ query: string, venue: "anteatery" | "brandywine" }> {
    async run () {
        const account = this.accounts[0];
        const venue = account.client[this.params.venue];
        await venue.checkIn();

        const results = await venue.search({ query: this.params.query });

        return results;
    }
}

export class QueueSong extends Playbook.Operation<{ song: { id: string, name: string, artist: string }, venue: "anteatery" | "brandywine" }> {
    async run () {
        const venueName = this.params.venue;

        // Shuffle once up front so each account is tried at most once
        const shuffled = [...this.accounts];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Accounts that recently hit their pick limit go last, oldest hit first, in case the limit has reset
        const pickLimited = await getPickLimited(venueName);
        const available = shuffled.filter(account => !(account.username in pickLimited));
        const limited = shuffled
            .filter(account => account.username in pickLimited)
            .sort((a, b) => pickLimited[a.username] - pickLimited[b.username]);
        const order = [...available, ...limited];

        let pick: Pick | undefined;
        let lastError: unknown;

        for (const account of order) {
            const venue = account.client[venueName];
            const song = new Song(account.client, this.params.song.id, this.params.song);

            try {
                await venue.checkIn();
                pick = await song.request({ venue });

                if (account.username in pickLimited) {
                    await clearPickLimited(venueName, account.username).catch(error => console.error(`Could not clear pick limit for ${account.username}:`, error));
                }

                break;
            } catch (error) {
                // Every account would hit the same repeat limit, so don't bother trying the rest
                if (error instanceof RockbotClient.Errors.RepeatLimitReachedError) throw error;

                if (error instanceof RockbotClient.Errors.PickLimitReachedError) {
                    await markPickLimited(venueName, account.username).catch(error => console.error(`Could not record pick limit for ${account.username}:`, error));
                }

                console.error(`Account ${account.username} could not queue song:`, error);
                lastError = error;
            }
        }

        if (!pick) throw lastError ?? new RockbotClient.Errors.SongQueueError("No accounts available");

        // Voting is a separate step (castVotes, via /api/vote), so the page can show progress for each
        return pick;
    }
}
