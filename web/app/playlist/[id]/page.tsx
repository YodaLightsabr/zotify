"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { TrackRow, type TrackState } from "@/components/home/ResultRow";
import { Loading, Message, resultGroup, SongResults, type NotFound } from "@/components/home/Results";
import type { Playlist, PlaylistTrack, QueueEntry, Song } from "@/components/home/types";
import VoteDialog from "@/components/home/VoteDialog";
import { Busy } from "@/components/Spinner";
import { fetchOrThrow, getJson, postJson, runWithConcurrency, type Venue } from "@/lib/api";
import { plural, VENUE_LABELS, VENUES } from "@/lib/format";
import { setPlaylistJob, useLivePlaylistJob, type Outcome, type QueueJob } from "@/lib/live";
import { useMember } from "@/lib/useMember";
import "../../home.css";
import "./playlist.css";

// Only this many track searches run at once, to go easy on Rockbot
const MATCH_CONCURRENCY = 3;

/** Finds a playlist track's Rockbot song on the server, which also tries the artist alone if needed. Null means not on Rockbot */
const fetchMatch = async (track: PlaylistTrack, venue: Venue) =>
    (await fetchOrThrow<{ match: Song | null }>("/api/match", { title: track.title, artist: track.artist, venue }, "Search failed")).match;

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

const isVenue = (value: string | null): value is Venue => value === "anteatery" || value === "brandywine";

export default function PlaylistPage() {
    return <Suspense><PlaylistView /></Suspense>;
}

function PlaylistView() {
    const id = useParams<{ id: string }>().id;
    const params = useSearchParams();
    const router = useRouter();
    const user = useMember(`/playlist/${id}`);

    const [venue, setVenue] = useState<Venue>(() => isVenue(params.get("venue")) ? params.get("venue") as Venue : "anteatery");
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [error, setError] = useState("");
    const [matching, setMatching] = useState<Matching | null>(null);
    const [voteTarget, setVoteTarget] = useState<{ song: QueueEntry, venue: Venue } | null>(null);
    const matchId = useRef(0);

    useEffect(() => {
        if (!user) return;

        getJson<Playlist & { error?: string }>(`/api/playlists/${id}`).then(({ response, data }) => {
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
                    matches[i] = await fetchMatch(track, venue);
                } catch {
                    states[i] = "retrying";
                    show();
                    matches[i] = await fetchMatch(track, venue);
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

    function changeVenue(next: Venue) {
        setVenue(next);
        router.replace(`/playlist/${id}?${new URLSearchParams({ venue: next })}`, { scroll: false });
    }

    if (error) return <Page><Message text={error} /></Page>;
    if (!playlist) return <Page><Loading /></Page>;

    const available = matching?.kind === "matched" ? matching.songs.filter(song => resultGroup(song) === "available").length : null;
    const note = playlist.mayBeTruncated ? ` Spotify only shared the first ${playlist.tracks.length} tracks, so this playlist may have more.` : "";

    return (
        <Page>
            <div className="playlist-heading">
                <h1>{playlist.name}</h1>
                <p>{playlist.owner ? `By ${playlist.owner} · ` : ""}{plural(playlist.tracks.length, "track")}.{note}</p>
            </div>

            <div className="venues" role="radiogroup" aria-label="Venue">
                {VENUES.map(([value, label]) => <Fragment key={value}>
                    <input type="radio" name="venue" id={`venue-${value}`} value={value} checked={venue === value} onChange={() => changeVenue(value)} />
                    <label htmlFor={`venue-${value}`}>{label}</label>
                </Fragment>)}
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

const Page = ({ children }: { children: React.ReactNode }) => (
    <div className="page-home page-playlist">
        <main className="has-results">{children}</main>
    </div>
);

/** "Queue all": starts the server queuing every song it can, then follows along until it's done */
function QueueAll({ playlist, venue, available, onFinished }: { playlist: Playlist, venue: Venue, available: number | null, onFinished: () => void }) {
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
        if (!confirm(`Queue every song from "${playlist.name}" that can be played at ${VENUE_LABELS[venue]}? They'll play in playlist order, after anything already waiting.`)) return;

        setStarting(true);
        setError("");

        try {
            const { response, data } = await postJson<QueueJob & { error?: string }>(`/api/playlists/${playlist.id}/queue`, { venue });
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
                        {running ? `Queuing at ${VENUE_LABELS[venue]}: ${done} of ${job.tracks.length} tracks done, ${plural(counts.get("queued") ?? 0, "song")} queued so far.`
                            : available === null ? "Checking which songs can be played…"
                            : available === 0 && counts.get("queued") ? `Everything that can be played at ${VENUE_LABELS[venue]} is queued.`
                            : available === 0 ? `None of these songs can be queued at ${VENUE_LABELS[venue]} right now.`
                            : `${plural(available, "song")} can be queued at ${VENUE_LABELS[venue]}. The rest are skipped.`}
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
