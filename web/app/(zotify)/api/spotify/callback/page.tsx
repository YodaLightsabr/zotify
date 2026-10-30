"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { postJson } from "@/lib/api";
import "../../../account/account.css";

/**
 * Where Spotify sends people after they connect it (the redirect URI set in Spotify's dashboard). Hands what Spotify sent to
 * the API to finish connecting, then carries on to the import wizard
 */
export default function SpotifyCallbackPage() {
    const router = useRouter();
    const [error, setError] = useState("");
    // Spotify's code only works once, so React running this twice in development mustn't send it twice
    const sent = useRef(false);

    useEffect(() => {
        if (sent.current) return;
        sent.current = true;

        // In development, Spotify comes back to 127.0.0.1, and proxy.ts has already moved this to localhost
        const url = new URL(location.href);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state) {
            setError(url.searchParams.get("error") === "access_denied" ? "You didn't connect Spotify." : "Spotify didn't send back what Zotify needs.");
            return;
        }

        postJson("/v1/me/spotify/callback", { code, state }).then(({ response, data }) => {
            if (!response.ok) throw new Error(data?.error ?? `Couldn't connect Spotify (${response.status})`);
            router.replace("/account/spotify");
        }).catch(error => setError((error as Error).message));
    }, [router]);

    return (
        <div className="page-account">
            <main>
                <h1>Spotify</h1>
                {error ? <>
                    <div className="panel"><div className="field-value"><span className="muted">{error}</span></div></div>
                    <div className="actions"><Link className="button primary" href="/account/spotify">Try again</Link></div>
                </> : <Spinner small />}
            </main>
        </div>
    );
}
