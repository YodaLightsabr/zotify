"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import CardPage from "@/components/CardPage";
import { Busy, Spinner } from "@/components/Spinner";
import { postJson, safeNext } from "@/lib/api";
import { shortEmail } from "@/lib/format";
import { useUser, type CurrentUser } from "@/lib/user";
import "./beta.css";

export default function BetaPage() {
    return <Suspense><Beta /></Suspense>;
}

const date = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Beta() {
    const router = useRouter();
    const params = useSearchParams();
    const { user, refresh, signOut } = useUser();
    const next = safeNext(params.get("next"));

    const [code, setCode] = useState("");
    // An invite link that didn't work sends people here with the reason
    const [codeMessage, setCodeMessage] = useState(params.get("error") ?? "");
    const [checking, setChecking] = useState(false);
    const codeForm = useRef<HTMLFormElement>(null);

    // Signed-out people sign in first; approved people have nothing to do here
    useEffect(() => {
        if (user === null) router.replace(`/login?${new URLSearchParams({ next: location.pathname + location.search })}`);
        else if (user?.approved) router.replace(next === "/" && checking ? "/?welcome=1" : next);
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    async function redeem() {
        setChecking(true);
        setCodeMessage("");

        try {
            const { response, data } = await postJson("/api/beta/redeem", { code });
            if (!response.ok) throw new Error(data?.error ?? `Couldn't use that code (${response.status})`);
            // Now approved, so the effect above sends them on
            await refresh();
        } catch (error) {
            setCodeMessage((error as Error).message);
            setChecking(false);
        }
    }

    return (
        <CardPage className="page-beta">
            <h1>Zotify is in private beta</h1>
            <p className="subtitle">We&apos;re letting people in a few at a time. Ask for an invitation, or use an invite code if you have one.</p>

            <section className="option" aria-labelledby="request-title">
                <h2 id="request-title">Ask for an invitation</h2>
                {user ? <RequestInvite user={user} onRequested={refresh} /> : <Spinner small />}
            </section>

            <section className="option" aria-labelledby="code-title">
                <form ref={codeForm} noValidate onSubmit={event => {
                    event.preventDefault();
                    if (codeForm.current?.reportValidity()) redeem();
                }}>
                    <label htmlFor="invite-code" id="code-title">Have an invite code?</label>
                    <div className="field code-field">
                        <input id="invite-code" name="code" type="text" placeholder="ABCD2345" required
                            autoComplete="off" autoCapitalize="characters" spellCheck={false}
                            value={code} onChange={event => setCode(event.target.value)} />
                    </div>
                    <p className="message" role="alert">{codeMessage}</p>
                    <button className="primary" type="submit" disabled={checking}>{checking ? <Busy label="Checking…" /> : "Join with code"}</button>
                </form>
            </section>

            {user && (
                <p className="signed-in">
                    Signed in as {shortEmail(user.email)}.{" "}
                    <button type="button" onClick={signOut}>Sign out</button>
                </p>
            )}
        </CardPage>
    );
}

// What the request option shows depends on whether they've already asked
function RequestInvite({ user, onRequested }: { user: CurrentUser, onRequested: () => Promise<unknown> }) {
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState("");
    const request = user.request;

    if (request?.status === "pending") {
        return (
            <p className="status">
                <strong>Request sent.</strong> You asked on {date(request.requestedAt)}. We&apos;ll email you when you&apos;re in.
            </p>
        );
    }

    if (request?.status === "rejected") {
        return <p className="status">Your request wasn&apos;t approved this time. An invite code still works if you get one.</p>;
    }

    async function send() {
        setSending(true);

        try {
            const { response, data } = await postJson("/api/beta/request", {});
            if (!response.ok) throw new Error(data?.error ?? `Couldn't send your request (${response.status})`);
            await onRequested();
        } catch (error) {
            setMessage((error as Error).message);
            setSending(false);
        }
    }

    return <>
        <p className="hint">You can only ask once, so we&apos;ll let you know by email.</p>
        <button className="primary" type="button" disabled={sending} onClick={send}>{sending ? <Busy label="Sending…" /> : "Request an invitation"}</button>
        <p className="message" role="alert">{message}</p>
    </>;
}
