"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/Spinner";
import { deleteJson, getJson, goToLogin, postJson, putJson, sendJson } from "@/lib/api";
import { MAIN_URL } from "@/lib/config";
import { cx } from "@/lib/format";
import { useUser } from "@/lib/user";

// Zotify Keys (see src/routes/keys.ts): your virtual YubiKey, API keys for the Chrome extension, and the passcodes it's made.
// The first visit is a wizard: add a key (a new one, registered with Duo, or one moved from elsewhere), install the extension
// and connect it. After that it's a dashboard. The private ID and AES key are never shown again once saved; API keys only
// right after they're made

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

// Where UCI's people register a YubiKey with Duo
const DUO_ENROLL_URL = "https://duosupportdesk.service.uci.edu/enrollYubiKey.htm";

type Step = "choose" | "register" | "existing" | "install" | "connect";

const STEPS = ["Key", "Duo", "Extension", "Connect"];
const STEP_INDEX: Record<Step, number> = { choose: 0, existing: 0, register: 1, install: 2, connect: 3 };

const day = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const time = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A serial number as a YubiKey public ID, like ddddcccbudfc (see src/keys/yubikey.ts) */
function publicIdFor(serial: number) {
    const hex = serial.toString(16).padStart(8, "0");
    return `dddd${[...hex].map(char => "cbdefghijklnrtuv"["0123456789abcdef".indexOf(char)]).join("")}`;
}

export default function KeysPage() {
    const { user } = useUser();
    const [overview, setOverview] = useState<Overview | null>(null);
    const [error, setError] = useState<{ message: string, notApproved: boolean } | null>(null);
    // The wizard's step, or null for the dashboard. Undefined until the first load decides
    const [step, setStep] = useState<Step | null | undefined>(undefined);

    const load = useCallback(async () => {
        const { response, data } = await getJson<Overview & { error?: string, code?: string }>("/v1/keys");
        if (!response.ok) return setError({ message: data?.error ?? `Couldn't load your key (${response.status}).`, notApproved: data?.code === "not_approved" });
        setOverview(data);
        // First visit: start at whatever's left to set up
        setStep(current => current !== undefined ? current : !data.device ? "choose" : data.apiKeys.length ? null : "install");
    }, []);

    useEffect(() => {
        if (user === null) goToLogin("/");
        if (user) load();
    }, [user, load]);

    if (error) {
        return (
            <main className="keys-main">
                <section className="keys-panel">
                    <h1>Zotify Keys</h1>
                    <p>{error.message} {error.notApproved && <a href={MAIN_URL}>Ask to join Zotify</a>}</p>
                </section>
            </main>
        );
    }

    if (!overview || step === undefined) return <main className="keys-main"><Spinner small /></main>;

    return (
        <main className="keys-main">
            {step
                ? <Wizard overview={overview} step={step} setStep={setStep} onChange={setOverview} reload={load} />
                : <Dashboard overview={overview} onChange={setOverview} reload={load} setStep={setStep} />}
        </main>
    );
}

/** A value to copy, like a private ID or API key */
function CopyField({ label, value }: { label: string, value: string }) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="copy-field">
            <span className="copy-label">{label}</span>
            <code>{value}</code>
            <button type="button" className="keys-button small" onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}>{copied ? "Copied" : "Copy"}</button>
        </div>
    );
}

// The wizard

function Wizard({ overview, step, setStep, onChange, reload }: {
    overview: Overview, step: Step, setStep: (step: Step | null) => void, onChange: (overview: Overview) => void, reload: () => Promise<void>
}) {
    // Replacing a key that's already set up, rather than a first visit
    const replacing = !!overview.device && (step === "choose" || step === "register" || step === "existing");
    // A new key, made in the browser and only saved once it's registered with Duo
    const [draft, setDraft] = useState<{ serial: number, publicId: string, privateId: string, aesKey: string } | null>(null);
    const [message, setMessage] = useState("");

    const go = (next: Step) => { setMessage(""); setStep(next); };
    // After the key is saved: on to the extension, unless it's already connected
    const saved = (next: Overview) => { onChange(next); setStep(next.apiKeys.length ? null : "install"); };

    async function makeKey() {
        const { response, data } = await getJson<{ privateId: string, aesKey: string }>("/v1/keys/random");
        if (!response.ok) return setMessage("Couldn't make a key. Try again.");
        // Real YubiKeys' serial numbers have up to 8 digits; this stays clear of the low ones
        const serial = 10_000_000 + Math.floor(Math.random() * 80_000_000);
        setDraft({ serial, publicId: publicIdFor(serial), ...data });
        go("register");
    }

    async function save(body: Record<string, unknown>) {
        if (replacing && !confirm("Replace your key? The old one stops working here, and its secrets are deleted.")) return false;
        const { response, data } = await putJson<Overview & { error?: string }>("/v1/keys/device", body);
        if (!response.ok) {
            setMessage(data?.error ?? "Couldn't save your key.");
            return false;
        }
        saved(data);
        return true;
    }

    const current = STEP_INDEX[step];

    return (
        <div className="wizard">
            <ol className="stepper" aria-label="Setup">
                {STEPS.map((label, index) => (
                    <li key={label} className={cx(index < current && "done", index === current && "current")} aria-current={index === current ? "step" : undefined}>
                        <span className="stepper-dot">{index < current ? "✓" : index + 1}</span>
                        <span className="stepper-label">{label}</span>
                    </li>
                ))}
            </ol>

            {step === "choose" && (
                <section className="keys-panel">
                    <h1>{replacing ? "Replace your key" : "Set up Zotify Keys"}</h1>
                    <p className="lead">
                        Zotify Keys is a virtual YubiKey. With its Chrome extension, Duo prompts fill themselves in: it picks the YubiKey
                        option and enters a fresh passcode. Setup takes a few minutes.
                    </p>
                    <div className="choices">
                        <button type="button" className="choice" onClick={makeKey}>
                            <strong>Make a new key</strong>
                            <span>You&apos;ll register it with Duo next. Start here if you&apos;re new.</span>
                        </button>
                        <button type="button" className="choice" onClick={() => go("existing")}>
                            <strong>Use a key I already have</strong>
                            <span>One already registered with Duo, like from yksim.</span>
                        </button>
                    </div>
                    {message && <p className="error">{message}</p>}
                    {replacing && <div className="wizard-nav"><button type="button" className="keys-button" onClick={() => setStep(null)}>Cancel</button></div>}
                </section>
            )}

            {step === "register" && draft && (
                <RegisterStep draft={draft} message={message} onBack={() => go("choose")}
                    onDone={() => save({ serial: draft.serial, privateId: draft.privateId, aesKey: draft.aesKey, counter: 0 })} />
            )}

            {step === "existing" && <ExistingStep replacing={replacing} max={overview.maxCounter} message={message} onBack={() => go("choose")} onSave={save} />}

            {step === "install" && (
                <section className="keys-panel">
                    <h1>Install the extension</h1>
                    <p className="lead">The Zotify Keys extension watches for Duo prompts in Chrome and fills them in.</p>
                    <a className="keys-button primary big" href="/zotify-keys.zip" download>Download Zotify Keys</a>
                    <ol className="keys-steps">
                        <li>Unzip it. You&apos;ll get a <code>zotify-keys</code> folder; keep it somewhere it won&apos;t be deleted.</li>
                        <li>Go to <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).</li>
                        <li>Click <strong>Load unpacked</strong> and choose the <code>zotify-keys</code> folder. Its settings open.</li>
                    </ol>
                    <div className="wizard-nav">
                        <button type="button" className="keys-button primary" onClick={() => go("connect")}>It&apos;s installed</button>
                    </div>
                </section>
            )}

            {step === "connect" && <ConnectStep onCreated={reload} onDone={() => setStep(null)} />}
        </div>
    );
}

function RegisterStep({ draft, message, onBack, onDone }: {
    draft: { serial: number, publicId: string, privateId: string, aesKey: string }, message: string, onBack: () => void, onDone: () => Promise<boolean>
}) {
    const [busy, setBusy] = useState(false);

    return (
        <section className="keys-panel">
            <h1>Register it with Duo</h1>
            <p className="lead">
                Open UCI&apos;s YubiKey enrollment page, sign in, and enter these. Duo then accepts this key&apos;s passcodes like a real YubiKey&apos;s.
            </p>
            <a className="keys-button primary big" href={DUO_ENROLL_URL} target="_blank" rel="noreferrer">Open UCI&apos;s YubiKey enrollment ↗</a>
            <div className="copy-fields">
                <CopyField label="Public ID" value={draft.publicId} />
                <CopyField label="Private ID" value={draft.privateId} />
                <CopyField label="AES key" value={draft.aesKey} />
            </div>
            <p className="note">
                Stay on this page until you&apos;re done: the private ID and AES key aren&apos;t saved until you continue, and Zotify Keys
                never shows them again after that.
            </p>
            {message && <p className="error">{message}</p>}
            <div className="wizard-nav">
                <button type="button" className="keys-button" onClick={onBack}>Back</button>
                <button type="button" className="keys-button primary" disabled={busy} onClick={async () => {
                    setBusy(true);
                    await onDone();
                    setBusy(false);
                }}>I&apos;ve registered it</button>
            </div>
        </section>
    );
}

function ExistingStep({ replacing, max, message, onBack, onSave }: { replacing: boolean, max: number, message: string, onBack: () => void, onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
    const [form, setForm] = useState({ by: "serial" as "serial" | "publicId", serial: "", publicId: "", privateId: "", aesKey: "", counter: "" });
    const set = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: event.target.value });

    return (
        <section className="keys-panel">
            <h1>{replacing ? "Replace your key" : "Add your key"}</h1>
            <p className="lead">The key&apos;s Yubico OTP details, as registered with Duo.</p>
            <p className="note">
                Moving it from somewhere else, like yksim? Stop that copy first and never use it again: two copies of one key make
                Duo reject passcodes. If you haven&apos;t registered it with Duo yet, use <a href={DUO_ENROLL_URL} target="_blank" rel="noreferrer">UCI&apos;s YubiKey enrollment</a>.
            </p>

            <form className="keys-form" onSubmit={event => {
                event.preventDefault();
                onSave({
                    ...(form.by === "serial" ? { serial: form.serial } : { publicId: form.publicId }),
                    privateId: form.privateId,
                    aesKey: form.aesKey,
                    counter: form.counter === "" ? 0 : Number(form.counter)
                });
            }}>
                <div className="segmented" role="radiogroup" aria-label="Identify it by">
                    <button type="button" role="radio" aria-checked={form.by === "serial"} onClick={() => setForm({ ...form, by: "serial" })}>Serial number</button>
                    <button type="button" role="radio" aria-checked={form.by === "publicId"} onClick={() => setForm({ ...form, by: "publicId" })}>Public ID</button>
                </div>
                {form.by === "serial"
                    ? <label>Serial number<input type="text" inputMode="numeric" required pattern="[0-9]+" placeholder="12345678" value={form.serial} onChange={set("serial")} /></label>
                    : <label>Public ID<input type="text" required spellCheck={false} placeholder="ddddcccbudfc" value={form.publicId} onChange={set("publicId")} /></label>}
                <label>Private ID<input type="text" required spellCheck={false} autoComplete="off" placeholder="12 hex digits" value={form.privateId} onChange={set("privateId")} /></label>
                <label>AES key<input type="text" required spellCheck={false} autoComplete="off" placeholder="32 hex digits" value={form.aesKey} onChange={set("aesKey")} /></label>
                <label>Usage counter
                    <input type="number" min={0} max={max} placeholder="0" value={form.counter} onChange={set("counter")} />
                    <span className="hint">The next counter to use: higher than the last passcode Duo accepted. In yksim, it&apos;s <code>usage_counter</code>.</span>
                </label>
                {message && <p className="error">{message}</p>}
                <div className="wizard-nav">
                    <button type="button" className="keys-button" onClick={onBack}>Back</button>
                    <button type="submit" className="keys-button primary">Save key</button>
                </div>
            </form>
        </section>
    );
}

function ConnectStep({ onCreated, onDone }: { onCreated: () => Promise<void>, onDone: () => void }) {
    const [name, setName] = useState("");
    const [token, setToken] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    async function create(event: React.FormEvent) {
        event.preventDefault();
        setMessage("");
        const { response, data } = await postJson<{ token: string, error?: string }>("/v1/keys/tokens", { name });
        if (!response.ok) return setMessage(data?.error ?? "Couldn't make the API key.");
        setToken(data.token);
        await onCreated();
    }

    return (
        <section className="keys-panel">
            <h1>Connect the extension</h1>
            {!token ? <>
                <p className="lead">The extension uses an API key to get passcodes. Make one for this computer.</p>
                <form className="keys-form" onSubmit={create}>
                    <label>Computer name<input type="text" required maxLength={60} placeholder="My laptop" value={name} onChange={event => setName(event.target.value)} /></label>
                    {message && <p className="error">{message}</p>}
                    <div className="wizard-nav"><button type="submit" className="keys-button primary">Make API key</button></div>
                </form>
            </> : <>
                <p className="lead">Paste this into the extension&apos;s settings, click <strong>Save</strong>, then <strong>Test</strong>.</p>
                <CopyField label="API key" value={token} />
                <p className="note">
                    It&apos;s only shown once. Anyone with it can get through Duo as you, so don&apos;t share it. The settings open from the
                    Zotify Keys icon in Chrome&apos;s toolbar (under the puzzle piece).
                </p>
                <p className="lead">That&apos;s it. Next time Duo asks, Zotify Keys answers.</p>
                <div className="wizard-nav"><button type="button" className="keys-button primary" onClick={onDone}>Done</button></div>
            </>}
        </section>
    );
}

// The dashboard

function Dashboard({ overview, onChange, reload, setStep }: {
    overview: Overview, onChange: (overview: Overview) => void, reload: () => Promise<void>, setStep: (step: Step) => void
}) {
    const device = overview.device!;
    const used = device.counter;

    return <>
        <h1>Zotify Keys</h1>
        <p className="lead">Your virtual YubiKey for Duo.</p>

        <section className="keys-panel" aria-labelledby="device-title">
            <div className="panel-head">
                <h2 id="device-title">Your key</h2>
                <div className="keys-actions">
                    <button type="button" className="keys-button small" onClick={() => setStep("choose")}>Replace</button>
                    <button type="button" className="keys-button small danger" onClick={async () => {
                        if (!confirm("Delete your key and its API keys? The extension stops working right away, and the key's secrets can't be recovered from Zotify Keys.")) return;
                        const { data } = await deleteJson<Overview>("/v1/keys/device");
                        if (data) { onChange(data); setStep("choose"); }
                    }}>Delete</button>
                </div>
            </div>
            <dl className="keys-facts">
                <div><dt>Public ID</dt><dd><code>{device.publicId}</code></dd></div>
                <div><dt>Passcodes left</dt><dd>{device.countersLeft.toLocaleString()}</dd></div>
            </dl>
            {device.countersLeft < 1000 && (
                <p className="warning">
                    {device.countersLeft > 0 ? `Only ${device.countersLeft} passcodes left.` : "This key is out of passcodes."} Make a new
                    key and register it with Duo before it runs out.
                </p>
            )}
            <RaiseCounter counter={used} max={overview.maxCounter} onChange={onChange} />
        </section>

        <ApiKeys keys={overview.apiKeys} reload={reload} onSetup={() => setStep("install")} />

        <section className="keys-panel" aria-labelledby="uses-title">
            <h2 id="uses-title">Recent passcodes</h2>
            {overview.uses.length ? (
                <ul className="keys-uses">
                    {overview.uses.map(use => (
                        <li key={use.counter}>
                            <span>{time(use.usedAt)}</span>
                            <span className="muted">{use.apiKey}</span>
                            <span className="muted">#{use.counter}</span>
                        </li>
                    ))}
                </ul>
            ) : <p className="muted">None yet. If you ever see one you didn&apos;t ask for, delete that API key.</p>}
        </section>

        <p className="footnote">
            Duo only accepts a passcode whose counter is higher than the last one it saw, so use each key in one place only and never
            restore an old copy of it.
        </p>
    </>;
}

/** For when Duo rejects passcodes because a copy of the key was used elsewhere */
function RaiseCounter({ counter, max, onChange }: { counter: number, max: number, onChange: (overview: Overview) => void }) {
    const [value, setValue] = useState("");
    const [message, setMessage] = useState("");

    async function raise(event: React.FormEvent) {
        event.preventDefault();
        const { response, data } = await sendJson<Overview & { error?: string }>("PATCH", "/v1/keys/device", { counter: Number(value) });
        if (!response.ok) return setMessage(data?.error ?? "Couldn't change the counter.");
        setValue("");
        setMessage("");
        onChange(data);
    }

    return (
        <details className="keys-details">
            <summary>Duo says a passcode was already used?</summary>
            <p className="muted small">
                Another copy of this key got ahead of this one. Raise the counter past the last passcode Duo accepted (it&apos;s at {counter} now).
                It can only go up.
            </p>
            <form className="keys-form inline" onSubmit={raise}>
                <label>New counter
                    <input type="number" required min={counter + 1} max={max} placeholder={String(counter + 1)} value={value} onChange={event => setValue(event.target.value)} />
                </label>
                <button type="submit" className="keys-button">Raise</button>
            </form>
            {message && <p className="error">{message}</p>}
        </details>
    );
}

function ApiKeys({ keys, reload, onSetup }: { keys: ApiKey[], reload: () => Promise<void>, onSetup: () => void }) {
    const [name, setName] = useState("");
    const [created, setCreated] = useState<string | null>(null);
    const [message, setMessage] = useState("");

    async function create(event: React.FormEvent) {
        event.preventDefault();
        setMessage("");
        const { response, data } = await postJson<{ token: string, error?: string }>("/v1/keys/tokens", { name });
        if (!response.ok) return setMessage(data?.error ?? "Couldn't make the API key.");
        setCreated(data.token);
        setName("");
        reload();
    }

    return (
        <section className="keys-panel" aria-labelledby="extension-title">
            <div className="panel-head">
                <h2 id="extension-title">Extension</h2>
                <button type="button" className="keys-button small" onClick={onSetup}>Set up on another computer</button>
            </div>
            <p className="muted small">One API key per computer. Delete a computer&apos;s key if it&apos;s lost.</p>

            {created && (
                <div className="reveal">
                    <CopyField label="New API key" value={created} />
                    <p className="note">Paste it into the extension&apos;s settings now; it&apos;s only shown once. <button type="button" className="keys-link" onClick={() => setCreated(null)}>Hide</button></p>
                </div>
            )}

            {keys.length > 0 && (
                <ul className="keys-list">
                    {keys.map(key => (
                        <li key={key.id}>
                            <div>
                                <div className="keys-name">{key.name}</div>
                                <div className="muted small">{key.lastUsedAt ? `Last used ${time(key.lastUsedAt)}` : "Not used yet"} · made {day(key.createdAt)}</div>
                            </div>
                            <button type="button" className="keys-button small danger" onClick={async () => {
                                if (!confirm(`Delete "${key.name}"? Its extension stops working right away.`)) return;
                                await deleteJson(`/v1/keys/tokens/${key.id}`);
                                reload();
                            }}>Delete</button>
                        </li>
                    ))}
                </ul>
            )}

            <form className="keys-form inline" onSubmit={create}>
                <label>New API key<input type="text" required maxLength={60} placeholder="Computer name" value={name} onChange={event => setName(event.target.value)} /></label>
                <button type="submit" className="keys-button primary">Make</button>
            </form>
            {message && <p className="error">{message}</p>}
        </section>
    );
}
