import Code from "@/components/docs/Code";
import { API_URL, INTERNAL_API_URL, MAIN_HOST, MAIN_URL } from "@/lib/config";

export const metadata = { title: "Authentication" };


/** The scopes, from the API itself so they're never out of date */
async function getScopes(): Promise<Record<string, string>> {
    try {
        const response = await fetch(`${INTERNAL_API_URL}/v1`, { next: { revalidate: 300 } });
        return (await response.json()).scopes ?? {};
    } catch {
        return {};
    }
}

/** Scopes, personal access tokens and OAuth */
export default async function Authentication() {
    const scopes = await getScopes();

    return (
        <article className="docs-article">
            <h1>Authentication</h1>
            <p className="docs-lead">
                Every request that acts as someone sends a token in the <code>Authorization</code> header. A token can do what its person can,
                limited to its scopes.
            </p>
            <Code>{`Authorization: Bearer zotify_pat_…`}</Code>

            <h2 id="scopes">Scopes</h2>
            <table className="docs-table">
                <thead><tr><th>Scope</th><th>Lets a token</th></tr></thead>
                <tbody>
                    {Object.entries(scopes).map(([scope, description]) => <tr key={scope}><td><code>{scope}</code></td><td>{description}</td></tr>)}
                </tbody>
            </table>
            <p>
                <code>GET /v1/me</code> works with any token. A token missing a scope gets a <code>403</code> with <code>code: &quot;insufficient_scope&quot;</code>,
                and the <code>scope</code> it needs. Scopes don&apos;t give anyone powers they don&apos;t have: <code>admin</code> only works for a school&apos;s admins.
            </p>

            <h2 id="beta">Who can do what</h2>
            <p>
                Zotify is in private beta at each school. Searching, requesting and voting at a venue need the person to be in that venue&apos;s school&apos;s Zotify;
                <code>GET /v1/me</code> lists where they&apos;re <code>approved</code>. Otherwise those routes answer <code>403</code> with <code>code: &quot;not_approved&quot;</code>.
                Someone can ask to join with <code>POST /v1/schools/{"{school}"}/join-request</code>.
            </p>

            <h2 id="personal-access-tokens">Personal access tokens</h2>
            <p>
                For your own scripts and tools. Make them at <a href={`${MAIN_URL}/developers`}>{MAIN_HOST}/developers</a> once a Zotify admin has made you a developer.
                Pick their scopes and how long they last: 7, 30, 90 or 365 days, or no expiry. A token is shown once, when it&apos;s made; Zotify only keeps a hash of it.
            </p>
            <p>
                Tokens start with <code>zotify_pat_</code>, so they&apos;re easy to spot if one is pasted somewhere it shouldn&apos;t be.
                Delete one from the developers page, or revoke it from code with <code>POST /v1/oauth/revoke</code>. If you stop being a developer, your tokens are deleted.
            </p>

            <h2 id="oauth">OAuth apps</h2>
            <p>
                For apps other people sign in to. Zotify uses OAuth 2.0&apos;s authorization code flow. Register an app at{" "}
                <a href={`${MAIN_URL}/developers`}>{MAIN_HOST}/developers</a> with the addresses it can send people back to (redirect URIs), and choose:
            </p>
            <ul>
                <li><strong>Public</strong>, for apps that run on people&apos;s own devices and can&apos;t keep a secret: desktop and mobile apps, command-line tools, Raycast extensions. These must use PKCE.</li>
                <li><strong>Confidential</strong>, for apps with a server. These get a client secret, and can use PKCE too.</li>
            </ul>
            <p>Redirect URIs can be <code>https</code> addresses, <code>http://localhost</code> or <code>127.0.0.1</code> on any port, or your app&apos;s own scheme, like <code>myapp://callback</code>.</p>

            <h3>1. Send them to Zotify</h3>
            <p>Make a random <code>code_verifier</code> (43 to 128 characters), and its <code>code_challenge</code>: the base64url SHA-256 of it, without padding. Then open:</p>
            <Code>{`${MAIN_URL}/oauth/authorize
  ?client_id=zotify_app_…
  &redirect_uri=https%3A%2F%2Fexample.com%2Fcallback
  &response_type=code
  &scope=music:read%20music:write
  &state=…
  &code_challenge=…
  &code_challenge_method=S256`}</Code>
            <p>
                They sign in if they need to, see your app&apos;s name and what it wants to do, and allow it or not. If they&apos;ve already allowed your app these scopes,
                they go straight back.
            </p>

            <h3>2. Get the code</h3>
            <p>
                They come back to your redirect URI with <code>?code=…&amp;state=…</code>. Check <code>state</code> is the one you sent. If they said no, or something was
                wrong with the request, there&apos;s an <code>error</code> instead, like <code>access_denied</code>, with an <code>error_description</code>.
                Codes last five minutes and work once.
            </p>

            <h3>3. Swap it for tokens</h3>
            <Code>{`curl ${API_URL}/v1/oauth/token \\
  -d grant_type=authorization_code \\
  -d client_id=zotify_app_… \\
  -d code=… \\
  -d redirect_uri=https://example.com/callback \\
  -d code_verifier=…`}</Code>
            <p>Confidential apps also authenticate, with HTTP Basic (<code>-u client_id:client_secret</code>) or <code>client_secret</code> in the body. The answer:</p>
            <Code>{`{
  "access_token": "zotify_at_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "zotify_rt_…",
  "scope": "music:read music:write"
}`}</Code>
            <p>The token endpoint takes forms or JSON. Errors use OAuth&apos;s format, <code>{`{ "error": "invalid_grant", "error_description": "…" }`}</code>, so OAuth libraries understand them.</p>

            <h3>4. Refresh</h3>
            <p>
                Access tokens last an hour. Swap the refresh token for new ones before then, or when a request answers <code>401</code>.
                Each refresh token works once, and you get a new one every time; keep the latest. If two parts of your app refresh at the same moment,
                the replaced token still works for a minute, so neither is signed out. A refresh token lasts 180 days from when it was last used.
            </p>
            <Code>{`curl ${API_URL}/v1/oauth/token \\
  -d grant_type=refresh_token \\
  -d client_id=zotify_app_… \\
  -d refresh_token=zotify_rt_…`}</Code>
            <p>Send <code>scope</code> with fewer scopes than were allowed to narrow the tokens from then on.</p>

            <h3>Signing out</h3>
            <p>
                Revoke either token with <code>POST /v1/oauth/revoke</code> and <code>token=…</code>, which signs that sign-in out. People can also sign out of your app
                from their account page on Zotify.
            </p>
            <p>
                OAuth libraries can find all of this themselves from <a href={`${API_URL}/.well-known/oauth-authorization-server`}><code>/.well-known/oauth-authorization-server</code></a>.
            </p>

            <h2 id="raycast">Raycast</h2>
            <p>
                Register a public app with the redirect URI <code>https://raycast.com/redirect?packageName=Extension</code>. Raycast&apos;s PKCE client does the rest:
            </p>
            <Code label="src/zotify.ts">{`import { OAuth } from "@raycast/api";

const CLIENT_ID = "zotify_app_…";
const TOKEN_URL = "${API_URL}/v1/oauth/token";

const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Zotify",
  providerIcon: "zotify.png",
  description: "Connect your Zotify account to request songs",
});

async function fetchTokens(params: Record<string, string>) {
  const response = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams({ client_id: CLIENT_ID, ...params }) });
  if (!response.ok) throw new Error((await response.json()).error_description);
  return (await response.json()) as OAuth.TokenResponse;
}

/** A valid access token, asking them to sign in the first time */
export async function accessToken() {
  const tokens = await client.getTokens();

  if (tokens?.accessToken && !tokens.isExpired()) return tokens.accessToken;

  if (tokens?.refreshToken) {
    await client.setTokens(await fetchTokens({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }));
  } else {
    const request = await client.authorizationRequest({
      endpoint: "${MAIN_URL}/oauth/authorize",
      clientId: CLIENT_ID,
      scope: "music:read music:write",
    });
    const { authorizationCode } = await client.authorize(request);
    await client.setTokens(await fetchTokens({
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectURI,
    }));
  }

  return (await client.getTokens())!.accessToken;
}

/** Calls the Zotify API as them */
export async function zotify<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(\`${API_URL}\${path}\`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${await accessToken()}\`, ...init.headers },
  });
  if (!response.ok) throw new Error((await response.json()).error);
  return response.status === 204 ? (undefined as T) : response.json();
}`}</Code>
            <p>Then, for example, a search command:</p>
            <Code>{`const songs = await zotify<Song[]>(\`/v1/venues/anteatery/search?q=\${encodeURIComponent(query)}\`);
await zotify(\`/v1/venues/anteatery/requests\`, { method: "POST", body: JSON.stringify({ songId: songs[0].id }) });`}</Code>
        </article>
    );
}
