"use client";

import { useEffect, useState } from "react";
import { cx, plural } from "@/lib/format";
import { useLiveVenues } from "@/lib/live";
import { useSchool } from "@/lib/school";
import { adminGet, formatTime, Loading, useLoad } from "./shared";

/** The school's overview: which commit is running (and any on its way), and what's playing at each venue */
export default function Overview() {
    return <>
        <Version />
        <NowPlaying />
    </>;
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

const loadVersion = () => adminGet<VersionInfo | null>("/v1/admin/version", "the version");
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
                        {/* Releases deployed before .release-info existed only know their commit */}
                        {data.committedAt ? `Committed ${timestamp(data.committedAt)}` : "Commit details unknown"}
                        {data.deployedAt ? ` · deployed ${timestamp(data.deployedAt)}` : ""}
                        {` · API up since ${timestamp(data.startedAt)}`}
                    </div>
                    <DeployProgress running={data.commit} />
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

// A new commit on its way: a bar from when it was committed to 1.5 times the average time deploys take, so it's usually
// done before the end. The deploy script reports the newest commit on GitHub every minute (see src/deploys.ts)

interface Deploys {
    running: string | null;
    latest: { commit: string, committedAt: string, state: "building" | "failed" | "live", subject: string } | null;
    averageMs: number;
    samples: number;
}

const loadDeploys = () => adminGet<Deploys>("/v1/admin/deploys", "deploys");

const minutes = (ms: number) => {
    const total = Math.max(1, Math.round(ms / 60_000));
    return total === 1 ? "about a minute" : `about ${total} minutes`;
};

function DeployProgress({ running }: { running: string }) {
    const { data, reload } = useLoad(loadDeploys);
    const [now, setNow] = useState(Date.now());

    // Check for news every 10 seconds, and move the bar along every second
    useEffect(() => {
        const poll = setInterval(() => { if (!document.hidden) reload(); }, 10_000);
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => {
            clearInterval(poll);
            clearInterval(tick);
        };
    }, [reload]);

    const latest = data?.latest;
    if (!data || !latest) return null;

    // It went live since this page loaded
    if (latest.commit === data.running && data.running !== running) {
        return (
            <div className="deploy done">
                <span>Deployed <span className="code">{latest.commit.slice(0, 7)}</span> {latest.subject}</span>
                <button type="button" className="small" onClick={() => location.reload()}>Reload</button>
            </div>
        );
    }

    if (latest.commit === data.running) return null;

    const committedAt = Date.parse(latest.committedAt);
    const expected = data.averageMs * 1.5;
    const elapsed = now - committedAt;
    // Never quite full until it's live
    const progress = Math.min(Math.max(elapsed / expected, 0), 0.98);
    const failed = latest.state === "failed";

    return (
        <div className={cx("deploy", failed && "failed")} role="status">
            <div className="deploy-label">
                <span>{failed ? "Build failed for" : "Deploying"} <span className="code">{latest.commit.slice(0, 7)}</span> <span className="version-subject">{latest.subject}</span></span>
                <span className="muted">
                    {failed ? `${running.slice(0, 7)} keeps running`
                        : elapsed < data.averageMs ? `${minutes(data.averageMs - elapsed)} left`
                        : "Taking longer than usual"}
                </span>
            </div>
            <div className="deploy-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <div style={{ width: `${failed ? 100 : progress * 100}%` }} />
            </div>
            <span className="muted small-note">
                Deploys take {minutes(data.averageMs)} on average{data.samples ? `, over the last ${plural(data.samples, "deploy")}` : " (a guess until one's been timed)"}
            </span>
        </div>
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
