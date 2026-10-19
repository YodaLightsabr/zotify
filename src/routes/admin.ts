import type { Request, Response } from "express";
import { testAccountCodes } from "../auth.js";
import { snapshot } from "../db.js";
import { getHistory } from "../history.js";

/** Whether each test account (like panteater) has an active login code. The code itself is only ever in the server console */
export async function adminTestAccounts(_req: Request, res: Response) {
    res.json(await testAccountCodes());
}

/** Every song queued through Zotify, newest first */
export async function adminHistory(_req: Request, res: Response) {
    res.json(await getHistory());
}

/** Everything Zotify stores, for the admin dashboard. Login codes and sessions are only ever stored as hashes */
export async function adminCache(_req: Request, res: Response) {
    res.json(snapshot());
}
