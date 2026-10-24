import { Action, ActionPanel, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { requestSong, withToast } from "./actions";
import {
  refreshMenuBar,
  spotifyUrl,
  zotify,
  type Playlist,
  type PlaylistJob,
  type SearchResult,
  type TrackOutcome,
  type Venue,
} from "./zotify";

// A Spotify playlist, pushed from Zotify Queue when a playlist link is pasted into the search bar. Request one track (↵) or the
// whole playlist (⌘↵), which the server works through in the background, like the website's "Queue all"; each track shows how
// it went

// How often a running "request all" is checked on
const POLL_MS = 2000;

const OUTCOMES: Record<TrackOutcome, { value: string; color: Color } | null> = {
  waiting: null,
  working: { value: "Requesting…", color: Color.SecondaryText },
  queued: { value: "Requested", color: Color.Green },
  "not-found": { value: "Not on Rockbot", color: Color.SecondaryText },
  unavailable: { value: "Unavailable", color: Color.Red },
  "already-queued": { value: "Already Queued", color: Color.Yellow },
  "played-recently": { value: "Played Recently", color: Color.SecondaryText },
  duplicate: { value: "Duplicate", color: Color.SecondaryText },
  failed: { value: "Failed", color: Color.Red },
};

export default function PlaylistView({ venue, url }: { venue: Venue; url: string }) {
  // Adding it reads it fresh from Spotify, and puts it in your playlists on the website too
  const playlist = usePromise(() => zotify<Playlist>("/v1/me/playlists", { method: "POST", body: { url } }), [], {
    failureToastOptions: { title: "Couldn't open that playlist" },
  });
  const [job, setJob] = useState<PlaylistJob | null>(null);

  const id = playlist.data?.id;
  const jobPath = id ? `/v1/venues/${venue.id}/playlists/${id}/queue` : null;

  // How the last "request all" went, then checking on it while it runs
  useEffect(() => {
    if (!jobPath) return;
    zotify<PlaylistJob | null>(jobPath)
      .then(setJob)
      .catch(() => {});
  }, [jobPath]);

  const running = !!job && !job.finishedAt;
  useEffect(() => {
    if (!running || !jobPath) return;

    const timer = setInterval(async () => {
      const next = await zotify<PlaylistJob | null>(jobPath).catch(() => null);
      if (!next) return;
      setJob(next);

      if (next.finishedAt) {
        const queued = next.tracks.filter((track) => track.outcome === "queued").length;
        await showToast({
          style: Toast.Style.Success,
          title: `Requested ${queued} of ${next.tracks.length} tracks`,
          message: next.stoppedEarly ?? undefined,
        });
        refreshMenuBar();
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [running, jobPath]);

  async function requestAll() {
    if (!playlist.data || !jobPath) return;

    const confirmed = await confirmAlert({
      title: `Request all ${playlist.data.tracks.length} tracks?`,
      message: `Every track Rockbot has goes into Zotify's queue at ${venue.name}, in order. Tracks it can't play there are skipped.`,
      icon: Icon.List,
      primaryAction: { title: "Request All" },
    });
    if (!confirmed) return;

    await withToast(
      { working: "Starting…", failed: "Couldn't request the playlist" },
      () => zotify<PlaylistJob>(jobPath, { method: "POST", body: {} }),
      (started) => {
        setJob(started);
        return { title: `Requesting ${started.tracks.length} tracks…`, message: "This takes a minute or two" };
      },
    );
  }

  /** Finds a track on Rockbot, then requests it */
  async function requestOne(track: Playlist["tracks"][number]) {
    let match: SearchResult | null;
    try {
      ({ match } = await zotify<{ match: SearchResult | null }>(
        `/v1/venues/${venue.id}/match?${new URLSearchParams({ title: track.title, artist: track.artist })}`,
      ));
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: `Couldn't find ${track.title}`,
        message: (error as Error).message,
      });
      return;
    }

    if (!match) {
      await showToast({ style: Toast.Style.Failure, title: `Rockbot doesn't have ${track.title}` });
    } else if (!match.requestable) {
      await showToast({ style: Toast.Style.Failure, title: `${match.name} can't be requested at ${venue.name}` });
    } else {
      await requestSong(venue, match);
    }
  }

  const tracks = playlist.data?.tracks ?? [];
  const done = job?.tracks.filter((track) => !["waiting", "working"].includes(track.outcome)).length ?? 0;

  return (
    <List
      isLoading={playlist.isLoading || running}
      navigationTitle={playlist.data?.name ?? "Spotify Playlist"}
      searchBarPlaceholder="Filter tracks…"
    >
      {playlist.error && (
        <List.EmptyView icon={Icon.Warning} title="Couldn't open that playlist" description={playlist.error.message} />
      )}
      <List.Section
        title={
          playlist.data ? `${playlist.data.name}${playlist.data.owner ? ` by ${playlist.data.owner}` : ""}` : undefined
        }
        subtitle={
          running
            ? `Requesting… ${done} of ${tracks.length}`
            : `${tracks.length}${playlist.data?.mayBeTruncated ? "+" : ""} tracks · at ${venue.name}`
        }
      >
        {tracks.map((track, i) => {
          // The job lists every track in the same order
          const outcome = job?.tracks[i]?.title === track.title ? job.tracks[i] : undefined;
          const tag = outcome && OUTCOMES[outcome.outcome];

          return (
            <List.Item
              key={`${i}-${track.title}`}
              title={track.title}
              subtitle={track.artist}
              icon={Icon.Music}
              keywords={[track.artist]}
              accessories={tag ? [{ tag, tooltip: outcome?.error }] : []}
              actions={
                <ActionPanel title={track.title}>
                  <Action title="Request Song" icon={Icon.PlusCircle} onAction={() => requestOne(track)} />
                  <Action title={`Request All ${tracks.length} Tracks`} icon={Icon.List} onAction={requestAll} />
                  <ActionPanel.Section>
                    {track.uri && (
                      <Action.OpenInBrowser
                        title="Open in Spotify"
                        url={spotifyUrl(track.uri)}
                        shortcut={Keyboard.Shortcut.Common.Open}
                      />
                    )}
                    <Action.CopyToClipboard
                      title="Copy Song Name"
                      content={`${track.title} by ${track.artist}`}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
