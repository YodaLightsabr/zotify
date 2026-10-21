"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import PickHistory, { type Pick } from "@/components/PickHistory";
import { goToLogin } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useLiveVenues } from "@/lib/live";
import { useSchool } from "@/lib/school";
import { useUser } from "@/lib/user";
import RockbotAccounts from "./RockbotAccounts";
import Schools from "./Schools";
import { adminGet, adminPost, formatTime, FormMessage, Loading, Rows, SmallButton, useLoad, when } from "./shared";
import "./admin.css";


export default function AdminPage() {
    const { user } = useUser();
    const school = useSchool();
    const router = useRouter();

    useEffect(() => {
        if (user === null) goToLogin("/admin");
        else if (user && !user.admin) router.replace("/");
    }, [user, router]);

    return (
        <div className="page-admin">
            <main>
                <h1>Admin · {school.shortName}</h1>
                {/* This school's panels, then everything site admins manage across schools */}
                {user?.admin && <>
                    <Version />
                    <NowPlaying />
                    <Beta />
                    <History />
                </>}
                {user?.siteAdmin && <>
                    <Schools />
                    <RockbotAccounts />
                    <TestAccounts />
                    <Cache />
                </>}
            </main>
        </div>
    );
}

/** Refreshes every 20 seconds while the page is visible */
function useEvery20s(callback: () => void) {
    useEffect(() => {
        const timer = setInterval(() => { if (!document.hidden) callback(); }, 20_000);
        return () => clearInterval(timer);
    }, [callback]);
}

// Which commit is running

interface VersionInfo {
    commit: string;
    committedAt: string;
    subject: string;
    url: string | null;
    deployedAt: string | null;
    startedAt: string;
}

const loadVersion = () => adminGet<VersionInfo | null>("/api/admin/version", "the version");
// Baked into the frontend when it was built (see web/next.config.ts)
const FRONTEND_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "";

const timestamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Version() {
    const { data, error } = useLoad(loadVersion);

    return (
        <section className="panel" aria-labelledby="version-title">
            <div className="panel-header">
                <h2 id="version-title">Version</h2>
            </div>
            {data === undefined ? <Loading error={error} />
                : data === null ? <p className="muted">The API couldn&apos;t tell which commit it&apos;s running.</p>
                : <div className="version">
                    <div className="version-commit">
                        {data.url
                            ? <a className="code" href={data.url} target="_blank" rel="noreferrer">{data.commit.slice(0, 7)}</a>
                            : <span className="code">{data.commit.slice(0, 7)}</span>}
                        <span className="version-subject">{data.subject}</span>
                    </div>
                    <div className="muted">
                        Committed {timestamp(data.committedAt)}
                        {data.deployedAt ? ` · deployed ${timestamp(data.deployedAt)}` : " · running from a checkout"}
                        {` · API up since ${timestamp(data.startedAt)}`}
                    </div>
                    {/* Both are built from the same commit, so a difference means one of them didn't restart */}
                    {FRONTEND_COMMIT && FRONTEND_COMMIT !== data.commit && (
                        <div className="error">
                            The frontend is running {FRONTEND_COMMIT.slice(0, 7)}, not {data.commit.slice(0, 7)}. Restart zotify-web, or reload this page if a deploy just finished.
                        </div>
                    )}
                </div>}
        </section>
    );
}

// Now playing at each of the school's venues, live

function NowPlaying() {
    const school = useSchool();
    const lives = useLiveVenues(school.venues.map(venue => venue.id));
    const updatedAt = Math.max(0, ...lives.map(live => live?.receivedAt ?? 0));

    return (
        <section className="panel" aria-labelledby="playing-title">
            <div className="panel-header">
                <h2 id="playing-title">Now playing</h2>
                <span className="muted">{updatedAt > 0 && `Updated ${new Date(updatedAt).toLocaleTimeString()}`}</span>
            </div>
            <div className="venues">
                {school.venues.map(({ id, name }, i) => {
                    const live = lives[i];
                    const playing = live?.queue?.nowPlaying;

                    return (
                        <div className="venue" key={id}>
                            <div className="label">{name}</div>
                            {!live ? <div className="muted">Loading…</div>
                                : !live.queue ? <div className="error">{live.error}</div>
                                : !playing ? <div className="muted">Nothing playing</div>
                                : <>
                                    <div className="song">{playing.name}</div>
                                    <div className="artist">{playing.artist}</div>
                                    <div className="time">
                                        {playing.secondsRemaining !== undefined && `${formatTime(playing.secondsRemaining)} left · `}
                                        {live.queue.onDeck.length + live.queue.comingUp.length} queued
                                    </div>
                                </>}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

// Test accounts: whether a login code is waiting in the server console

interface TestAccount { email: string, activeCode: { createdAt: number, expiresAt: number, attempts: number } | null }

const loadTestAccounts = () => adminGet<TestAccount[]>("/api/admin/test-accounts", "test accounts");

function minutesFromNow(timestamp: number) {
    const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60000));
    return minutes < 1 ? "under a minute" : `${minutes} min`;
}

function TestAccounts() {
    const school = useSchool();
    const { data, error, reload } = useLoad(loadTestAccounts);
    useEvery20s(reload);

    return (
        <section className="panel" aria-labelledby="test-title">
            <div className="panel-header">
                <h2 id="test-title">Test accounts</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>
            <p className="muted test-note">Their login codes are printed in the server console instead of emailed.</p>
            {!data ? <Loading error={error} /> : <Rows>
                {data.map(({ email, activeCode }) => (
                    <div className="row" key={email}>
                        <span className="who">{school.shortEmail(email)}</span>
                        {activeCode
                            ? <span className="code-status active" title={`Requested ${when(activeCode.createdAt)}. Check the server console for the code.`}>
                                Active code · expires in {minutesFromNow(activeCode.expiresAt)}
                                {activeCode.attempts ? ` · ${activeCode.attempts} ${activeCode.attempts === 1 ? "wrong try" : "wrong tries"}` : ""}
                            </span>
                            : <span className="code-status muted">No active code</span>}
                    </div>
                ))}
            </Rows>}
        </section>
    );
}


// Beta: requests, invites, invite codes and members

interface BetaOverview {
    requests: { email: string, status: "pending" | "approved" | "rejected", requestedAt: number, decidedAt?: number }[];
    codes: { code: string, url: string, maxUses: number | null, uses: { email: string, usedAt: number }[], createdBy: string, revokedAt?: number }[];
    members: { email: string, joinedVia: "request" | "invite" | "code", joinedAt: number, approvedBy?: string, code?: string, silent?: boolean }[];
    admins: string[];
}

const loadBeta = () => adminGet<BetaOverview>("/api/admin/beta", "the beta");


function Beta() {
    const school = useSchool();
    const { data, error, reload } = useLoad(loadBeta);
    const [inviteNetId, setInviteNetId] = useState("");
    const [silent, setSilent] = useState(false);
    const [inviteMessage, setInviteMessage] = useState({ text: "", error: false });
    const [maxUses, setMaxUses] = useState("");
    const [codeMessage, setCodeMessage] = useState({ text: "", error: false });

    async function decide(email: string, decision: "approved" | "rejected", silent = false) {
        const result = await adminPost("/api/admin/requests/decide", { email, decision, silent });
        if (decision === "approved" && !silent && !result.emailed) alert(`Approved ${school.shortEmail(email)}, but the email didn't send. They can still sign in normally.`);
        reload();
    }

    async function invite(event: React.FormEvent) {
        event.preventDefault();

        try {
            const result = await adminPost("/api/admin/invites", { netid: inviteNetId, silent });
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
            const { code, url } = await adminPost("/api/admin/codes", { maxUses: maxUses ? Number(maxUses) : null });
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
                                    await adminPost("/api/admin/codes/revoke", { code: code.code });
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

// Pick history: every song queued through Zotify

const loadHistory = () => adminGet<Pick[]>("/api/admin/history", "the history");

function History() {
    const { data, error, reload } = useLoad(loadHistory);

    return (
        <section className="panel" aria-labelledby="history-title">
            <div className="panel-header">
                <h2 id="history-title">Pick history</h2>
                <div>
                    <span className="muted">{data && `${plural(data.length, "pick")}  `}</span>
                    <button className="small" type="button" onClick={reload}>Refresh</button>
                </div>
            </div>
            {!data ? <Loading error={error} /> : <PickHistory picks={data} showRequester emptyText="Nothing queued through Zotify yet." onRequested={reload} />}
        </section>
    );
}

// The cache, as a collapsible tree

const loadCache = async () => {
    const value = await adminGet<unknown>("/api/admin/cache", "the cache");
    return { value, size: new Blob([JSON.stringify(value)]).size };
};

function Cache() {
    const { data, error, reload } = useLoad(loadCache);
    const tree = useRef<HTMLDivElement>(null);

    return (
        <section className="panel" aria-labelledby="cache-title">
            <div className="panel-header">
                <h2 id="cache-title">Cache</h2>
                <div>
                    <span className="muted">{data && `${(data.size / 1024).toFixed(1)} KB  `}</span>
                    <button className="small" type="button" onClick={() => {
                        tree.current?.querySelectorAll<HTMLDetailsElement>("details details[open]").forEach(details => details.open = false);
                    }}>Collapse all</button>
                    <button className="small" type="button" onClick={reload}>Refresh</button>
                </div>
            </div>
            {/* Keyed by size so a refresh redraws the tree */}
            <div className="tree" ref={tree}>{!data ? <Loading error={error} /> : <Branch key={data.size} name="cache" value={data.value as object} open />}</div>
        </section>
    );
}

// Numbers that look like millisecond timestamps get a readable note
function TimestampNote({ value }: { value: unknown }) {
    if (typeof value !== "number" || value < 1.5e12 || value > 2.5e12) return null;

    const minutes = Math.round((value - Date.now()) / 60000);
    const abs = Math.abs(minutes);
    const span = abs < 60 ? `${abs} min` : abs < 2880 ? `${Math.round(abs / 60)} hr` : `${Math.round(abs / 1440)} days`;
    return <span className="note" title={new Date(value).toLocaleString()}>{minutes >= 0 ? `in ${span}` : `${span} ago`}</span>;
}

const Node = ({ name, value }: { name: string, value: unknown }) => value !== null && typeof value === "object"
    ? <Branch name={name} value={value} />
    : <div className="leaf"><span className="key">{name}</span>: <span className={value === null ? "null" : typeof value}>{JSON.stringify(value)}</span><TimestampNote value={value} /></div>;

// Branches are only drawn once opened, so even a large cache renders instantly
function Branch({ name, value, open = false }: { name: string, value: object, open?: boolean }) {
    const [drawn, setDrawn] = useState(open);
    const entries = Array.isArray(value) ? value.map((item, i) => [String(i), item] as const) : Object.entries(value);

    return (
        <details open={open} onToggle={event => { if (event.currentTarget.open) setDrawn(true); }}>
            <summary><span className="key">{name}</span> <span className="count">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
            <div className="children">{drawn && entries.map(([key, child]) => <Node key={key} name={key} value={child} />)}</div>
        </details>
    );
}
