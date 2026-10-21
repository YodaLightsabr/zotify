"use client";

import { useState } from "react";
import { adminGet, adminPost, FormMessage, Loading, Rows, SmallButton, useLoad, when } from "./shared";

// The Rockbot accounts Zotify queues and votes with, for site admins. Their secrets are write-only: the server never sends
// refresh tokens, keys or passwords back, so editing an account only changes what's filled in

export interface RockbotAccount {
    username: string;
    email: string;
    hasPassword: boolean;
    addedAt: number;
    // The venue it's the home account for, if any
    homeOf: string | null;
}

export const loadAccounts = () => adminGet<RockbotAccount[]>("/api/admin/rockbot-accounts", "the Rockbot accounts");

const EMPTY = { username: "", email: "", refreshToken: "", key: "", password: "" };

export default function RockbotAccounts() {
    const { data, error, reload } = useLoad(loadAccounts);
    const [form, setForm] = useState(EMPTY);
    // Set when editing an existing account, whose secrets can be left empty to keep them
    const [editing, setEditing] = useState<string | null>(null);
    const [message, setMessage] = useState({ text: "", error: false });

    const field = (name: keyof typeof EMPTY) => ({
        value: form[name],
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: event.target.value })
    });

    async function save(event: React.FormEvent) {
        event.preventDefault();

        try {
            const result = await adminPost("/api/admin/rockbot-accounts", form);
            setMessage({ text: result.updated ? `Updated ${result.username}.` : `Added ${result.username}.`, error: false });
            setForm(EMPTY);
            setEditing(null);
            reload();
        } catch (err) {
            setMessage({ text: (err as Error).message, error: true });
        }
    }

    return (
        <section className="panel" aria-labelledby="accounts-title">
            <div className="panel-header">
                <h2 id="accounts-title">Rockbot accounts</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>
            <p className="muted">
                Every venue queues and votes with these. A venue&apos;s home account (set under Schools) only ever checks in there; the rest are shared.
            </p>

            {!data ? <Loading error={error} /> : <Rows>
                {data.map(account => (
                    <div className="row" key={account.username}>
                        <div>
                            <span className="who">{account.username}</span>
                            <span className="muted">  {account.email}{account.homeOf ? ` · home account at ${account.homeOf}` : ""} · added {when(account.addedAt)}</span>
                        </div>
                        <div className="actions">
                            <SmallButton label="Edit" onClick={async () => {
                                setEditing(account.username);
                                setForm({ ...EMPTY, username: account.username, email: account.email });
                                setMessage({ text: "", error: false });
                            }} />
                            <SmallButton label="Remove" className="reject" onClick={async () => {
                                if (!confirm(`Remove ${account.username}? Zotify stops using it right away.`)) throw new Error("Cancelled");
                                await adminPost("/api/admin/rockbot-accounts/delete", { username: account.username });
                                reload();
                            }} />
                        </div>
                    </div>
                ))}
            </Rows>}

            <h3>{editing ? `Edit ${editing}` : "Add an account"}</h3>
            <form className="stacked-form" onSubmit={save}>
                <div className="form-grid">
                    <label>Username<input type="text" required readOnly={!!editing} autoComplete="off" spellCheck={false} {...field("username")} /></label>
                    <label>Email<input type="email" required={!editing} autoComplete="off" {...field("email")} /></label>
                    <label>Refresh token<input type="password" required={!editing} autoComplete="off" placeholder={editing ? "Unchanged" : ""} {...field("refreshToken")} /></label>
                    <label>Key<input type="password" required={!editing} autoComplete="off" placeholder={editing ? "Unchanged" : ""} {...field("key")} /></label>
                    <label>Password (optional)<input type="password" autoComplete="off" placeholder={editing ? "Unchanged" : ""} {...field("password")} /></label>
                </div>
                <div className="form-actions">
                    <button className="small primary-small" type="submit">{editing ? "Save" : "Add account"}</button>
                    {editing && <button className="small" type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
                </div>
            </form>
            <FormMessage message={message} />
        </section>
    );
}
