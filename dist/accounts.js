import { readFile } from "node:fs/promises";
import { RockbotClient } from "./client.js";
import { cache } from "./cache.js";
export async function getAccounts() {
    return JSON.parse(await readFile(".accounts.json", "utf8"));
}
// One client per account for the life of the server, so tokens are reused instead of refreshed on every request
const clients = new Map();
export async function getLiveAccounts() {
    const accounts = await getAccounts();
    for (const account of accounts) {
        let client = clients.get(account.username);
        if (!client) {
            const accountData = await cache.get([account.username]);
            client = new RockbotClient({
                token: accountData?.token,
                refreshToken: account.refreshToken,
                key: account.key,
                debug: true
            });
            clients.set(account.username, client);
        }
        account.client = client;
    }
    return accounts;
}
// Each of these accounts only ever checks in at its own venue, so it stays checked in there and can always read that venue's queue
export const HOME_ACCOUNTS = {
    anteatery: "ant3eatery",
    brandywine: "brandy2wine"
};
/** The account that stays checked in at this venue */
export async function getHomeAccount(venue) {
    const account = (await getLiveAccounts()).find(account => account.username === HOME_ACCOUNTS[venue]);
    if (!account)
        throw new Error(`Home account "${HOME_ACCOUNTS[venue]}" for ${venue} is missing from .accounts.json`);
    return account;
}
/** Accounts that can search, queue and vote at this venue: everyone except the other venues' home accounts */
export async function getAccountsForVenue(venue) {
    const otherHomeAccounts = Object.entries(HOME_ACCOUNTS)
        .filter(([venueName]) => venueName !== venue)
        .map(([, username]) => username);
    return (await getLiveAccounts()).filter(account => !otherHomeAccounts.includes(account.username));
}
//# sourceMappingURL=accounts.js.map