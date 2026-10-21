"use client";

import { useEffect, useRef, useState } from "react";
import CardPage from "@/components/CardPage";
import { Busy, Spinner } from "@/components/Spinner";
import { getJson, goToLogin, postJson } from "@/lib/api";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import "./authorize.css";

// Where OAuth apps send people to sign in (see src/routes/oauth.ts). It asks whether to let the app use their account, then
// sends them back to the app with a code. Apps they've already allowed these scopes skip straight back

interface Authorization {
    app: { clientId: string, name: string, description: string | null, homepageUrl: string | null, developer: string };
    scopes: { scope: string, description: string }[];
    redirectUri: string;
    alreadyAuthorized: boolean;
}

type State =
    | { status: "loading" }
    | { status: "asking", authorization: Authorization }
    | { status: "leaving" }
    | { status: "error", message: string };

/** The authorization request's own parameters, as the app sent them */
const requestParams = () => Object.fromEntries(new URLSearchParams(location.search));

export default function AuthorizePage() {
    const { user } = useUser();
    const school = useSchool();
    const [state, setState] = useState<State>({ status: "loading" });
    const [deciding, setDeciding] = useState<"allow" | "deny" | null>(null);
    const loaded = useRef(false);

    async function decide(approve: boolean) {
        setDeciding(approve ? "allow" : "deny");
        const { response, data } = await postJson<{ redirect?: string, error_description?: string }>("/v1/oauth/authorize", { ...requestParams(), approve });

        if (data?.redirect) {
            setState({ status: "leaving" });
            location.assign(data.redirect);
            return;
        }

        setDeciding(null);
        setState({ status: "error", message: data?.error_description ?? `Something went wrong (${response.status}). Please try again.` });
    }

    useEffect(() => {
        if (user === undefined || loaded.current) return;
        if (user === null) return goToLogin();

        loaded.current = true;

        (async () => {
            const { data } = await getJson<Authorization & { error?: string, error_description?: string, redirect?: string | null }>(`/v1/oauth/authorize${location.search}`);

            // Mistakes the app should hear about go back to it; ones about the app itself are only safe to show here
            if (data?.error) {
                if (data.redirect) location.assign(data.redirect);
                else setState({ status: "error", message: data.error_description ?? "That sign-in link isn't right." });
                return;
            }

            if (!data) return setState({ status: "error", message: "Couldn't check that sign-in link. Please try again." });
            if (data.alreadyAuthorized) return decide(true);
            setState({ status: "asking", authorization: data });
        })();
    }, [user]);

    if (state.status === "error") {
        return (
            <CardPage className="authorize-page">
                <h1>Can&apos;t sign in</h1>
                <p className="subtitle">{state.message}</p>
            </CardPage>
        );
    }

    if (state.status !== "asking" || !user) {
        return (
            <CardPage className="authorize-page">
                <h1>Signing in</h1>
                <p className="subtitle"><Spinner small /></p>
            </CardPage>
        );
    }

    const { app, scopes, redirectUri } = state.authorization;

    return (
        <CardPage className="authorize-page">
            <h1>Allow {app.name}?</h1>
            <p className="subtitle">It wants to use your Zotify account, {school.shortEmail(user.email)}.</p>

            {app.description && <p className="app-description">{app.description}</p>}

            <h2>It&apos;ll be able to</h2>
            <ul className="scopes">
                {scopes.map(({ scope, description }) => <li key={scope}>{description}</li>)}
            </ul>

            <p className="hint">
                Made by {app.developer}{app.homepageUrl && <> · <a href={app.homepageUrl} target="_blank" rel="noreferrer">{new URL(app.homepageUrl).host}</a></>}.
                {" "}You&apos;ll go back to {new URL(redirectUri).protocol.startsWith("http") ? new URL(redirectUri).host : redirectUri.split("?")[0]}.
                You can sign out of it any time from your account.
            </p>

            <div className="decision">
                <button type="button" className="primary" disabled={!!deciding} onClick={() => decide(true)}>
                    {deciding === "allow" ? <Busy label="Allowing…" /> : "Allow"}
                </button>
                <button type="button" className="secondary" disabled={!!deciding} onClick={() => decide(false)}>
                    {deciding === "deny" ? <Busy label="Cancelling…" /> : "Cancel"}
                </button>
            </div>
        </CardPage>
    );
}
