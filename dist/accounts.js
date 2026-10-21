import { createHash } from "node:crypto";
import { RockbotClient } from "./client.js";
import { cache } from "./cache.js";
import { db } from "./db.js";
import { getVenue, getVenues } from "./schools.js";
export function getAccounts() {
    return db.prepare("SELECT * FROM rockbot_accounts ORDER BY username").all().map(row => ({
        username: row.username,
        email: row.email,
        refreshToken: row.refresh_token,
        key: row.key,
        ...(row.password ? { password: row.password } : {})
    }));
}
// One client per account for the life of the server, so tokens are reused instead of refreshed on every request.
// An account whose refresh token or key is changed in the dashboard gets a new client
const clients = new Map();
export async function getLiveAccounts() {
    const accounts = getAccounts();
    for (const account of accounts) {
        let entry = clients.get(account.username);
        if (!entry || entry.refreshToken !== account.refreshToken || entry.key !== account.key) {
            const accountData = await cache.get([account.username]);
            entry = {
                client: new RockbotClient({
                    // A changed account starts fresh, since the saved token belonged to the old credentials
                    token: entry ? undefined : accountData?.token,
                    refreshToken: account.refreshToken,
                    key: account.key,
                    debug: true
                }),
                refreshToken: account.refreshToken,
                key: account.key
            };
            clients.set(account.username, entry);
        }
        account.client = entry.client;
    }
    return accounts;
}
/** A venue on Rockbot, for this account's client */
export function rockbotVenue(client, venueName) {
    const venue = getVenue(venueName);
    if (!venue)
        throw new Error(`There's no venue called ${venueName}`);
    return client.venue(venue.rockbotId, venue.name);
}
// Usernames that are some venue's home account, so they stay checked in there
const homeAccounts = () => new Set(getVenues().map(venue => venue.homeAccount).filter(Boolean));
/**
 * The account that reads this venue's queue and votes: its home account, which only ever checks in there, when it has one.
 * Otherwise one of the shared accounts, the same one each time, which checks in before reading
 */
export async function getHomeAccount(venue) {
    const accounts = await getLiveAccounts();
    const home = getVenue(venue)?.homeAccount;
    const dedicated = home ? accounts.find(account => account.username === home) : undefined;
    if (dedicated)
        return dedicated;
    if (home)
        console.warn(`Home account "${home}" for ${venue} isn't one of Zotify's Rockbot accounts; using a shared one`);
    const reserved = homeAccounts();
    const shared = accounts.filter(account => !reserved.has(account.username));
    if (!shared.length)
        throw new Error(`There are no Rockbot accounts to read ${venue}'s queue with`);
    // Spread venues across the shared accounts, so two venues don't keep checking the same account in and out
    const index = createHash("sha256").update(venue).digest().readUInt32BE(0) % shared.length;
    return shared[index];
}
/** Accounts that can search, queue and vote at this venue: everyone except other venues' home accounts */
export async function getAccountsForVenue(venue) {
    const ownHome = getVenue(venue)?.homeAccount;
    const otherHomes = homeAccounts();
    if (ownHome)
        otherHomes.delete(ownHome);
    return (await getLiveAccounts()).filter(account => !otherHomes.has(account.username));
}
// Managing accounts, for site admins. Refresh tokens, keys and passwords are never sent back to the dashboard
/** Every account, without its secrets, and which venue it's the home account for */
export function listAccounts() {
    const homes = new Map(getVenues().filter(venue => venue.homeAccount).map(venue => [venue.homeAccount, venue.name]));
    return db.prepare("SELECT username, email, password IS NOT NULL AS has_password, added_at FROM rockbot_accounts ORDER BY username").all().map(row => ({
        username: row.username,
        email: row.email,
        hasPassword: !!row.has_password,
        addedAt: row.added_at,
        homeOf: homes.get(row.username) ?? null
    }));
}
/** Something about an account that can't be saved. status is the HTTP status to answer with */
export class AccountError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.name = "AccountError";
        this.status = status;
    }
}
const field = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
/**
 * Adds an account, or updates one with this username. When updating, secrets left empty keep their saved values,
 * since the dashboard never has them to send back
 */
export function saveAccount(input) {
    const username = field(input.username);
    if (!username || !/^[A-Za-z0-9._-]{1,64}$/.test(username))
        throw new AccountError("Enter the account's Rockbot username.");
    const existing = db.prepare("SELECT * FROM rockbot_accounts WHERE username = ?").get(username);
    const email = field(input.email) ?? existing?.email;
    const refreshToken = field(input.refreshToken) ?? existing?.refresh_token;
    const key = field(input.key) ?? existing?.key;
    const password = field(input.password) ?? existing?.password ?? null;
    if (!email || !refreshToken || !key)
        throw new AccountError("A new account needs its email, refresh token and key.");
    db.prepare(`
        INSERT INTO rockbot_accounts (username, email, refresh_token, key, password, added_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (username) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, key = excluded.key, password = excluded.password
    `).run(username, email, refreshToken, key, password, Date.now());
    return { username, updated: !!existing };
}
/** Removes an account. A venue's home account has to be unassigned first */
export function deleteAccount(username) {
    const home = getVenues().find(venue => venue.homeAccount === username);
    if (home)
        throw new AccountError(`${username} is ${home.name}'s home account. Pick another one for ${home.name} first.`, 409);
    const { changes } = db.prepare("DELETE FROM rockbot_accounts WHERE username = ?").run(username);
    if (!changes)
        throw new AccountError("There's no such account.", 404);
    clients.delete(username);
}
//# sourceMappingURL=accounts.js.map