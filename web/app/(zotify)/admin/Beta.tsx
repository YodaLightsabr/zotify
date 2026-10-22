"use client";

import { useCallback, useState } from "react";
import { cx } from "@/lib/format";
import { useSchool } from "@/lib/school";
import { adminGet, adminPost, adminSend, FormMessage, Loading, Rows, SmallButton, useLoad, when } from "./shared";

// Beta: requests, invites, invite codes and members

interface BetaOverview {
    requests: { email: string, status: "pending" | "approved" | "rejected", requestedAt: number, decidedAt?: number }[];
    codes: { code: string, url: string, maxUses: number | null, uses: { email: string, usedAt: number }[], createdBy: string, revokedAt?: number }[];
    members: { email: string, joinedVia: "request" | "invite" | "code", joinedAt: number, approvedBy?: string, code?: string, silent?: boolean }[];
    admins: string[];
}

export default function Beta() {
    const school = useSchool();
    const base = `/v1/schools/${school.id}`;
    const { data, error, reload } = useLoad(useCallback(() => adminGet<BetaOverview>(`${base}/beta`, "the beta"), [base]));
    const [inviteNetId, setInviteNetId] = useState("");
    const [silent, setSilent] = useState(false);
    const [inviteMessage, setInviteMessage] = useState({ text: "", error: false });
    const [maxUses, setMaxUses] = useState("");
    const [codeMessage, setCodeMessage] = useState({ text: "", error: false });

    async function decide(email: string, decision: "approved" | "rejected", silent = false) {
        const result = await adminPost(`${base}/beta/decisions`, { email, decision, silent });
        if (decision === "approved" && !silent && !result.emailed) alert(`Approved ${school.shortEmail(email)}, but the email didn't send. They can still sign in normally.`);
        reload();
    }

    async function invite(event: React.FormEvent) {
        event.preventDefault();

        try {
            const result = await adminPost(`${base}/beta/invites`, { netid: inviteNetId, silent });
            const who = school.shortEmail(result.email);
            setInviteMessage(silent ? { text: `Added ${who} without an email.`, error: false }
                : result.emailed ? { text: `Invited ${who}. They've been emailed a sign-in link.`, error: false }
                : { text: `Added ${who}, but the email didn't send.`, error: true });
            setInviteNetId("");
            reload();
        } catch (error) {
            setInviteMessage({ text: (error as Error).message, error: true });
        }
    }

    async function createCode(event: React.FormEvent) {
        event.preventDefault();

        try {
            const { code, url } = await adminPost(`${base}/invite-codes`, { maxUses: maxUses ? Number(maxUses) : null });
            setCodeMessage({ text: `Created ${code}: ${url}`, error: false });
            setMaxUses("");
            reload();
        } catch (error) {
            setCodeMessage({ text: (error as Error).message, error: true });
        }
    }

    const pending = data?.requests.filter(request => request.status === "pending") ?? [];
    const rejected = data?.requests.filter(request => request.status === "rejected") ?? [];

    return (
        <section className="panel" aria-labelledby="beta-title">
            <div className="panel-header">
                <h2 id="beta-title">Beta</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>

            <h3>Pending requests</h3>
            {!data ? <Loading error={error} /> : <Rows>
                {pending.map(request => (
                    <div className="row" key={request.email}>
                        <div><span className="who">{school.shortEmail(request.email)}</span><span className="muted">  asked {when(request.requestedAt)}</span></div>
                        <div className="actions">
                            <SmallButton label="Approve" className="primary-small" onClick={() => decide(request.email, "approved")} />
                            <SmallButton label="Approve silently" onClick={() => decide(request.email, "approved", true)} />
                            <SmallButton label="Reject" className="reject" onClick={() => decide(request.email, "rejected")} />
                        </div>
                    </div>
                ))}
            </Rows>}

            <h3>Invite by {school.emailDomain && school.idLabel ? `${school.idLabel} or email` : "email"}</h3>
            <form className="inline-form" onSubmit={invite}>
                <input type="text" placeholder={school.emailDomain ? school.idPlaceholder ?? "" : "you@example.com"} required autoCapitalize="none" spellCheck={false} aria-label="Who to invite"
                    value={inviteNetId} onChange={event => setInviteNetId(event.target.value)} />
                <label className="checkbox"><input type="checkbox" checked={silent} onChange={event => setSilent(event.target.checked)} /> Silent (no email)</label>
                <button className="small primary-small" type="submit">Invite</button>
            </form>
            <FormMessage message={inviteMessage} />

            <h3>Invite codes</h3>
            <form className="inline-form" onSubmit={createCode}>
                <input type="number" min="1" step="1" placeholder="Unlimited" aria-label="Maximum uses (leave empty for unlimited)"
                    value={maxUses} onChange={event => setMaxUses(event.target.value)} />
                <button className="small primary-small" type="submit">New code</button>
            </form>
            <FormMessage message={codeMessage} />
            {data && <Rows>
                {data.codes.map(code => (
                    <div className={cx("row", !!code.revokedAt && "revoked")} key={code.code}>
                        <div>
                            <span className="code">{code.code}</span>
                            <span className="muted">
                                {"  "}{code.maxUses === null ? `${code.uses.length} used` : `${code.uses.length} / ${code.maxUses} used`}
                                {code.revokedAt ? " · revoked" : ""} · by {school.shortEmail(code.createdBy)}
                            </span>
                            {code.uses.length > 0 && (
                                <details>
                                    <summary>Used by</summary>
                                    {code.uses.map(use => <div key={use.email}>{school.shortEmail(use.email)}, {when(use.usedAt)}</div>)}
                                </details>
                            )}
                        </div>
                        <div className="actions">
                            {!code.revokedAt && <>
                                <SmallButton label="Copy link" onClick={async () => {
                                    await navigator.clipboard.writeText(code.url);
                                    setCodeMessage({ text: `Copied ${code.url}`, error: false });
                                }} />
                                <SmallButton label="Revoke" className="reject" onClick={async () => {
                                    if (!confirm(`Revoke ${code.code}? Nobody new can use it after this.`)) throw new Error("Cancelled");
                                    await adminSend("DELETE", `${base}/invite-codes/${encodeURIComponent(code.code)}`);
                                    reload();
                                }} />
                            </>}
                        </div>
                    </div>
                ))}
            </Rows>}

            <h3>Members</h3>
            {data && <Rows>
                {[
                    ...data.admins.map(email => (
                        <div className="row" key={`admin-${email}`}><span className="who">{school.shortEmail(email)}</span><span className="muted">admin</span></div>
                    )),
                    ...data.members.map(member => {
                        const how = member.joinedVia === "code"
                            ? `code ${member.code}`
                            : `${member.joinedVia}${member.approvedBy ? ` by ${school.shortEmail(member.approvedBy)}` : ""}${member.silent ? " (silent)" : ""}`;
                        return <div className="row" key={`member-${member.email}`}><span className="who">{school.shortEmail(member.email)}</span><span className="muted">{how} · {when(member.joinedAt)}</span></div>;
                    }),
                    ...rejected.map(request => (
                        <div className="row revoked" key={`rejected-${request.email}`}>
                            <span className="who">{school.shortEmail(request.email)}</span><span className="muted">rejected · {request.decidedAt ? when(request.decidedAt) : ""}</span>
                        </div>
                    ))
                ]}
            </Rows>}
        </section>
    );
}
