import { testAccountCodes } from "../auth.js";
import { snapshot } from "../db.js";
import { getHistory } from "../history.js";
/** Whether each test account (like panteater) has an active login code. The code itself is only ever in the server console */
export async function adminTestAccounts(_req, res) {
    res.json(await testAccountCodes());
}
/** Every song queued through Zotify, newest first */
export async function adminHistory(_req, res) {
    res.json(await getHistory());
}
/** Everything Zotify stores, for the admin dashboard. Login codes and sessions are only ever stored as hashes */
export async function adminCache(_req, res) {
    res.json(snapshot());
}
//# sourceMappingURL=admin.js.map