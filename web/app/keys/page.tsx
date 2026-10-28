"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { deleteJson, getJson, goToLogin, postJson, putJson, sendJson } from "@/lib/api";
import { MAIN_URL } from "@/lib/config";
import { useUser } from "@/lib/user";

// Zotify Keys (see src/routes/keys.ts): your virtual YubiKey, API keys for the Chrome extension, and the OTPs it's made.
// The private ID and AES key are never shown again once they're saved; API keys only right after they're made

interface Device {
    publicId: string;
    serial: number | null;
    counter: number;
    countersLeft: number;
    createdAt: number;
}

interface ApiKey {
    id: number;
    name: string;
    prefix: string;
    createdAt: number;
    lastUsedAt: number | null;
}

interface Overview {
    device: Device | null;
    apiKeys: ApiKey[];
    uses: { apiKey: string, counter: number, usedAt: number }[];
    maxCounter: number;
}

const day = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const time = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function KeysPage() {
    const { user } = useUser();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [error, setError] = useState<{ message: string, notApproved: boolean } | null>(null);
    // Replacing a key that's already saved
    const [replacing, setReplacing] = useState(false);

    const load = useCallback(async () => {
        const { response, data } = await getJson<Overview & { error?: string, code?: string }>("/v1/keys");
        if (response.ok) setOverview(data);
        else setError({ message: data?.error ?? `Couldn't load your key (${response.status}).`, notApproved: data?.code === "not_approved" });
    }, []);

    useEffect(() => {
        if (user === null) goToLogin("/");
        if (user) load();
    }, [user, load]);

    return (
        <main className="keys-main">
            <h1>Zotify Keys</h1>
            <p className="intro">
                A virtual YubiKey for Duo. Add your key here, make an API key for the Zotify Keys Chrome extension, and Duo prompts fill
                themselves in: it picks the YubiKey option and enters a fresh passcode.
            </p>

            {error ? (
                <section className="keys-panel">
                    <p>{error.message} {error.notApproved && <a href={MAIN_URL}>Ask to join Zotify</a>}</p>
                </section>
            ) : !overview ? <Spinner small /> : <>
                {overview.device && !replacing
                    ? <DeviceCard device={overview.device} max={overview.maxCounter} onChange={setOverview} onReplace={() => setReplacing(true)} />
                    : <DeviceForm max={overview.maxCounter} replacing={!!overview.device} onSaved={next => { setOverview(next); setReplacing(false); }} onCancel={overview.device ? () => setReplacing(false) : undefined} />}
                {overview.device && <ApiKeys keys={overview.apiKeys} reload={load} />}
                {overview.device && <Uses uses={overview.uses} />}
                <Rules max={overview.maxCounter} />
            </>}
        </main>
    );
}

/** A secret to copy now, since it won't be shown again */
function Reveal({ label, value, onDone }: { label: string, value: string, onDone?: () => void }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="reveal" role="status">
            <p><strong>{label}</strong> Copy it now; you won&apos;t see it again.</p>
            <div className="reveal-value">
                <code>{value}</code>
                <button type="button" className="keys-button small" onClick={async () => {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                }}>{copied ? "Copied" : "Copy"}</button>
            </div>
            {onDone && <button type="button" className="keys-link" onClick={onDone}>Done</button>}
        </div>
    );
}

// Your key

function DeviceCard({ device, max, onChange, onReplace }: { device: Device, max: number, onChange: (overview: Overview) => void, onReplace: () => void }) {
    const [counter, setCounter] = useState("");
    const [message, setMessage] = useState("");

    async function raise(event: React.FormEvent) {
        event.preventDefault();
        const { response, data } = await sendJson<Overview & { error?: string }>("PATCH", "/v1/keys/device", { counter: Number(counter) });
        if (!response.ok) return setMessage(data?.error ?? "Couldn't change the counter.");
        setCounter("");
        setMessage("");
        onChange(data);
    }

    return (
        <section className="keys-panel" aria-labelledby="device-title">
            <h2 id="device-title">Your key</h2>
            <dl className="keys-facts">
                {device.serial !== null && <><dt>Serial number</dt><dd>{device.serial}</dd></>}
                <dt>Public ID</dt><dd><code>{device.publicId}</code></dd>
                <dt>Next counter</dt><dd>{device.counter} <span className="muted">of {max}</span></dd>
                <dt>Added</dt><dd>{day(device.createdAt)}</dd>
            </dl>
            {device.countersLeft < 1000 && (
                <p className="warning">
                    {device.countersLeft > 0 ? `Only ${device.countersLeft} passcodes left.` : "This key has made every passcode it can."}
                    {" "}Register a new key with Duo before it runs out.
                </p>
            )}

            <form className="keys-form inline" onSubmit={raise}>
                <label>Raise the counter
                    <input type="number" required min={device.counter + 1} max={max} placeholder={String(device.counter + 1)} value={counter}
                        onChange={event => setCounter(event.target.value)} />
                </label>
                <button type="submit" className="keys-button">Raise</button>
            </form>
            <p className="muted small">If Duo says a passcode was already used, a copy of this key was used elsewhere. Raise the counter past it. It can never go back down.</p>
            {message && <p className="error">{message}</p>}

            <div className="keys-actions">
                <button type="button" className="keys-button small" onClick={onReplace}>Replace key</button>
                <button type="button" className="keys-button small danger" onClick={async () => {
                    if (!confirm("Delete your key and every API key for it? The extension stops working right away. Its private ID and AES key can't be recovered from Zotify.")) return;
                    const { data } = await deleteJson<Overview>("/v1/keys/device");
                    if (data) onChange(data);
                }}>Delete key</button>
            </div>
        </section>
    );
}

const EMPTY_DEVICE = { by: "serial" as "serial" | "publicId", serial: "", publicId: "", privateId: "", aesKey: "", counter: "" };

function DeviceForm({ max, replacing, onSaved, onCancel }: { max: number, replacing: boolean, onSaved: (overview: Overview) => void, onCancel?: () => void }) {
    const [form, setForm] = useState(EMPTY_DEVICE);
    // Set once new secrets were made here, so the note about registering them with Duo shows
    const [generated, setGenerated] = useState(false);
    const [message, setMessage] = useState("");
    const set = (field: keyof typeof EMPTY_DEVICE) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: event.target.value });

    async function generate() {
        const { response, data } = await getJson<{ privateId: string, aesKey: string }>("/v1/keys/random");
        if (!response.ok) return setMessage("Couldn't make a new key.");
        // Serial numbers of real YubiKeys are up to 8 digits; this stays clear of the low ones
        const serial = String(10_000_000 + Math.floor(Math.random() * 80_000_000));
        setForm({ ...form, by: "serial", serial, privateId: data.privateId, aesKey: data.aesKey, counter: "0" });
        setGenerated(true);
    }

    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (replacing && !confirm("Replace your key? The old one's private ID and AES key are deleted from Zotify.")) return;

        const { response, data } = await putJson<Overview & { error?: string }>("/v1/keys/device", {
            ...(form.by === "serial" ? { serial: form.serial } : { publicId: form.publicId }),
            privateId: form.privateId,
            aesKey: form.aesKey,
            counter: form.counter === "" ? 0 : Number(form.counter)
        });

        if (!response.ok) return setMessage(data?.error ?? "Couldn't save your key.");
        setForm(EMPTY_DEVICE);
        onSaved(data);
    }

    return (
        <section className="keys-panel" aria-labelledby="add-title">
            <h2 id="add-title">{replacing ? "Replace your key" : "Add your key"}</h2>
            <p className="muted">
                The Yubico OTP credentials registered with Duo. Moving a key from somewhere else, like yksim? Stop using that copy for good
                first, and start from its usage counter. Once saved, the private ID and AES key are encrypted and never shown again.
            </p>

            <form className="keys-form" onSubmit={save}>
                <fieldset className="keys-choice">
                    <legend>Identify it by</legend>
                    <label><input type="radio" name="by" checked={form.by === "serial"} onChange={() => setForm({ ...form, by: "serial" })} /> Serial number</label>
                    <label><input type="radio" name="by" checked={form.by === "publicId"} onChange={() => setForm({ ...form, by: "publicId" })} /> Public ID</label>
                </fieldset>
                {form.by === "serial"
                    ? <label>Serial number<input type="text" inputMode="numeric" required pattern="[0-9]+" value={form.serial} onChange={set("serial")} /></label>
                    : <label>Public ID<input type="text" required spellCheck={false} placeholder="12 ModHex characters, like ddddcccbudfc" value={form.publicId} onChange={set("publicId")} /></label>}
                <label>Private ID<input type="text" required spellCheck={false} autoComplete="off" placeholder="12 hex digits" value={form.privateId} onChange={set("privateId")} /></label>
                <label>AES key<input type="text" required spellCheck={false} autoComplete="off" placeholder="32 hex digits" value={form.aesKey} onChange={set("aesKey")} /></label>
                <label>Usage counter
                    <input type="number" min={0} max={max} placeholder="0" value={form.counter} onChange={set("counter")} />
                    <span className="muted small">Higher than the last passcode Duo accepted from this key. For a new key, 0.</span>
                </label>

                {generated && (
                    <div className="reveal" role="status">
                        <p>
                            <strong>A new key.</strong> Register it with Duo as a YubiKey, with this serial number, private ID and AES key, before
                            you use it. Copy them now; Zotify Keys won&apos;t show the private ID or AES key again.
                        </p>
                    </div>
                )}

                {message && <p className="error">{message}</p>}
                <div className="keys-actions">
                    <button type="submit" className="keys-button primary">Save key</button>
                    <button type="button" className="keys-button" onClick={generate}>Make a new key</button>
                    {onCancel && <button type="button" className="keys-button" onClick={onCancel}>Cancel</button>}
                </div>
            </form>
        </section>
    );
}

// API keys for the extension

function ApiKeys({ keys, reload }: { keys: ApiKey[], reload: () => void }) {
    const [name, setName] = useState("");
    const [created, setCreated] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    async function create(event: React.FormEvent) {
        event.preventDefault();
        setMessage("");
        const { response, data } = await postJson<ApiKey & { token: string, error?: string }>("/v1/keys/tokens", { name });
        if (!response.ok) return setMessage(data?.error ?? "Couldn't make the API key.");
        setCreated(data.token);
        setName("");
        reload();
    }

    return (
        <section className="keys-panel" aria-labelledby="extension-title">
            <h2 id="extension-title">Chrome extension</h2>
            <ol className="keys-steps">
                <li><a href="/zotify-keys.zip" download>Download Zotify Keys</a> and unzip it.</li>
                <li>Open <code>chrome://extensions</code>, turn on Developer mode, click Load unpacked and pick the <code>zotify-keys</code> folder.</li>
                <li>Make an API key below and paste it into the extension&apos;s options, which open once it&apos;s installed.</li>
            </ol>
            <p className="muted small">
                An API key can only make passcodes for your key, but anyone who has it can get through Duo as you. Make one per computer,
                and delete it if that computer is lost.
            </p>

            {created && <Reveal label="Your new API key." value={created} onDone={() => setCreated(null)} />}

            {keys.length > 0 && (
                <ul className="keys-list">
                    {keys.map(key => (
                        <li key={key.id}>
                            <div>
                                <div className="keys-name">{key.name} <code className="muted">{key.prefix}…</code></div>
                                <div className="muted small">Made {day(key.createdAt)} · {key.lastUsedAt ? `last used ${time(key.lastUsedAt)}` : "never used"}</div>
                            </div>
                            <button type="button" className="keys-button small danger" onClick={async () => {
                                if (!confirm(`Delete "${key.name}"? The extension using it stops working right away.`)) return;
                                await deleteJson(`/v1/keys/tokens/${key.id}`);
                                reload();
                            }}>Delete</button>
                        </li>
                    ))}
                </ul>
            )}

            <form className="keys-form inline" onSubmit={create}>
                <label>New API key<input type="text" required maxLength={60} placeholder="Name, like My laptop" value={name} onChange={event => setName(event.target.value)} /></label>
                <button type="submit" className="keys-button primary">Make API key</button>
            </form>
            {message && <p className="error">{message}</p>}
        </section>
    );
}

function Uses({ uses }: { uses: Overview["uses"] }) {
    return (
        <section className="keys-panel" aria-labelledby="uses-title">
            <h2 id="uses-title">Recent passcodes</h2>
            {uses.length ? (
                <ul className="keys-uses">
                    {uses.map(use => (
                        <li key={use.counter}>
                            <span>{time(use.usedAt)}</span>
                            <span className="muted">{use.apiKey}</span>
                            <span className="muted">#{use.counter}</span>
                        </li>
                    ))}
                </ul>
            ) : <p className="muted">None yet. Each passcode the extension gets shows up here; delete an API key if you see one you didn&apos;t expect.</p>}
        </section>
    );
}

function Rules({ max }: { max: number }) {
    return (
        <section className="keys-panel subtle" aria-labelledby="rules-title">
            <h2 id="rules-title">Keeping it working</h2>
            <ul className="keys-rules">
                <li>Duo only accepts a passcode whose counter is higher than the last one it saw. Zotify Keys only ever counts up, to {max}.</li>
                <li>Use each key in one place only. If you move it here from somewhere else, never use the old copy again.</li>
                <li>Never restore an old copy of a key: its counter is behind, so Duo rejects it as a replay.</li>
            </ul>
        </section>
    );
}
