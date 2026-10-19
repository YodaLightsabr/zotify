"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import CardPage from "@/components/CardPage";
import { Busy } from "@/components/Spinner";
import { postJson, safeNext } from "@/lib/api";
import { cx } from "@/lib/format";
import { useUser } from "@/lib/user";

export default function LoginPage() {
    return <Suspense><Login /></Suspense>;
}

function Login() {
    const router = useRouter();
    const params = useSearchParams();
    const { user, refresh } = useUser();
    const next = safeNext(params.get("next"));

    const [step, setStep] = useState<"netid" | "code">("netid");
    const [netId, setNetId] = useState("");
    const [code, setCode] = useState("");
    const [hint, setHint] = useState("");
    // Links that sent people here with a problem, like an expired sign-in link
    const [netIdMessage, setNetIdMessage] = useState(params.get("error") ?? "");
    const [codeMessage, setCodeMessage] = useState("");
    const [busy, setBusy] = useState<"send" | "resend" | "verify" | null>(null);

    const netIdForm = useRef<HTMLFormElement>(null);
    const codeForm = useRef<HTMLFormElement>(null);
    const netIdInput = useRef<HTMLInputElement>(null);
    const codeInput = useRef<HTMLInputElement>(null);

    // Approved people go back where they came from. Everyone else sees the private beta screen,
    // except on an invite link, which lets them in itself once they're signed in
    function goOn(approved: boolean) {
        router.replace(approved || next.startsWith("/invite/") ? next : `/beta?${new URLSearchParams({ next })}`);
    }

    // Already signed in? Skip ahead
    useEffect(() => {
        if (user) goOn(user.approved);
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    // Each step's field gets the focus once it shows
    const firstStep = useRef(true);

    useEffect(() => {
        if (step === "code") codeInput.current?.focus();
        else if (!firstStep.current) netIdInput.current?.select();
        firstStep.current = false;
    }, [step]);

    async function sendCode(which: "send" | "resend") {
        setBusy(which);
        setNetIdMessage("");
        setCodeMessage("");

        try {
            const { response, data } = await postJson("/api/auth/request-code", { netid: netId.trim() });
            if (!response.ok) throw new Error(data?.error ?? `Couldn't send a code (${response.status})`);

            setHint(data.delivery === "console"
                ? `Enter the 6-digit code for ${data.email}. Email isn't set up, so it's printed in the server console.`
                : `We emailed a 6-digit code to ${data.email}. It may take a minute to arrive.`);
            setCode("");
            setStep("code");
        } catch (error) {
            (step === "netid" ? setNetIdMessage : setCodeMessage)((error as Error).message);
        } finally {
            setBusy(null);
        }
    }

    async function verify() {
        setBusy("verify");

        try {
            const { response, data } = await postJson("/api/auth/verify", { netid: netId.trim(), code });
            if (!response.ok) throw new Error(data?.error ?? `Couldn't sign in (${response.status})`);

            // Refreshing the signed-in user sends them on, through the effect above
            await refresh();
        } catch (error) {
            setCodeMessage((error as Error).message);
            setBusy(null);
            codeInput.current?.select();
        }
    }

    return (
        <CardPage>
            <h1>Sign in</h1>
            <p className="subtitle">Sign in with your UCInetID or email to search and queue songs.</p>

            <form ref={netIdForm} hidden={step !== "netid"} noValidate onSubmit={event => {
                event.preventDefault();
                if (netIdForm.current?.reportValidity()) sendCode("send");
            }}>
                <label htmlFor="netid">UCInetID or email</label>
                {/* Typing or pasting a full address drops the "@uci.edu" suffix and gives the input the whole row */}
                <div className={cx("field", netId.trim().includes("@") && "full-address")}>
                    {/* Accepts a UCInetID like "panteater" (which gets @uci.edu), or any full email address during the testing phase */}
                    <input ref={netIdInput} id="netid" name="netid" type="text" placeholder="panteater" required
                        pattern="[A-Za-z0-9][A-Za-z0-9._\-]*|[^\s@]+@[^\s@]+\.[^\s@]+"
                        title="Your UCInetID, like panteater, or your email address"
                        autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                        value={netId} onChange={event => { setNetId(event.target.value); setNetIdMessage(""); }} />
                    <span className="suffix" aria-hidden="true">@uci.edu</span>
                </div>
                <p className="message" role="alert">{netIdMessage}</p>
                <button className="primary" type="submit" disabled={!!busy}>{busy === "send" ? <Busy label="Sending…" /> : "Send code"}</button>
            </form>

            <form ref={codeForm} hidden={step !== "code"} noValidate onSubmit={event => {
                event.preventDefault();
                if (codeForm.current?.reportValidity()) verify();
            }}>
                <label htmlFor="code">Login code</label>
                <p className="hint">{hint}</p>
                <div className="field">
                    <input ref={codeInput} id="code" name="code" className="code-input" type="text" inputMode="numeric" placeholder="000000"
                        required pattern="[0-9]{6}" maxLength={6} title="The 6-digit code we sent you" autoComplete="one-time-code"
                        // Keep only digits, so pasting "123 456" works
                        value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setCodeMessage(""); }} />
                </div>
                <p className="message" role="alert">{codeMessage}</p>
                <button className="primary" type="submit" disabled={!!busy}>{busy === "verify" ? <Busy label="Signing in…" /> : "Sign in"}</button>
                <div className="links">
                    <button type="button" onClick={() => setStep("netid")}>Use a different email</button>
                    <button type="button" disabled={!!busy} onClick={() => sendCode("resend")}>
                        {busy === "resend" ? <Busy label="Sending…" /> : "Send a new code"}
                    </button>
                </div>
            </form>
        </CardPage>
    );
}
