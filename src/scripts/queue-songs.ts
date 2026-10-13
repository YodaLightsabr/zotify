import { RockbotClient } from "../client.js";
import { cache } from "../cache.js";
import { getAccounts, type AccountWithClient } from "../accounts.js";
import { QueueSongs, SearchSongs } from "../playbook.js";

const accounts = await getAccounts();

console.log("Initializing...");

for (const account of accounts) {
    const accountData = await cache.get([account.username]);

    const client = new RockbotClient({
        token: accountData?.token,
        refreshToken: account.refreshToken,
        key: account.key,
        debug: true
    });

    try {
        await client.account();
    } catch (error) {
        if (error instanceof RockbotClient.Errors.AuthorizationError) {
            await client.refresh();
            await client.account();
        }
    }

    await cache.set([account.username, "token"], client.token);

    account.client = client;
}

console.log(accounts);

// ["the way things go beabadoobee", "still into you paramore", "coming of age mxmtoon", "pick your brain lyn lapid", "lifelike porter robinson", "oakland rac", "somebody told me"]
// ["campus vampire weekend", "unbelievers vampire weekend", "giving up the gun vampire weekend", "pick your brain lyn lapid", "i still havent found what i'm looking for u2", "someone else's dream absofacto", "learn to love you mxmtoon"]
// ["growing pains mxmtoon", "sad disco mxmtoon", "high hopes panic at the disco", "call me maybe", "classic mkto", "reflections", "shadow bleachers", "1983 neon trees", "seeing stars"]
// ["i wanna get better", "from the start", "don't take the money", "sleeping with a friend", "let's get married"]
const operation = new QueueSongs(accounts as AccountWithClient[], { songs: [], venue: "anteatery" });

await operation.run();

// const operation = new SearchSongs(accounts as AccountWithClient[], { query: "Never gonna give you up", venue: "anteatery" });

// const results = await operation.run();

// for (const result of results) {
//     console.log(`🎵 ${result.name}
// 🎤 ${result.artist}
// 🖼️ ${result.album?.cover?.src || "Unknown"}
// ❓ ${result.requestable ? "Requestable" : "Not Requestable"}
// `);
// }
