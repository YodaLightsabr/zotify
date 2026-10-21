"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { deleteJson, getJson, goToLogin, postJson, sendJson } from "@/lib/api";
import { DOCS_URL } from "@/lib/config";
import { cx } from "@/lib/format";
import { useUser } from "@/lib/user";
import "./developers.css";

// For developers: personal access tokens for the API, and OAuth apps other people can sign in to (see src/developers.ts).
// Tokens and client secrets are only ever shown once, right after they're made

interface Token {
    id: number;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: number;
    expiresAt: number | null;
    lastUsedAt: number | null;
}

interface App {
    clientId: string;
    name: string;
    description: string | null;
    homepageUrl: string | null;
    redirectUris: string[];
    confidential: boolean;
    createdAt: number;
}

interface ApiIndex {
    scopes: Record<string, string>;
    tokenLifetimes: (number | null)[];
}

const day = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Loads a list and reloads it on demand. Errors come back as text */
function useList<T>(path: string, enabled: boolean) {
    const [state, setState] = useState<{ data?: T[], error?: string }>({});

    const reload = useCallback(async () => {
        const { response, data } = await getJson<T[]>(path);
        setState(response.ok ? { data } : { error: (data as any)?.error ?? `Couldn't load this (${response.status})` });
    }, [path]);

    useEffect(() => { if (enabled) reload(); }, [enabled, reload]);
    return { ...state, reload };
}

export default function DevelopersPage() {
    const { user } = useUser();
    const [index, setIndex] = useState<ApiIndex | null>(null);

    useEffect(() => {
        if (user === null) goToLogin("/developers");
    }, [user]);

    useEffect(() => {
        getJson<ApiIndex>("/v1").then(({ data }) => setIndex(data));
    }, []);

    return (
        <div className="page-developers">
            <main>
                <h1>Developers</h1>
                <p className="intro">
                    Build on Zotify with its API: search, request songs, vote, and read Zotify Meals. Everything&apos;s explained at{" "}
                    <a href={DOCS_URL}>{new URL(DOCS_URL).host}</a>.
                </p>

                {user === undefined && <Spinner small />}

                {user && !user.developer && (
                    <section className="dev-panel">
                        <p>You&apos;re not a developer yet. Ask a Zotify admin to add you, and you&apos;ll be able to make tokens and apps here.</p>
                    </section>
                )}

                {user?.developer && index && <>
                    <Tokens index={index} />
                    <Apps scopes={index.scopes} />
                </>}
            </main>
        </div>
    );
}

/** A secret to copy now, since it won't be shown again */
function Reveal({ label, value, onDone }: { label: string, value: string, onDone: () => void }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="reveal" role="status">
            <p><strong>{label}</strong> Copy it now; you won&apos;t see it again.</p>
            <div className="reveal-value">
                <code>{value}</code>
                <button type="button" className="dev-button small" onClick={async () => {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                }}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <button type="button" className="dev-link" onClick={onDone}>Done</button>
        </div>
    );
}

function ScopePicker({ scopes, value, onChange }: { scopes: Record<string, string>, value: string[], onChange: (scopes: string[]) => void }) {
    return (
        <fieldset className="scope-picker">
            <legend>Scopes</legend>
            {Object.entries(scopes).map(([scope, description]) => (
                <label key={scope}>
                    <input type="checkbox" checked={value.includes(scope)}
                        onChange={event => onChange(event.target.checked ? [...value, scope] : value.filter(entry => entry !== scope))} />
                    <span><code>{scope}</code> {description}</span>
                </label>
            ))}
        </fieldset>
    );
}

// Personal access tokens

function Tokens({ index }: { index: ApiIndex }) {
    const { data, error, reload } = useList<Token>("/v1/me/tokens", true);
    const [form, setForm] = useState({ name: "", scopes: ["music:read"], expiresInDays: "90" });
    const [created, setCreated] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    async function create(event: React.FormEvent) {
        event.preventDefault();
        setMessage("");

        const { response, data } = await postJson<Token & { token: string, error?: string }>("/v1/me/tokens", {
            name: form.name,
            scopes: form.scopes,
            expiresInDays: form.expiresInDays === "never" ? null : Number(form.expiresInDays)
        });

        if (!response.ok) return setMessage(data?.error ?? "Couldn't make the token.");
        setCreated(data.token);
        setForm({ ...form, name: "" });
        reload();
    }

    return (
        <section className="dev-panel" aria-labelledby="tokens-title">
            <h2 id="tokens-title">Personal access tokens</h2>
            <p className="muted">For your own scripts and tools. A token acts as you, limited to its scopes. Send it as <code>Authorization: Bearer …</code>.</p>

            {created && <Reveal label="Your new token." value={created} onDone={() => setCreated(null)} />}

            {!data ? (error ? <p className="error">{error}</p> : <Spinner small />) : data.length > 0 && (
                <ul className="dev-list">
                    {data.map(token => {
                        const expired = token.expiresAt !== null && token.expiresAt < Date.now();
                        return (
                            <li key={token.id} className={cx(expired && "expired")}>
                                <div>
                                    <div className="dev-name">{token.name} <code className="muted">{token.prefix}…</code></div>
                                    <div className="muted small">
                                        {token.scopes.join(", ")} · {expired ? "expired" : token.expiresAt ? `expires ${day(token.expiresAt)}` : "never expires"}
                                        {" · "}{token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : "never used"}
                                    </div>
                                </div>
                                <button type="button" className="dev-button small danger" onClick={async () => {
                                    if (!confirm(`Delete "${token.name}"? Anything using it stops working right away.`)) return;
                                    await deleteJson(`/v1/me/tokens/${token.id}`);
                                    reload();
                                }}>Delete</button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <form className="dev-form" onSubmit={create}>
                <h3>New token</h3>
                <label>Name<input type="text" required maxLength={60} placeholder="My script" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                <ScopePicker scopes={index.scopes} value={form.scopes} onChange={scopes => setForm({ ...form, scopes })} />
                <label>Expires
                    <select value={form.expiresInDays} onChange={event => setForm({ ...form, expiresInDays: event.target.value })}>
                        {index.tokenLifetimes.map(days => days === null
                            ? <option key="never" value="never">Never</option>
                            : <option key={days} value={days}>In {days} days</option>)}
                    </select>
                </label>
                <button type="submit" className="dev-button primary" disabled={!form.scopes.length}>Make token</button>
                {message && <p className="error">{message}</p>}
            </form>
        </section>
    );
}

// OAuth apps

const EMPTY_APP = { name: "", description: "", homepageUrl: "", redirectUris: "", confidential: false };

function Apps({ scopes }: { scopes: Record<string, string> }) {
    const { data, error, reload } = useList<App>("/v1/me/apps", true);
    const [form, setForm] = useState(EMPTY_APP);
    // The app being edited, if one is
    const [editing, setEditing] = useState<string | null>(null);
    const [secret, setSecret] = useState<{ app: string, value: string } | null>(null);
    const [message, setMessage] = useState("");

    async function save(event: React.FormEvent) {
        event.preventDefault();
        setMessage("");

        const body = { ...form, redirectUris: form.redirectUris.split(/\s+/).filter(Boolean) };
        // New confidential apps come with their client secret
        const { response, data } = editing
            ? await sendJson<App & { clientSecret?: undefined, error?: string }>("PATCH", `/v1/me/apps/${editing}`, body)
            : await postJson<App & { clientSecret: string | null, error?: string }>("/v1/me/apps", body);

        if (!response.ok) return setMessage(data?.error ?? "Couldn't save the app.");
        if (data.clientSecret) setSecret({ app: data.name, value: data.clientSecret });
        setForm(EMPTY_APP);
        setEditing(null);
        reload();
    }

    return (
        <section className="dev-panel" aria-labelledby="apps-title">
            <h2 id="apps-title">OAuth apps</h2>
            <p className="muted">
                For apps other people sign in to, like a Raycast extension. They&apos;re sent to Zotify to allow your app the scopes it asks for, and come back with a code.
                Public apps (desktop, mobile, Raycast) use PKCE; confidential apps run on a server and get a client secret. People who sign in see your email address.
            </p>

            {secret && <Reveal label={`${secret.app}'s client secret.`} value={secret.value} onDone={() => setSecret(null)} />}

            {!data ? (error ? <p className="error">{error}</p> : <Spinner small />) : data.length > 0 && (
                <ul className="dev-list">
                    {data.map(app => (
                        <li key={app.clientId}>
                            <div>
                                <div className="dev-name">{app.name} <span className="muted small">{app.confidential ? "Confidential" : "Public"}</span></div>
                                <div className="small">Client ID <code>{app.clientId}</code></div>
                                <div className="muted small">Redirects to {app.redirectUris.join(", ")}</div>
                            </div>
                            <div className="dev-actions">
                                <button type="button" className="dev-button small" onClick={() => {
                                    setEditing(app.clientId);
                                    setForm({ name: app.name, description: app.description ?? "", homepageUrl: app.homepageUrl ?? "", redirectUris: app.redirectUris.join("\n"), confidential: app.confidential });
                                    setMessage("");
                                }}>Edit</button>
                                {app.confidential && (
                                    <button type="button" className="dev-button small" onClick={async () => {
                                        if (!confirm(`Replace ${app.name}'s client secret? The old one stops working right away.`)) return;
                                        const { data } = await postJson<{ clientSecret: string }>(`/v1/me/apps/${app.clientId}/secret`, {});
                                        if (data?.clientSecret) setSecret({ app: app.name, value: data.clientSecret });
                                    }}>New secret</button>
                                )}
                                <button type="button" className="dev-button small danger" onClick={async () => {
                                    if (!confirm(`Delete ${app.name}? Everyone signed in to it is signed out.`)) return;
                                    await deleteJson(`/v1/me/apps/${app.clientId}`);
                                    reload();
                                }}>Delete</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <form className="dev-form" onSubmit={save}>
                <h3>{editing ? `Edit ${form.name || "app"}` : "New app"}</h3>
                <label>Name<input type="text" required maxLength={60} placeholder="Zotify for Raycast" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                <label>Description (optional)<input type="text" maxLength={300} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
                <label>Homepage (optional)<input type="url" placeholder="https://" value={form.homepageUrl} onChange={event => setForm({ ...form, homepageUrl: event.target.value })} /></label>
                <label>Redirect URIs, one per line
                    <textarea required rows={3} spellCheck={false} placeholder="https://raycast.com/redirect?packageName=Extension"
                        value={form.redirectUris} onChange={event => setForm({ ...form, redirectUris: event.target.value })} />
                </label>
                {!editing && (
                    <label className="checkbox">
                        <input type="checkbox" checked={form.confidential} onChange={event => setForm({ ...form, confidential: event.target.checked })} />
                        Confidential: it runs on a server and can keep a client secret
                    </label>
                )}
                <p className="muted small">Apps ask for scopes when they send people to sign in: {Object.keys(scopes).join(", ")}.</p>
                <div className="dev-actions">
                    <button type="submit" className="dev-button primary">{editing ? "Save" : "Make app"}</button>
                    {editing && <button type="button" className="dev-button" onClick={() => { setEditing(null); setForm(EMPTY_APP); }}>Cancel</button>}
                </div>
                {message && <p className="error">{message}</p>}
            </form>
        </section>
    );
}
