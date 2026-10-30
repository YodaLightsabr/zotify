"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { TrackRow, type TrackState } from "@/components/home/ResultRow";
import { Loading, Message, resultGroup, SongResults, type NotFound } from "@/components/home/Results";
import type { Playlist, PlaylistTrack, QueueEntry, Song } from "@/components/home/types";
import VoteDialog from "@/components/home/VoteDialog";
import { Busy } from "@/components/Spinner";
import { deleteJson, fetchOrThrow, getJson, postJson, putJson, runWithConcurrency, type Venue } from "@/lib/api";
import { cx, plural } from "@/lib/format";
import { useLibrary } from "@/lib/library";
import { setPlaylistJob, useLivePlaylistJob, type Outcome, type QueueJob } from "@/lib/live";
import { useMember } from "@/lib/useMember";
import { useSchool } from "@/lib/school";
import { useIsVenue, useVenue } from "@/lib/venue";
import "../../home.css";
import "./playlist.css";

// Only this many track searches run at once, to go easy on Rockbot
const MATCH_CONCURRENCY = 5;

/**
 * Finds a playlist track's Rockbot song on the server, which also tries the artist alone if needed. Null means not on Rockbot.
 * The server keeps what it finds with the playlist, for the Libraries of people who saved it
 */
const fetchMatch = async (track: PlaylistTrack, venue: Venue, playlistId: string) =>
    (await fetchOrThrow<{ match: Song | null }>(`/v1/venues/${venue}/match`, { title: track.title, artist: track.artist, playlist: playlistId }, "Search failed")).match;

// Matching the playlist's tracks to Rockbot songs, then the grouped results
type Matching =
    | { kind: "matching", states: TrackState[], finished: number }
    | { kind: "matched", songs: Song[], notFound: NotFound[] };

const OUTCOME_LABELS: Record<Outcome, string> = {
    "waiting": "Waiting",
    "working": "Queuing",
    "queued": "Queued",
    "not-found": "Not on Rockbot",
    "unavailable": "Can't be requested here",
    "already-queued": "Already in the queue",
    "played-recently": "Played recently",
    "duplicate": "Same song as another track",
    "failed": "Failed"
};

export default function PlaylistPage() {
    return <Suspense><PlaylistView /></Suspense>;
}

function PlaylistView() {
    const id = useParams<{ id: string }>().id;
    const params = useSearchParams();
    const router = useRouter();
    const user = useMember(`/playlist/${id}`);

    // A link's ?venue= becomes the venue picked in the bar, then leaves the address so the bar's picker is the only one
    const [storedVenue, setVenue] = useVenue();
    const isVenue = useIsVenue();
    const linkVenue = params.get("venue");
    const venue = isVenue(linkVenue) ? linkVenue : storedVenue;

    useEffect(() => {
        if (!isVenue(linkVenue)) return;
        setVenue(linkVenue);
        router.replace(`/playlist/${id}`, { scroll: false });
    }, [linkVenue, setVenue, isVenue, router, id]);
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [error, setError] = useState("");
    const [matching, setMatching] = useState<Matching | null>(null);
    const [voteTarget, setVoteTarget] = useState<{ song: QueueEntry, venue: Venue } | null>(null);
    const matchId = useRef(0);

    useEffect(() => {
        if (!user) return;

        getJson<Playlist & { error?: string }>(`/v1/playlists/${id}`).then(({ response, data }) => {
            if (!response.ok) throw new Error(data?.error ?? `Couldn't load this playlist (${response.status})`);
            setPlaylist(data);
        }).catch(error => setError((error as Error).message));
    }, [user, id]);

    // Finds each track on Rockbot, showing progress as it goes. A failed search is retried once; if it fails again
    // the track is marked failed and the rest carry on
    const match = useCallback(async (playlist: Playlist, venue: Venue) => {
        const runId = ++matchId.current;
        const isCurrent = () => runId === matchId.current;
        const states: TrackState[] = playlist.tracks.map(() => "waiting");
        const matches: (Song | null)[] = playlist.tracks.map(() => null);
        let finished = 0;

        const show = () => { if (isCurrent()) setMatching({ kind: "matching", states: [...states], finished }); };
        show();

        await runWithConcurrency(playlist.tracks, MATCH_CONCURRENCY, async (track, i) => {
            states[i] = "searching";
            show();

            try {
                try {
                    matches[i] = await fetchMatch(track, venue, playlist.id);
                } catch {
                    states[i] = "retrying";
                    show();
                    matches[i] = await fetchMatch(track, venue, playlist.id);
                }

                states[i] = matches[i] ? "found" : "missing";
            } catch {
                states[i] = "failed";
            }

            finished++;
            show();
        }, () => !isCurrent());

        if (!isCurrent()) return;

        // Top match per track in playlist order, each song once; grouping then takes priority over this order
        const seen = new Set<string>();
        const songs: Song[] = [];
        const notFound: NotFound[] = [];

        playlist.tracks.forEach((track, i) => {
            const song = matches[i];
            if (!song) notFound.push({ ...track, failed: states[i] === "failed" });
            else if (!seen.has(song.id)) {
                seen.add(song.id);
                songs.push(song);
            }
        });

        setMatching({ kind: "matched", songs, notFound });
    }, []);

    useEffect(() => {
        if (playlist) match(playlist, venue);
    }, [playlist, venue, match]);

    if (error) return <Page><Message text={error} /></Page>;
    if (!playlist) return <Page><Loading /></Page>;

    const available = matching?.kind === "matched" ? matching.songs.filter(song => resultGroup(song) === "available").length : null;
    const note = playlist.mayBeTruncated ? ` Spotify only shared the first ${playlist.tracks.length} tracks, so this playlist may have more.` : "";

    return (
        <Page>
            <div className="playlist-heading">
                {playlist.image && <img className="playlist-cover" src={playlist.image} alt="" />}
                <div className="playlist-title">
                    <h1>{playlist.name}</h1>
                    <p>{playlist.owner ? `By ${playlist.owner} · ` : ""}{plural(playlist.tracks.length, "track")}.{note}</p>
                </div>
                <SavePlaylist playlist={playlist} venue={venue} onChange={savedAt => setPlaylist({ ...playlist, savedAt })} />
            </div>

            <QueueAll key={venue} playlist={playlist} venue={venue} available={available}
                // Once it's done, look the songs up again so they show as queued
                onFinished={() => match(playlist, venue)} />

            <div id="output" aria-live="polite">
                {matching?.kind === "matching" && <>
                    <p className="playlist-progress">Finding songs on Rockbot: {matching.finished} of {playlist.tracks.length}</p>
                    <ul className="results">{playlist.tracks.map((track, i) => <TrackRow key={i} track={track} state={matching.states[i]} />)}</ul>
                </>}
                {matching?.kind === "matched" && <SongResults songs={matching.songs} notFound={matching.notFound} venue={venue}
                    onVote={(song, songVenue) => setVoteTarget({ song, venue: songVenue })} />}
            </div>

            <VoteDialog target={voteTarget} admin={!!user?.admin} onClose={() => setVoteTarget(null)} onVoted={() => {}}
                onArtist={artist => router.push(`/?${new URLSearchParams({ q: artist, venue })}`)} />
        </Page>
    );
}

/** Saves the playlist to your Library, along with every song of it Rockbot has, or takes it out */
function SavePlaylist({ playlist, venue, onChange }: { playlist: Playlist, venue: Venue, onChange: (savedAt: number | null) => void }) {
    const { reload } = useLibrary();
    const [busy, setBusy] = useState(false);
    const saved = !!playlist.savedAt;

    async function toggle() {
        if (saved && !confirm(`Take "${playlist.name}" out of your Library? Its songs stay saved.`)) return;
        setBusy(true);

        try {
            // Saving finds its songs at this venue on the server, which saves them as they're found
            const { response, data } = saved
                ? await deleteJson(`/v1/me/library/playlists/${playlist.id}`)
                : await putJson(`/v1/venues/${venue}/playlists/${playlist.id}/library`, {});
            if (!response.ok && !(saved && response.status === 404)) throw new Error(data?.error ?? `That didn't work (${response.status})`);
            onChange(saved ? null : data?.savedAt ?? Date.now());
            // The songs' hearts fill in once they're saved, which is quick when this page has already found them
            if (!saved) setTimeout(() => reload().catch(() => {}), 1500);
        } catch (error) {
            alert((error as Error).message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <button type="button" className={cx("queue-btn save-playlist", saved && "done", busy && "busy")} aria-pressed={saved} disabled={busy} onClick={toggle}
            title={saved ? "Take it out of your Library" : "Save it and its songs to your Library"}>
            {busy ? <Busy label={saved ? "Removing…" : "Saving…"} /> : saved ? "In your Library ✓" : "Save to Library"}
        </button>
    );
}

const Page = ({ children }: { children: React.ReactNode }) => (
    <div className="page-home page-playlist">
        <main className="has-results">{children}</main>
    </div>
);

/** "Queue all": starts the server queuing every song it can, then follows along until it's done */
function QueueAll({ playlist, venue, available, onFinished }: { playlist: Playlist, venue: Venue, available: number | null, onFinished: () => void }) {
    const venueName = useSchool().venueName(venue);
    // Live from the server, including jobs someone else started
    const job = useLivePlaylistJob(playlist.id, venue);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState("");
    const running = !!job && !job.finishedAt;

    // Once a job finishes while we're watching, look the songs up again so they show as queued
    const finishedRef = useRef(onFinished);
    useEffect(() => { finishedRef.current = onFinished; });
    const wasRunning = useRef(false);

    useEffect(() => {
        if (wasRunning.current && job?.finishedAt) finishedRef.current();
        wasRunning.current = running;
    }, [job, running]);

    async function start() {
        if (!confirm(`Queue every song from "${playlist.name}" that can be played at ${venueName}? They'll play in playlist order, after anything already waiting.`)) return;

        setStarting(true);
        setError("");

        try {
            const { response, data } = await postJson<QueueJob & { error?: string }>(`/v1/venues/${venue}/playlists/${playlist.id}/queue`, {});
            if (!response.ok) throw new Error(data?.error ?? `Couldn't start queuing (${response.status})`);
            setPlaylistJob(playlist.id, venue, data);
        } catch (error) {
            setError((error as Error).message);
        } finally {
            setStarting(false);
        }
    }

    const counts = new Map<Outcome, number>();
    for (const track of job?.tracks ?? []) counts.set(track.outcome, (counts.get(track.outcome) ?? 0) + 1);
    const done = job ? job.tracks.filter(track => track.outcome !== "waiting" && track.outcome !== "working").length : 0;
    const skipped = job?.tracks.filter(track => track.outcome !== "queued" && track.outcome !== "waiting" && track.outcome !== "working") ?? [];

    return (
        <section className="queue-all" aria-live="polite">
            <div className="queue-all-row">
                <div>
                    <h2>Queue the whole playlist</h2>
                    <p>
                        {running ? `Queuing at ${venueName}: ${done} of ${job.tracks.length} tracks done, ${plural(counts.get("queued") ?? 0, "song")} queued so far.`
                            : available === null ? "Checking which songs can be played…"
                            : available === 0 && counts.get("queued") ? `Everything that can be played at ${venueName} is queued.`
                            : available === 0 ? `None of these songs can be queued at ${venueName} right now.`
                            : `${plural(available, "song")} can be queued at ${venueName}. The rest are skipped.`}
                    </p>
                </div>
                <button type="button" className="queue-btn boost" disabled={running || starting || !available} onClick={start}>
                    {running || starting ? <Busy label="Queuing…" /> : available ? `Queue ${plural(available, "song")}` : "Queue all"}
                </button>
            </div>

            {running && <div className="queue-all-bar" role="progressbar" aria-label="Queuing progress"><div style={{ width: `${(done / job.tracks.length) * 100}%` }} /></div>}
            {error && <p className="stopped" role="alert">{error}</p>}

            {job?.finishedAt && <>
                <p>
                    Last run {new Date(job.finishedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}:{" "}
                    {plural(counts.get("queued") ?? 0, "song")} queued, {skipped.length} skipped.
                </p>
                {job.stoppedEarly && <p className="stopped">{job.stoppedEarly}</p>}
                {skipped.length > 0 && (
                    <details>
                        <summary>Why {skipped.length === 1 ? "one was" : `${skipped.length} were`} skipped</summary>
                        <ul>
                            {skipped.map((track, i) => (
                                <li key={i}><strong>{track.title}</strong> by {track.artist}: {OUTCOME_LABELS[track.outcome]}{track.error ? ` (${track.error})` : ""}</li>
                            ))}
                        </ul>
                    </details>
                )}
            </>}
        </section>
    );
}
