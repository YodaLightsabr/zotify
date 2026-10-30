"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Busy, Spinner } from "@/components/Spinner";
import { deleteJson, getJson, goToLogin } from "@/lib/api";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import "./account.css";

/** Who's signed in and where they stand, and where to sign out. The Account tab on phones; the ID in the navbar elsewhere */
export default function AccountPage() {
    const { user, signOut } = useUser();
    const school = useSchool();
    const [signingOut, setSigningOut] = useState(false);

    const status = !user ? null
        : user.admin ? "Admin"
        : user.approved ? "Member"
        : user.request?.status === "pending" ? "Waiting for an invitation"
        : "Not in the beta yet";

    return (
        <div className="page-account">
            <main>
                <h1>Account</h1>

                {user === undefined && <Spinner small />}

                {user === null && <>
                    <div className="panel">
                        <div className="field-value"><span className="muted">You&apos;re not signed in. Sign in with your {school.idLabel ?? "email address"} to search and queue songs.</span></div>
                    </div>
                    <div className="actions">
                        <button type="button" className="button primary" onClick={() => goToLogin("/account")}>Sign in</button>
                    </div>
                </>}

                {user && <>
                    <div className="panel">
                        <div>
                            <div className="field-label">Signed in as</div>
                            <div className="field-value">{user.email}</div>
                        </div>
                        <div>
                            <div className="field-label">Status</div>
                            <div className="field-value">{status}</div>
                        </div>
                    </div>
                    <div className="actions">
                        {user.approved && <Link className="button" href="/library">Library</Link>}
                        {!user.approved && <Link className="button primary" href="/beta">Join the beta</Link>}
                        {user.developer && <Link className="button" href="/developers">Developers</Link>}
                        <button type="button" className="button sign-out" disabled={signingOut} onClick={async () => {
                            setSigningOut(true);
                            // Lands on the homepage
                            await signOut();
                        }}>
                            {signingOut ? <Busy label="Signing out…" /> : "Sign out"}
                        </button>
                    </div>

                    {user.approved && <SpotifyConnection />}
                    <ConnectedApps />
                </>}
            </main>
        </div>
    );
}

interface Authorization {
    clientId: string;
    name: string;
    description: string | null;
    homepageUrl: string | null;
    scopes: string[];
    authorizedAt: number;
    lastUsedAt: number | null;
}

/** Your Spotify connection, for importing your library and opening private playlists. Hidden if this server doesn't have Spotify set up */
function SpotifyConnection() {
    const [status, setStatus] = useState<{ configured: boolean, connection: { spotifyId: string, displayName: string | null } | null } | null>(null);

    const load = useCallback(async () => {
        const { response, data } = await getJson("/v1/me/spotify");
        if (response.ok) setStatus(data);
    }, []);

    useEffect(() => { load(); }, [load]);

    if (!status?.configured) return null;
    const connection = status.connection;

    return (
        <section className="connected-apps" aria-labelledby="spotify-title">
            <h2 id="spotify-title">Spotify</h2>
            <div className="panel">
                <div className="connected-app">
                    <div>
                        <div className="field-value">{connection ? `Connected as ${connection.displayName ?? connection.spotifyId}` : "Not connected"}</div>
                        <div className="app-detail">
                            {connection ? "Import your liked songs and playlists, and paste links to your private playlists in the search."
                                : "Connect Spotify to import your liked songs and playlists into your Library."}
                        </div>
                    </div>
                    {connection && (
                        <button type="button" className="app-sign-out" onClick={async () => {
                            if (!confirm("Disconnect Spotify? Songs and playlists you've imported stay in your Library.")) return;
                            await deleteJson("/v1/me/spotify");
                            load();
                        }}>Disconnect</button>
                    )}
                </div>
                <Link className="button primary" href="/account/spotify">{connection ? "Import from Spotify" : "Connect Spotify"}</Link>
            </div>
        </section>
    );
}

/** Apps you've let use your account (see src/routes/oauth.ts), which you can sign out of. Hidden until there are some */
function ConnectedApps() {
    const [apps, setApps] = useState<Authorization[] | null>(null);

    const load = useCallback(async () => {
        const { response, data } = await getJson<Authorization[]>("/v1/me/authorizations");
        if (response.ok) setApps(data);
    }, []);

    useEffect(() => { load(); }, [load]);

    if (!apps?.length) return null;

    return (
        <section className="connected-apps" aria-labelledby="apps-title">
            <h2 id="apps-title">Connected apps</h2>
            <div className="panel">
                {apps.map(app => (
                    <div className="connected-app" key={app.clientId}>
                        <div>
                            <div className="field-value">{app.name}</div>
                            <div className="app-detail">
                                {app.scopes.join(", ")} · {app.lastUsedAt ? `last used ${new Date(app.lastUsedAt).toLocaleDateString()}` : "not used yet"}
                            </div>
                        </div>
                        <button type="button" className="app-sign-out" onClick={async () => {
                            if (!confirm(`Sign out of ${app.name}? It won't be able to use your account until you allow it again.`)) return;
                            await deleteJson(`/v1/me/authorizations/${app.clientId}`);
                            load();
                        }}>Sign out</button>
                    </div>
                ))}
            </div>
        </section>
    );
}
