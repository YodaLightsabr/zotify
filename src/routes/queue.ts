import type { Request, Response } from "express";
import { getAccountsForVenue } from "../accounts.js";
import { RockbotClient } from "../client.js";
import { QueueSong } from "../playbook.js";
import { markQueued } from "../queued.js";
import { parseVenue } from "./params.js";

export async function queue(req: Request, res: Response) {
    const body = req.body ?? {};
    const song = body.song;
    const venueName = parseVenue(body.venue);

    // Rockbot song IDs can come through as numbers, so accept either
    if (!["string", "number"].includes(typeof song?.id) || song.id === "") {
        res.status(400).json({ error: "Missing song ID" });
        return;
    }

    if (!venueName) {
        res.status(400).json({ error: `Unknown venue "${body.venue}"` });
        return;
    }

    // Excludes the other venue's home account so it stays checked in there; QueueSong also votes with only these
    const accounts = await getAccountsForVenue(venueName);

    if (!accounts.length) {
        res.status(503).json({ error: "No accounts available" });
        return;
    }

    const operation = new QueueSong(accounts, {
        song: { id: String(song.id), name: String(song.name ?? ""), artist: String(song.artist ?? "") },
        venue: venueName
    });

    try {
        const pick = await operation.run();
        // The song is already queued at this point, so a cache failure shouldn't fail the request
        const queuedAt = await markQueued(venueName, {
            id: String(song.id),
            pickId: String(pick.id),
            name: String(song.name ?? ""),
            artist: String(song.artist ?? ""),
            // Only keep real image URLs since this gets rendered back on the page
            cover: typeof song.cover === "string" && song.cover.startsWith("https://") ? song.cover : undefined
        }).catch(error => {
            console.error(`Could not record queue time for "${song.name}":`, error);
            return Date.now();
        });

        res.json({ id: pick.id, queuedAt });
    } catch (error) {
        if (error instanceof RockbotClient.Errors.RepeatLimitReachedError) {
            res.status(409).json({ error: "This song was played too recently" });
            return;
        }

        if (error instanceof RockbotClient.Errors.PickLimitReachedError) {
            res.status(429).json({ error: "Every account has hit its pick limit" });
            return;
        }

        console.error(`Error queuing "${song.name}" at ${venueName}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(502).json({ error: message || "Could not queue song" });
    }
}
