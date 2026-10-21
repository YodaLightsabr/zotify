import Link from "next/link";
import Code from "@/components/docs/Code";
import { API_URL, SITE_DOMAIN, SITE_PROTOCOL } from "@/lib/config";

export const metadata = { title: { absolute: "Zotify API" } };

const DEVELOPERS_URL = `${SITE_PROTOCOL}://${SITE_DOMAIN}/developers`;

/** The docs' front page: what the API does, and a first few requests */
export default function GettingStarted() {
    return (
        <article className="docs-article">
            <h1>Zotify API</h1>
            <p className="docs-lead">
                Everything Zotify does, for your own scripts and apps: see what&apos;s playing at a dining hall, search Rockbot, request songs,
                vote, request whole Spotify playlists, and read Zotify Meals&apos; menus.
            </p>

            <h2>The basics</h2>
            <ul>
                <li>The API is at <code>{API_URL}</code>. Every path starts with <code>/v1</code>.</li>
                <li>Requests and responses are JSON. Times are milliseconds since 1970, unless a field says it&apos;s a date.</li>
                <li>Schools and their venues (dining halls) are public: <code>GET /v1/schools</code>. Most of the API is about a venue, like <code>/v1/venues/anteatery/search</code>.</li>
                <li>Zotify Meals&apos; menus and each venue&apos;s queue need no token. Everything else acts as a person, with a token.</li>
                <li>
                    The whole API is described in OpenAPI at <a href={`${API_URL}/v1/openapi.json`}><code>/v1/openapi.json</code></a>, if you&apos;d rather generate a client.
                </li>
            </ul>

            <h2>Get a token</h2>
            <p>
                Tokens come from <a href={DEVELOPERS_URL}>{SITE_DOMAIN}/developers</a>, once a Zotify admin has made you a developer.
                There are two kinds:
            </p>
            <ul>
                <li><strong>Personal access tokens</strong>, for your own scripts. They act as you.</li>
                <li><strong>OAuth apps</strong>, for apps other people sign in to, like a Raycast extension. Each person allows your app, and it gets a token for them.</li>
            </ul>
            <p>Both are limited to scopes, like <code>music:read</code>. <Link href="/authentication">Authentication</Link> has the details.</p>

            <h2>Your first requests</h2>
            <p>Make a personal access token with <code>music:read</code> and <code>music:write</code>, and keep it in an environment variable:</p>
            <Code>{`export ZOTIFY_TOKEN=zotify_pat_…`}</Code>

            <p>Check who it is, and which schools&apos; Zotify you&apos;re in. Zotify is in private beta, so music routes need you to be <code>approved</code> at the venue&apos;s school:</p>
            <Code>{`curl ${API_URL}/v1/me -H "Authorization: Bearer $ZOTIFY_TOKEN"`}</Code>

            <p>See what&apos;s playing at the Anteatery. This one needs no token:</p>
            <Code>{`curl ${API_URL}/v1/venues/anteatery/queue`}</Code>

            <p>Search for a song:</p>
            <Code>{`curl "${API_URL}/v1/venues/anteatery/search?q=dancing%20queen" \\
  -H "Authorization: Bearer $ZOTIFY_TOKEN"`}</Code>

            <p>
                Each result has an <code>id</code>, whether it&apos;s <code>requestable</code> there, and its <code>status</code> if it&apos;s already queued.
                Request one by its <code>id</code>:
            </p>
            <Code>{`curl ${API_URL}/v1/venues/anteatery/requests \\
  -H "Authorization: Bearer $ZOTIFY_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"songId": "1091753"}'`}</Code>

            <p>
                That puts it in Zotify&apos;s queue. Zotify keeps up to three of its songs in the venue&apos;s Rockbot queue at a time, and moves the next one in,
                voted up, as each one plays. If a song is already in Rockbot&apos;s queue (search results give its <code>pickId</code>), vote on it instead:
            </p>
            <Code>{`curl -X POST ${API_URL}/v1/venues/anteatery/picks/50556543023105/votes \\
  -H "Authorization: Bearer $ZOTIFY_TOKEN"`}</Code>

            <h2>Zotify Meals</h2>
            <p>Menus are public, so there&apos;s no token to send. Today&apos;s vegan lunch at Brandywine, without anything with peanuts:</p>
            <Code>{`curl "${API_URL}/v1/meals/uci/brandywine/today?period=lunch&diet=vegan&exclude=peanuts"`}</Code>
            <p>Starring dishes and reading your favorites need the <code>meals:read</code> and <code>meals:write</code> scopes.</p>

            <h2>Next</h2>
            <ul>
                <li><Link href="/authentication">Authentication</Link>: scopes, personal access tokens, and signing people in with OAuth, with a Raycast example.</li>
                <li><Link href="/conventions">Errors and limits</Link>: what errors look like, and how many requests you can make.</li>
                <li><Link href="/reference">API reference</Link>: every route, with examples.</li>
            </ul>
        </article>
    );
}
