import type { Request, Response } from "express";
import { AuthError, emailForNetId } from "../auth.js";
import {
    betaOverview, betaStatus, createInviteCode, decideRequest, inviteMember, isApproved, normalizeCode,
    redeemInviteCode, redeemMagicLink, requestInvite, revokeInviteCode
} from "../beta.js";
import { currentSession, setSessionCookie } from "./auth.js";

/** Links in emails point here. Set PUBLIC_URL (e.g. https://zotify.app) when running behind a proxy */
export function baseUrl(req: Request) {
    return (process.env.PUBLIC_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function sendError(res: Response, error: unknown, context: string) {
    if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.message });
        return;
    }

    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}

const sessionEmail = (res: Response): string => res.locals.session.email;

// Pages

/** The "private beta" screen: only for signed-in people who aren't in yet */
export function betaPage(appDirectory: string) {
    return async (req: Request, res: Response) => {
        const session = await currentSession(req);

        if (!session) return res.redirect(`/login?${new URLSearchParams({ next: req.originalUrl })}`);
        if (await isApproved(session.email)) return res.redirect("/");

        res.sendFile("beta.html", { root: appDirectory });
    };
}

/** An invite code's shareable link. Signs people in first if needed, then lets them in */
export async function invitePage(req: Request, res: Response) {
    const code = normalizeCode(req.params.code);
    const session = await currentSession(req);

    if (!session) return res.redirect(`/login?${new URLSearchParams({ next: `/invite/${code}` })}`);

    try {
        await redeemInviteCode(session.email, code);
        res.redirect("/?welcome=1");
    } catch (error) {
        const message = error instanceof AuthError ? error.message : "That invite link didn't work. Please try again.";
        if (!(error instanceof AuthError)) console.error(`Error redeeming invite link ${code}:`, error);
        res.redirect(`/beta?${new URLSearchParams({ error: message })}`);
    }
}

/** A magic sign-in link from an invite or approval email */
export async function magicLinkPage(req: Request, res: Response) {
    const token = typeof req.query.token === "string" ? req.query.token : "";

    try {
        const { token: sessionToken } = await redeemMagicLink(token);
        setSessionCookie(req, res, sessionToken);
        res.redirect("/?welcome=1");
    } catch (error) {
        const message = error instanceof AuthError ? error.message : "That sign-in link didn't work. Sign in with your UCInetID instead.";
        if (!(error instanceof AuthError)) console.error("Error redeeming a magic link:", error);
        res.redirect(`/login?${new URLSearchParams({ error: message })}`);
    }
}

// Signed-in people

/** Asks for an invitation. Only once per account */
export async function requestInviteRoute(req: Request, res: Response) {
    try {
        const request = await requestInvite(sessionEmail(res), baseUrl(req));
        res.json({ request: { status: request.status, requestedAt: request.requestedAt } });
    } catch (error) {
        sendError(res, error, `Error requesting an invite for ${sessionEmail(res)}:`);
    }
}

/** Body: { code }. Lets someone in with an invite code */
export async function redeemCodeRoute(req: Request, res: Response) {
    if (!normalizeCode(req.body?.code)) {
        res.status(400).json({ error: "Enter an invite code." });
        return;
    }

    try {
        await redeemInviteCode(sessionEmail(res), req.body.code);
        res.json(await betaStatus(sessionEmail(res)));
    } catch (error) {
        sendError(res, error, `Error redeeming an invite code for ${sessionEmail(res)}:`);
    }
}

// Admins

export async function overviewRoute(req: Request, res: Response) {
    const overview = await betaOverview();
    // Each code's shareable link, so the dashboard doesn't have to build it
    res.json({ ...overview, codes: overview.codes.map(code => ({ ...code, url: `${baseUrl(req)}/invite/${code.code}` })) });
}

/** Body: { email, decision: "approved" | "rejected" } */
export async function decideRequestRoute(req: Request, res: Response) {
    const email = emailForNetId(req.body?.email);
    const decision = req.body?.decision;

    if (!email || (decision !== "approved" && decision !== "rejected")) {
        res.status(400).json({ error: "Missing email or decision" });
        return;
    }

    try {
        res.json(await decideRequest(email, decision, sessionEmail(res), baseUrl(req)));
    } catch (error) {
        sendError(res, error, `Error deciding ${email}'s request:`);
    }
}

/** Body: { netid, silent? }. Silent invites add them without an email */
export async function inviteRoute(req: Request, res: Response) {
    const email = emailForNetId(req.body?.netid);

    if (!email) {
        res.status(400).json({ error: "Enter a UCInetID, like panteater." });
        return;
    }

    try {
        res.json({ email, ...(await inviteMember(email, sessionEmail(res), req.body?.silent === true, baseUrl(req))) });
    } catch (error) {
        sendError(res, error, `Error inviting ${email}:`);
    }
}

/** Body: { maxUses? }. Leave maxUses out for unlimited */
export async function createCodeRoute(req: Request, res: Response) {
    const maxUses = req.body?.maxUses ?? null;

    if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses > 0)) {
        res.status(400).json({ error: "Max uses must be a whole number above 0, or left empty for unlimited." });
        return;
    }

    try {
        const code = await createInviteCode(sessionEmail(res), maxUses);
        res.json({ code, url: `${baseUrl(req)}/invite/${code}` });
    } catch (error) {
        sendError(res, error, "Error creating an invite code:");
    }
}

/** Body: { code } */
export async function revokeCodeRoute(req: Request, res: Response) {
    try {
        await revokeInviteCode(String(req.body?.code ?? ""), sessionEmail(res));
        res.json({ ok: true });
    } catch (error) {
        sendError(res, error, "Error revoking an invite code:");
    }
}
