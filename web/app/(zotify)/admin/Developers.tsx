"use client";

import { useState } from "react";
import { useSchool } from "@/lib/school";
import { adminGet, adminSend, FormMessage, Loading, Rows, SmallButton, useLoad, when } from "./shared";

// Who can use the public API, for site admins. Developers make personal access tokens and OAuth apps at /developers; taking
// someone off deletes their tokens, but their apps keep working for people signed in to them

interface Developer {
    email: string;
    addedBy: string;
    addedAt: number;
}

const loadDevelopers = () => adminGet<Developer[]>("/v1/admin/developers", "the developers");

export default function Developers() {
    const school = useSchool();
    const { data, error, reload } = useLoad(loadDevelopers);
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState({ text: "", error: false });

    async function add(event: React.FormEvent) {
        event.preventDefault();

        try {
            await adminSend("PUT", `/v1/admin/developers/${encodeURIComponent(email.trim())}`);
            setMessage({ text: `${email.trim()} is a developer now.`, error: false });
            setEmail("");
            reload();
        } catch (err) {
            setMessage({ text: (err as Error).message, error: true });
        }
    }

    return (
        <section className="panel" aria-labelledby="developers-title">
            <div className="panel-header">
                <h2 id="developers-title">Developers</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>
            <p className="muted">
                They can make API tokens and OAuth apps at <a href="/developers">/developers</a>. Removing someone deletes their tokens; their apps keep working.
            </p>

            {!data ? <Loading error={error} /> : <Rows>
                {data.map(developer => (
                    <div className="row" key={developer.email}>
                        <div>
                            <span className="who">{school.shortEmail(developer.email)}</span>
                            <span className="muted">  added by {school.shortEmail(developer.addedBy)} · {when(developer.addedAt)}</span>
                        </div>
                        <div className="actions">
                            <SmallButton label="Remove" className="reject" onClick={async () => {
                                if (!confirm(`Remove ${developer.email}? Their tokens stop working right away.`)) throw new Error("Cancelled");
                                await adminSend("DELETE", `/v1/admin/developers/${encodeURIComponent(developer.email)}`);
                                reload();
                            }} />
                        </div>
                    </div>
                ))}
            </Rows>}

            <h3>Add a developer</h3>
            <form className="inline-form" onSubmit={add}>
                <input type="text" required placeholder={school.emailDomain ? school.idPlaceholder ?? "" : "you@example.com"} autoCapitalize="none" spellCheck={false}
                    aria-label="Who to add" value={email} onChange={event => setEmail(event.target.value)} />
                <button className="small primary-small" type="submit">Add developer</button>
            </form>
            <FormMessage message={message} />
        </section>
    );
}
