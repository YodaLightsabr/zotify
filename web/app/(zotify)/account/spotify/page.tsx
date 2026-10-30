"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Busy, Spinner } from "@/components/Spinner";
import { deleteJson, getJson, postJson } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useLibrary } from "@/lib/library";
import { useSchool } from "@/lib/school";
import { useMember } from "@/lib/useMember";
import { useVenue } from "@/lib/venue";
import "./spotify.css";

// Importing your Spotify library into your Zotify Library: connect Spotify, pick your liked songs and playlists, then follow
// along while their songs are found on Rockbot (see src/spotifyImport.ts)

interface Connection { spotifyId: string, displayName: string | null, connectedAt: number }

interface ImportItem {
    kind: "liked" | "playlist";
    id: string | null;
    name: string;
    state: "waiting" | "reading" | "finding" | "done" | "failed";
    tracks: number;
    done: number;
    found: number;
    error: string | null;
}

interface SpotifyImport { venue: string, startedAt: number, finishedAt: number | null, items: ImportItem[] }

interface Status { configured: boolean, connection: Connection | null, import: SpotifyImport | null }

interface SpotifyPlaylist {
    id: string;
    name: string;
    owner: string | null;
    yours: boolean;
    public: boolean;
    trackCount: number;
    image: string | null;
    importable: boolean;
    // When it was saved to your Zotify Library, if it is
    savedAt: number | null;
}

interface SpotifyLibrary { likedCount: number, maxLiked: number, playlists: SpotifyPlaylist[] }

const STEPS = ["Connect", "Choose", "Import"];

export default function SpotifyImportPage() {
    const user = useMember("/account/spotify");
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState("");
    // An import started on this visit, so its results show once it's done
    const [watching, setWatching] = useState(false);

    const load = useCallback(async () => {
        const { response, data } = await getJson<Status>("/v1/me/spotify");
        if (!response.ok) throw new Error(`Couldn't load your Spotify connection (${response.status})`);
        setStatus(data);
        return data;
    }, []);

    useEffect(() => {
        if (user?.siteAdmin) load().catch(error => setError((error as Error).message));
    }, [user, load]);

    // Follow a running import until it's done
    const running = !!status?.import && !status.import.finishedAt;

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => load().catch(() => {}), 1500);
        return () => clearInterval(timer);
    }, [running, load]);

    // Spotify only lets a handful of accounts connect, so this is for site admins
    if (user && !user.siteAdmin) return <Page step={0}><p className="spotify-lead">Importing from Spotify is only for Zotify&apos;s admins for now.</p></Page>;
    if (error) return <Page step={0}><p className="spotify-error">{error}</p></Page>;
    if (!status) return <Page step={0}><Spinner small /></Page>;

    if (!status.configured) {
        return <Page step={0}><p className="spotify-lead">Spotify connections aren&apos;t set up on this server yet.</p></Page>;
    }

    if (!status.connection) return <Page step={0}><Connect /></Page>;

    if (status.import && (running || watching)) {
        return <Page step={2}><Progress job={status.import} onMore={() => setWatching(false)} /></Page>;
    }

    return (
        <Page step={1}>
            <Choose connection={status.connection} onStarted={job => { setWatching(true); setStatus({ ...status, import: job }); }}
                onDisconnected={() => setStatus({ ...status, connection: null })} />
        </Page>
    );
}

function Page({ step, children }: { step: number, children: React.ReactNode }) {
    return (
        <div className="page-spotify">
            <main>
                <Link className="spotify-back" href="/account">← Account</Link>
                <h1>Import from Spotify</h1>
                <ol className="spotify-stepper">
                    {STEPS.map((label, i) => (
                        <li key={label} className={cx(i < step && "done", i === step && "current")} aria-current={i === step ? "step" : undefined}>
                            <span className="spotify-dot">{i < step ? "✓" : i + 1}</span>{label}
                        </li>
                    ))}
                </ol>
                {children}
            </main>
        </div>
    );
}

function Connect() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function connect() {
        setBusy(true);
        setError("");

        try {
            const { response, data } = await postJson<{ url: string, error?: string }>("/v1/me/spotify/authorize", {});
            if (!response.ok) throw new Error(data?.error ?? `Couldn't start connecting (${response.status})`);
            location.href = data.url;
        } catch (error) {
            setError((error as Error).message);
            setBusy(false);
        }
    }

    return (
        <section className="spotify-panel">
            <p className="spotify-lead">Connect your Spotify account to bring your liked songs and playlists into your Library.</p>
            <ul className="spotify-points">
                <li>Zotify finds each song on Rockbot and saves the ones it has, even if they can&apos;t be played right now.</li>
                <li>You can also paste links to your own private playlists into the search.</li>
                <li>Zotify only reads your library. It never changes anything on Spotify.</li>
                <li>Your connection also fetches playlist covers and album art for everyone&apos;s playlists.</li>
            </ul>
            {error && <p className="spotify-error" role="alert">{error}</p>}
            <button type="button" className="spotify-button primary" disabled={busy} onClick={connect}>
                {busy ? <Busy label="Opening Spotify…" /> : "Connect Spotify"}
            </button>
        </section>
    );
}

function Choose({ connection, onStarted, onDisconnected }: { connection: Connection, onStarted: (job: SpotifyImport) => void, onDisconnected: () => void }) {
    const school = useSchool();
    const [venue] = useVenue();
    const [library, setLibrary] = useState<SpotifyLibrary | null>(null);
    const [error, setError] = useState("");
    const [liked, setLiked] = useState(true);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [starting, setStarting] = useState(false);

    useEffect(() => {
        getJson<SpotifyLibrary & { error?: string }>("/v1/me/spotify/library").then(({ response, data }) => {
            if (!response.ok) throw new Error(data?.error ?? `Couldn't read your Spotify library (${response.status})`);
            setLibrary(data);
            // Your own playlists start picked, unless they're already in your Library
            setPicked(new Set(data.playlists.filter(playlist => playlist.yours && playlist.importable && !playlist.savedAt).map(playlist => playlist.id)));
            if (!data.likedCount) setLiked(false);
        }).catch(error => setError((error as Error).message));
    }, []);

    const importable = useMemo(() => library?.playlists.filter(playlist => playlist.importable) ?? [], [library]);
    const allPicked = importable.length > 0 && importable.every(playlist => picked.has(playlist.id));
    const count = picked.size + (liked ? 1 : 0);

    function toggle(id: string) {
        setPicked(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function disconnect() {
        if (!confirm("Disconnect Spotify? Songs and playlists you've imported stay in your Library.")) return;
        await deleteJson("/v1/me/spotify");
        onDisconnected();
    }

    async function start() {
        setStarting(true);
        setError("");

        try {
            const playlists = library!.playlists.filter(playlist => picked.has(playlist.id)).map(({ id, name }) => ({ id, name }));
            const { response, data } = await postJson<SpotifyImport & { error?: string }>(`/v1/venues/${venue}/spotify/import`, { liked, playlists });
            if (!response.ok) throw new Error(data?.error ?? `Couldn't start importing (${response.status})`);
            onStarted(data);
        } catch (error) {
            setError((error as Error).message);
            setStarting(false);
        }
    }

    return <>
        <div className="spotify-account">
            <span>Connected as <strong>{connection.displayName ?? connection.spotifyId}</strong></span>
            <button type="button" className="spotify-link" onClick={disconnect}>Disconnect</button>
        </div>

        {error && <p className="spotify-error" role="alert">{error}</p>}
        {!library && !error && <Spinner small />}

        {library && <>
            <section className="spotify-panel">
                <h2>Liked songs</h2>
                <label className={cx("spotify-choice", !library.likedCount && "disabled")}>
                    <input type="checkbox" checked={liked} disabled={!library.likedCount} onChange={event => setLiked(event.target.checked)} />
                    <span className="spotify-art liked" aria-hidden="true">♥</span>
                    <span className="spotify-choice-text">
                        <strong>Your liked songs</strong>
                        <span>
                            {plural(library.likedCount, "song")}
                            {library.likedCount > library.maxLiked && `. Your ${library.maxLiked} most recent are imported`}
                        </span>
                    </span>
                </label>
            </section>

            <section className="spotify-panel">
                <div className="spotify-panel-head">
                    <h2>Playlists</h2>
                    {importable.length > 0 && (
                        <button type="button" className="spotify-link" onClick={() => setPicked(allPicked ? new Set() : new Set(importable.map(playlist => playlist.id)))}>
                            {allPicked ? "Select none" : "Select all"}
                        </button>
                    )}
                </div>
                {!library.playlists.length && <p className="spotify-muted">You don&apos;t have any playlists on Spotify.</p>}
                <div className="spotify-choices">
                    {library.playlists.map(playlist => (
                        <label key={playlist.id} className={cx("spotify-choice", !playlist.importable && "disabled")}
                            title={playlist.importable ? undefined : "Spotify only lets Zotify read private playlists you made or collaborate on"}>
                            <input type="checkbox" checked={picked.has(playlist.id)} disabled={!playlist.importable} onChange={() => toggle(playlist.id)} />
                            {playlist.image ? <img className="spotify-art" src={playlist.image} alt="" loading="lazy" /> : <span className="spotify-art" aria-hidden="true">♪</span>}
                            <span className="spotify-choice-text">
                                <strong>{playlist.name}</strong>
                                <span>
                                    {playlist.yours ? "Yours" : playlist.owner ? `By ${playlist.owner}` : "Followed"} · {plural(playlist.trackCount, "track")}
                                    {!playlist.importable && " · Private, so it can't be imported"}
                                </span>
                            </span>
                            {playlist.savedAt && <span className="spotify-badge">In your Library</span>}
                        </label>
                    ))}
                </div>
            </section>

            <div className="spotify-footer">
                <p className="spotify-muted">
                    Songs are looked for at {school.venueName(venue)}{school.venues.length > 1 ? ", the venue picked at the top" : ""}. Ones Rockbot has are saved
                    even if they can&apos;t be played there right now.
                </p>
                <button type="button" className="spotify-button primary" disabled={!count || starting} onClick={start}>
                    {starting ? <Busy label="Starting…" /> : count ? `Import ${plural(count, "item")}` : "Pick something to import"}
                </button>
            </div>
        </>}
    </>;
}

const STATE_LABELS: Record<ImportItem["state"], string> = {
    waiting: "Waiting",
    reading: "Reading from Spotify",
    finding: "Finding songs",
    done: "Done",
    failed: "Failed"
};

function Progress({ job, onMore }: { job: SpotifyImport, onMore: () => void }) {
    const { reload } = useLibrary();
    const finished = !!job.finishedAt;
    const found = job.items.reduce((total, item) => total + item.found, 0);

    // The hearts everywhere should know about the new songs
    useEffect(() => { if (finished) reload().catch(() => {}); }, [finished, reload]);

    return (
        <section className="spotify-panel">
            <p className="spotify-lead" aria-live="polite">
                {finished ? `Done. ${plural(found, "song")} from Spotify ${found === 1 ? "is" : "are"} in your Library.` : "Importing. You can leave this page; it keeps going."}
            </p>
            <ul className="spotify-progress">
                {job.items.map((item, i) => (
                    <li key={item.id ?? `liked-${i}`} className={item.state}>
                        <div className="spotify-progress-head">
                            <strong>{item.name}</strong>
                            <span>{item.state === "failed" ? `Failed${item.error ? `: ${item.error}` : ""}` : item.state === "done" ? `${item.found} of ${plural(item.tracks, "track")} found` : STATE_LABELS[item.state]}</span>
                        </div>
                        {item.state === "finding" && (
                            <div className="spotify-bar" role="progressbar" aria-label={`${item.name} progress`} aria-valuemin={0} aria-valuemax={item.tracks} aria-valuenow={item.done}>
                                <div style={{ width: `${item.tracks ? (item.done / item.tracks) * 100 : 0}%` }} />
                            </div>
                        )}
                        {item.state === "finding" && <span className="spotify-muted">{item.done} of {item.tracks} looked for, {item.found} found</span>}
                    </li>
                ))}
            </ul>
            {finished && (
                <div className="spotify-actions">
                    <Link className="spotify-button primary" href="/library">Open your Library</Link>
                    <button type="button" className="spotify-button" onClick={onMore}>Import more</button>
                </div>
            )}
        </section>
    );
}
