"use client";

import { useState } from "react";
import SuffixInput from "@/components/SuffixInput";
import { MAIN_HOST, SITE_DOMAIN } from "@/lib/config";
import type { SchoolInfo } from "@/lib/school";
import { loadAccounts, type RockbotAccount } from "./RockbotAccounts";
import { adminGet, adminPost, adminSend, FormMessage, Loading, Rows, SmallButton, useLoad } from "./shared";

// Schools, their venues and admins, for site admins. Each school's Zotify is www.zotify.app (the main school) or a subdomain of
// it. Changes reach the schools' sites within about 30 seconds, since the frontend checks the list of schools that often

interface AdminVenue { id: string, schoolId: string, name: string, rockbotId: string, homeAccount: string | null }
interface AdminSchool extends Omit<SchoolInfo, "venues"> { venues: AdminVenue[], admins: string[] }

const loadSchools = () => adminGet<AdminSchool[]>("/v1/admin/schools", "the schools");
const loadEverything = () => Promise.all([loadSchools(), loadAccounts()]).then(([schools, accounts]) => ({ schools, accounts }));

export default function Schools() {
    const { data, error, reload } = useLoad(loadEverything);

    return (
        <section className="panel" aria-labelledby="schools-title">
            <div className="panel-header">
                <h2 id="schools-title">Schools</h2>
                <button className="small" type="button" onClick={reload}>Refresh</button>
            </div>
            <p className="muted">Changes show on each school&apos;s site within about 30 seconds.</p>

            {!data ? <Loading error={error} /> : <>
                {data.schools.map(school => <SchoolCard key={school.id} school={school} accounts={data.accounts} reload={reload} />)}
                <div className="school-card">
                    <h3>Add a school</h3>
                    <SchoolForm onSaved={reload} />
                </div>
            </>}
        </section>
    );
}

function SchoolCard({ school, accounts, reload }: { school: AdminSchool, accounts: RockbotAccount[], reload: () => void }) {
    const [editing, setEditing] = useState(false);
    const main = !school.subdomain;

    return (
        <div className="school-card">
            <div className="row-header">
                <div>
                    <span className="who">{school.name}</span>
                    <span className="muted">  {school.shortName} · <a href={school.url} target="_blank" rel="noreferrer">{school.url.replace(/^https?:\/\//, "")}</a>{main ? " (main site)" : ""}</span>
                </div>
                <div className="actions">
                    <SmallButton label={editing ? "Close" : "Edit details"} onClick={async () => setEditing(!editing)} />
                    {!main && !school.venues.length && (
                        <SmallButton label="Remove" className="reject" onClick={async () => {
                            if (!confirm(`Remove ${school.name}? ${school.url} will send people to the main site.`)) throw new Error("Cancelled");
                            await adminSend("DELETE", `/v1/admin/schools/${school.id}`);
                            reload();
                        }} />
                    )}
                </div>
            </div>

            {editing && <SchoolForm school={school} onSaved={() => { setEditing(false); reload(); }} />}

            <h3>Venues</h3>
            <Rows>{school.venues.map(venue => <VenueRow key={venue.id} venue={venue} accounts={accounts} reload={reload} />)}</Rows>
            <AddVenue schoolId={school.id} accounts={accounts} reload={reload} />

            <h3>Admins</h3>
            <p className="muted">They run this school&apos;s beta, requests and history. Site admins can run every school.</p>
            <Admins school={school} reload={reload} />
        </div>
    );
}

/** A school's details. Without a school, it adds a new one, whose ID is its subdomain */
function SchoolForm({ school, onSaved }: { school?: AdminSchool, onSaved: () => void }) {
    const [form, setForm] = useState({
        subdomain: school?.subdomain ?? "",
        name: school?.name ?? "",
        shortName: school?.shortName ?? "",
        emailDomain: school?.emailDomain ?? "",
        idLabel: school?.idLabel ?? "",
        idPlaceholder: school?.idPlaceholder ?? "",
        tagline: school?.tagline ?? "",
        footer: school?.footer ?? ""
    });
    const [message, setMessage] = useState({ text: "", error: false });
    const main = !!school && !school.subdomain;

    const field = (name: keyof typeof form) => ({
        value: form[name],
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: event.target.value })
    });

    async function save(event: React.FormEvent) {
        event.preventDefault();

        try {
            const saved = await adminPost("/v1/admin/schools", { ...form, id: school?.id ?? form.subdomain.trim().toLowerCase() });
            setMessage({ text: school ? "Saved." : `Added ${saved.name} at ${saved.url}.`, error: false });
            if (!school) setForm({ subdomain: "", name: "", shortName: "", emailDomain: "", idLabel: "", idPlaceholder: "", tagline: "", footer: "" });
            onSaved();
        } catch (error) {
            setMessage({ text: (error as Error).message, error: true });
        }
    }

    return (
        <form className="stacked-form" onSubmit={save}>
            <div className="form-grid">
                <label>
                    Address
                    {main
                        ? <input type="text" value={MAIN_HOST} disabled />
                        : <SuffixInput compact suffix={`.${SITE_DOMAIN}`} placeholder="uf" required autoCapitalize="none" spellCheck={false} {...field("subdomain")} />}
                </label>
                <label>Name<input type="text" required placeholder="University of Florida" {...field("name")} /></label>
                <label>Short name<input type="text" required placeholder="UF" {...field("shortName")} /></label>
                <label>Email domain<input type="text" placeholder="ufl.edu" autoCapitalize="none" spellCheck={false} {...field("emailDomain")} /></label>
                <label>What IDs are called<input type="text" placeholder="GatorLink username" {...field("idLabel")} /></label>
                <label>Example ID<input type="text" placeholder="albertgator" {...field("idPlaceholder")} /></label>
                <label>Tagline<input type="text" placeholder="Get your song into the queue." {...field("tagline")} /></label>
                <label>Footer<input type="text" placeholder="Made with ♪" {...field("footer")} /></label>
            </div>
            <p className="muted">
                With an email domain, people can sign in with just their ID{form.idPlaceholder ? `, like ${form.idPlaceholder}` : ""}; without one, they use a full email.
            </p>
            <div className="form-actions"><button className="small primary-small" type="submit">{school ? "Save" : "Add school"}</button></div>
            <FormMessage message={message} />
        </form>
    );
}

/** Picks a venue's home account, or none to use the shared accounts */
function HomeAccountSelect({ value, onChange, accounts }: { value: string, onChange: (value: string) => void, accounts: RockbotAccount[] }) {
    return (
        <select value={value} onChange={event => onChange(event.target.value)} aria-label="Home account">
            <option value="">No home account (shared)</option>
            {accounts.map(account => (
                <option key={account.username} value={account.username} disabled={!!account.homeOf && account.username !== value}>
                    {account.username}{account.homeOf && account.username !== value ? ` (${account.homeOf}'s)` : ""}
                </option>
            ))}
        </select>
    );
}

function VenueRow({ venue, accounts, reload }: { venue: AdminVenue, accounts: RockbotAccount[], reload: () => void }) {
    const [form, setForm] = useState({ name: venue.name, rockbotId: venue.rockbotId, homeAccount: venue.homeAccount ?? "" });
    const changed = form.name !== venue.name || form.rockbotId !== venue.rockbotId || form.homeAccount !== (venue.homeAccount ?? "");

    return (
        <div className="row venue-row">
            <div className="venue-fields">
                <input type="text" value={form.name} aria-label="Venue name" onChange={event => setForm({ ...form, name: event.target.value })} />
                <input type="text" inputMode="numeric" value={form.rockbotId} aria-label="Rockbot ID" className="rockbot-id"
                    onChange={event => setForm({ ...form, rockbotId: event.target.value })} />
                <HomeAccountSelect value={form.homeAccount} accounts={accounts} onChange={homeAccount => setForm({ ...form, homeAccount })} />
                <span className="muted code-id" title="Its ID, which history and queues are kept under">{venue.id}</span>
            </div>
            <div className="actions">
                {changed && <SmallButton label="Save" className="primary-small" onClick={async () => {
                    await adminPost("/v1/admin/venues", { id: venue.id, ...form });
                    reload();
                }} />}
                <SmallButton label="Remove" className="reject" onClick={async () => {
                    if (!confirm(`Remove ${venue.name}? Its history stays, but songs waiting in Zotify's queue there are dropped.`)) throw new Error("Cancelled");
                    await adminSend("DELETE", `/v1/admin/venues/${venue.id}`);
                    reload();
                }} />
            </div>
        </div>
    );
}

function AddVenue({ schoolId, accounts, reload }: { schoolId: string, accounts: RockbotAccount[], reload: () => void }) {
    const empty = { id: "", name: "", rockbotId: "", homeAccount: "" };
    const [form, setForm] = useState(empty);
    const [message, setMessage] = useState({ text: "", error: false });

    async function add(event: React.FormEvent) {
        event.preventDefault();

        try {
            await adminPost("/v1/admin/venues", { ...form, schoolId });
            setForm(empty);
            setMessage({ text: "", error: false });
            reload();
        } catch (error) {
            setMessage({ text: (error as Error).message, error: true });
        }
    }

    return <>
        <form className="inline-form" onSubmit={add}>
            <input type="text" required placeholder="Name, like The Eatery" aria-label="New venue's name" value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })} />
            <input type="text" required placeholder="ID, like the-eatery" aria-label="New venue's ID" autoCapitalize="none" spellCheck={false}
                value={form.id} onChange={event => setForm({ ...form, id: event.target.value })} />
            <input type="text" required inputMode="numeric" placeholder="Rockbot ID" aria-label="New venue's Rockbot ID" className="rockbot-id"
                value={form.rockbotId} onChange={event => setForm({ ...form, rockbotId: event.target.value })} />
            <HomeAccountSelect value={form.homeAccount} accounts={accounts} onChange={homeAccount => setForm({ ...form, homeAccount })} />
            <button className="small primary-small" type="submit">Add venue</button>
        </form>
        <FormMessage message={message} />
    </>;
}

/** A school's admins. A bare ID gets the school's email domain, like on sign-in */
function Admins({ school, reload }: { school: AdminSchool, reload: () => void }) {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState({ text: "", error: false });

    async function change(target: string, remove: boolean) {
        await adminSend(remove ? "DELETE" : "PUT", `/v1/admin/schools/${school.id}/admins/${encodeURIComponent(target)}`);
        reload();
    }

    return <>
        <Rows>
            {school.admins.map(admin => (
                <div className="row" key={admin}>
                    <span className="who">{admin}</span>
                    <div className="actions">
                        <SmallButton label="Remove" className="reject" onClick={() => change(admin, true)} />
                    </div>
                </div>
            ))}
        </Rows>
        <form className="inline-form" onSubmit={async event => {
            event.preventDefault();
            try {
                await change(email, false);
                setEmail("");
                setMessage({ text: "", error: false });
            } catch (error) {
                setMessage({ text: (error as Error).message, error: true });
            }
        }}>
            <SuffixInput compact required autoCapitalize="none" spellCheck={false} aria-label={`New admin for ${school.shortName}`}
                suffix={school.emailDomain && !email.includes("@") ? `@${school.emailDomain}` : null}
                placeholder={school.emailDomain ? school.idPlaceholder ?? "" : "you@example.com"}
                value={email} onChange={event => setEmail(event.target.value)} />
            <button className="small primary-small" type="submit">Add admin</button>
        </form>
        <FormMessage message={message} />
    </>;
}
