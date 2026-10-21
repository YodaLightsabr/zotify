import { RockbotClient } from "../client.js";

const client = new RockbotClient({
    token: process.env.TOKEN!,
    refreshToken: process.env.REFRESH_TOKEN!,
    key: process.env.KEY!,
});

const venue = client.venue(RockbotClient.ANTEATERY, "Anteatery");

const refresh = false;
if (refresh) {
    console.log("\nRefreshing token...");
    await client.refresh();
    console.log({ token: client.token });
}

console.log("\nFinding songs...");

const results = await venue.search({ query: "Never gonna give you up" });
const song = results[0];

console.log(song);

console.log("\nGetting details...");

const details = await song.getDetails({ venue });
console.log(details);
console.log(details?.album?.cover?.src);

console.log("\nRequesting song...");
const pick = await song.request({ venue });
console.log(pick);

console.log("\nVoting on pick...");
await pick.vote();

