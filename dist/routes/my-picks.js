import { getHistoryFor } from "../history.js";
/** The signed-in person's own picks, newest first. Who queued each one is left out, since it's always them */
export async function myPicks(_req, res) {
    const picks = await getHistoryFor(res.locals.session.email);
    res.json(picks.map(({ requestedBy, ...pick }) => pick));
}
//# sourceMappingURL=my-picks.js.map