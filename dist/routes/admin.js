import { isAdmin, testAccountCodes } from "../auth.js";
import { cache } from "../cache.js";
import { currentSession } from "./auth.js";
/** The admin page: signed-out visitors go to sign in first, and everyone else who isn't an admin is turned away */
export function adminPage(appDirectory) {
    return async (req, res) => {
        const session = await currentSession(req);
        if (!session) {
            res.redirect(`/login?${new URLSearchParams({ next: "/admin" })}`);
            return;
        }
        if (!isAdmin(session.email)) {
            res.status(403).type("text/plain").send("Admins only.");
            return;
        }
        res.sendFile("admin.html", { root: appDirectory });
    };
}
/** Whether each test account (like panteater) has an active login code. The code itself is only ever in the server console */
export async function adminTestAccounts(_req, res) {
    res.json(await testAccountCodes());
}
/** The whole cache, for the admin dashboard. Login codes and sessions are only ever stored as hashes */
export async function adminCache(_req, res) {
    res.json(await cache.get([]));
}
//# sourceMappingURL=admin.js.map