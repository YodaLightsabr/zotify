import { AuthError, signInEmail } from "../auth.js";
import { betaOverview, betaStatus, createInviteCode, decideRequest, inviteMember, isApproved, normalizeCode, redeemInviteCode, redeemMagicLink, requestInvite, revokeInviteCode } from "../beta.js";
import { FRONTEND_URL } from "../config.js";
import { setSessionCookie } from "./auth.js";
function sendError(res, error, context) {
    if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(context, error);
    res.status(500).json({ error: "Something went wrong. Please try again." });
}
const sessionEmail = (res) => res.locals.session.email;
/** Body: { token }. Signs in with a magic link from an invite or approval email, and sets the session cookie */
export async function magicLinkRoute(req, res) {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) {
        res.status(400).json({ error: "That sign-in link is incomplete. Sign in with your UCInetID instead." });
        return;
    }
    try {
        const { email, token: sessionToken } = await redeemMagicLink(token);
        setSessionCookie(req, res, sessionToken);
        res.json({ email, approved: await isApproved(email) });
    }
    catch (error) {
        sendError(res, error, "Error redeeming a magic link:");
    }
}
// Signed-in people
/** Asks for an invitation. Only once per account */
export async function requestInviteRoute(req, res) {
    try {
        const request = await requestInvite(sessionEmail(res), FRONTEND_URL);
        res.json({ request: { status: request.status, requestedAt: request.requestedAt } });
    }
    catch (error) {
        sendError(res, error, `Error requesting an invite for ${sessionEmail(res)}:`);
    }
}
/** Body: { code }. Lets someone in with an invite code */
export async function redeemCodeRoute(req, res) {
    if (!normalizeCode(req.body?.code)) {
        res.status(400).json({ error: "Enter an invite code." });
        return;
    }
    try {
        await redeemInviteCode(sessionEmail(res), req.body.code);
        res.json(await betaStatus(sessionEmail(res)));
    }
    catch (error) {
        sendError(res, error, `Error redeeming an invite code for ${sessionEmail(res)}:`);
    }
}
// Admins
export async function overviewRoute(req, res) {
    const overview = await betaOverview();
    // Each code's shareable link, so the dashboard doesn't have to build it
    res.json({ ...overview, codes: overview.codes.map(code => ({ ...code, url: `${FRONTEND_URL}/invite/${code.code}` })) });
}
/** Body: { email, decision: "approved" | "rejected", silent? }. Silent approvals don't email them */
export async function decideRequestRoute(req, res) {
    const email = signInEmail(req.body?.email);
    const decision = req.body?.decision;
    if (!email || (decision !== "approved" && decision !== "rejected")) {
        res.status(400).json({ error: "Missing email or decision" });
        return;
    }
    try {
        res.json(await decideRequest(email, decision, sessionEmail(res), FRONTEND_URL, req.body?.silent === true));
    }
    catch (error) {
        sendError(res, error, `Error deciding ${email}'s request:`);
    }
}
/** Body: { netid, silent? }. Silent invites add them without an email */
export async function inviteRoute(req, res) {
    const email = signInEmail(req.body?.netid);
    if (!email) {
        res.status(400).json({ error: "Enter a UCInetID or email address, like panteater." });
        return;
    }
    try {
        res.json({ email, ...(await inviteMember(email, sessionEmail(res), req.body?.silent === true, FRONTEND_URL)) });
    }
    catch (error) {
        sendError(res, error, `Error inviting ${email}:`);
    }
}
/** Body: { maxUses? }. Leave maxUses out for unlimited */
export async function createCodeRoute(req, res) {
    const maxUses = req.body?.maxUses ?? null;
    if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses > 0)) {
        res.status(400).json({ error: "Max uses must be a whole number above 0, or left empty for unlimited." });
        return;
    }
    try {
        const code = await createInviteCode(sessionEmail(res), maxUses);
        res.json({ code, url: `${FRONTEND_URL}/invite/${code}` });
    }
    catch (error) {
        sendError(res, error, "Error creating an invite code:");
    }
}
/** Body: { code } */
export async function revokeCodeRoute(req, res) {
    try {
        await revokeInviteCode(String(req.body?.code ?? ""), sessionEmail(res));
        res.json({ ok: true });
    }
    catch (error) {
        sendError(res, error, "Error revoking an invite code:");
    }
}
//# sourceMappingURL=beta.js.map