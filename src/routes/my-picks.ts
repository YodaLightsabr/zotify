import type { Request, Response } from "express";
import { isApproved } from "../beta.js";
import { getHistoryFor } from "../history.js";
import { currentSession } from "./auth.js";

/** The signed-in person's own picks, newest first. Who queued each one is left out, since it's always them */
export async function myPicks(_req: Request, res: Response) {
    const picks = await getHistoryFor(res.locals.session.email);
    res.json(picks.map(({ requestedBy, ...pick }) => pick));
}

/** The My picks page: signed-out visitors sign in first, and people who aren't approved see the beta screen */
export function myPicksPage(appDirectory: string) {
    return async (req: Request, res: Response) => {
        const session = await currentSession(req);

        if (!session) return res.redirect(`/login?${new URLSearchParams({ next: "/my-picks" })}`);
        if (!(await isApproved(session.email))) return res.redirect(`/beta?${new URLSearchParams({ next: "/my-picks" })}`);

        res.sendFile("my-picks.html", { root: appDirectory });
    };
}
