import Code from "@/components/docs/Code";

export const metadata = { title: "Errors and limits" };

const CODES: [string, number, string][] = [
    ["unauthorized", 401, "No token, or no session."],
    ["invalid_token", 401, "The token doesn't exist, expired, or was revoked. For OAuth, refresh it."],
    ["insufficient_scope", 403, "The token needs another scope, given in scope."],
    ["not_approved", 403, "They aren't in the venue's school's Zotify yet."],
    ["forbidden", 403, "Only admins can do this."],
    ["not_found", 404, "No such venue, school, song, pick or playlist."],
    ["invalid_request", 400, "Something in the request isn't right; error says what."],
    ["downvote_refused", 409, "Zotify's downvote rules don't allow it; the answer says why."],
    ["rate_limited", 429, "Too many requests. Wait Retry-After seconds."],
    ["venue_unavailable", 503, "The venue isn't taking requests right now, usually because it's closed."]
];

/** Errors, rate limits and other conventions */
export default function Conventions() {
    return (
        <article className="docs-article">
            <h1>Errors and limits</h1>

            <h2 id="errors">Errors</h2>
            <p>Errors have an HTTP status and a JSON body with <code>error</code>, a sentence you can show people, and usually a <code>code</code> to check in code:</p>
            <Code>{`HTTP/1.1 403 Forbidden

{
  "error": "This needs the music:write scope.",
  "code": "insufficient_scope",
  "scope": "music:write"
}`}</Code>
            <table className="docs-table">
                <thead><tr><th>code</th><th>Status</th><th>Means</th></tr></thead>
                <tbody>
                    {CODES.map(([code, status, meaning]) => <tr key={code}><td><code>{code}</code></td><td>{status}</td><td>{meaning}</td></tr>)}
                </tbody>
            </table>
            <p>
                A <code>502</code> means Rockbot didn&apos;t answer, or answered with an error. Those are usually brief, so it&apos;s worth trying again after a moment.
                OAuth&apos;s token and revoke endpoints use OAuth&apos;s own error format instead; see <a href="/authentication#oauth">Authentication</a>.
            </p>

            <h2 id="rate-limits">Rate limits</h2>
            <p>
                Each personal access token, and each person signed in to an OAuth app, can make 300 requests a minute. Every answer says where you are:
            </p>
            <Code>{`X-RateLimit-Limit: 300
X-RateLimit-Remaining: 287
X-RateLimit-Reset: 1792607497`}</Code>
            <p>
                <code>X-RateLimit-Reset</code> is when the minute starts over, in seconds since 1970. Over the limit, requests answer <code>429</code> with a{" "}
                <code>Retry-After</code> header. Zotify Meals&apos; menus and venues&apos; queues, without a token, aren&apos;t limited, but please cache them:
                menus change a few times a day, and queues every few minutes.
            </p>

            <h2 id="being-kind">Being kind to Rockbot</h2>
            <p>
                Zotify requests and votes with a handful of Rockbot accounts that everyone shares. Please don&apos;t request songs in a loop, and poll queues no more than
                every 15 seconds; Zotify only fetches each venue&apos;s queue from Rockbot that often anyway. Searches are cached for a day, so repeating one is cheap.
            </p>

            <h2 id="conventions">Conventions</h2>
            <ul>
                <li>IDs from Rockbot (songs, picks) are strings of digits. Send them as strings.</li>
                <li>Times are milliseconds since 1970, except Zotify Meals&apos;, which are dates (<code>2026-10-21</code>), clock times in the school&apos;s timezone, and ISO 8601.</li>
                <li>Successful changes answer <code>200</code> with the result, <code>201</code> when they make something, or <code>204</code> with nothing.</li>
                <li>Lists come back whole; there&apos;s nothing to page through.</li>
                <li>Any site can call the API from a browser with a token (CORS allows every origin). Keep tokens out of public web pages, though.</li>
                <li>New fields can appear in answers at any time. Breaking changes will come with a new version, <code>/v2</code>.</li>
            </ul>
        </article>
    );
}
