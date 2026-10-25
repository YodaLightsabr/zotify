import {
  Action,
  ActionPanel,
  Color,
  confirmAlert,
  Detail,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { CommonActions, requestSong, vote, withToast } from "./actions";
import { RESULT_GROUPS, resultGroup, SongItem } from "./songs";
import {
  refreshMenuBar,
  spotifyUrl,
  zotify,
  type Playlist,
  type PlaylistJob,
  type School,
  type SearchResult,
  type TrackOutcome,
  type Venue,
} from "./zotify";

// A Spotify playlist, pushed from Zotify Queue when a playlist link is pasted into its search bar. The server finds every
// track on Rockbot first (POST /v1/venues/:venue/playlists/:id/matches), behind a loading screen, so only songs that are
// really there are listed, grouped like search results. ↵ requests one; Request All (⌘⇧↵) requests the lot in the background,
// and each song's tag shows how it went

// How often the server's jobs are checked on
const POLL_MS = 1000;

interface Matches {
  finishedAt: number | null;
  tracks: {
    title: string;
    artist: string;
    uri?: string;
    state: "waiting" | "done" | "failed";
    match: SearchResult | null;
    duplicate: boolean;
  }[];
}

const OUTCOMES: Partial<Record<TrackOutcome, { value: string; color: Color }>> = {
  working: { value: "Requesting…", color: Color.SecondaryText },
  queued: { value: "Requested", color: Color.Green },
  failed: { value: "Failed", color: Color.Red },
};

/** Checks on a server job every second until it's finished */
function usePolled<T extends { finishedAt: number | null }>(
  path: string | null,
  job: T | null,
  onUpdate: (job: T) => void,
) {
  const running = !!job && !job.finishedAt;

  useEffect(() => {
    if (!running || !path) return;
    const timer = setInterval(async () => {
      const next = await zotify<T | null>(path).catch(() => null);
      if (next) onUpdate(next);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, path]);
}

interface Props {
  venue: Venue;
  school: School;
  url: string;
  venueTitle: (id: string) => string;
  // Back to Zotify Queue, searching for an artist
  onSearchArtist: (artist: string) => void;
}

export default function PlaylistView({ venue, school, url, venueTitle, onSearchArtist }: Props) {
  const { pop } = useNavigation();
  // Adding it reads it fresh from Spotify, and puts it in your playlists on the website too
  const playlist = usePromise(() => zotify<Playlist>("/v1/me/playlists", { method: "POST", body: { url } }), [], {
    failureToastOptions: { title: "Couldn't open that playlist" },
  });

  const id = playlist.data?.id;
  const matchesPath = id ? `/v1/venues/${venue.id}/playlists/${id}/matches` : null;
  const queuePath = id ? `/v1/venues/${venue.id}/playlists/${id}/queue` : null;

  const [matches, setMatches] = useState<Matches | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [queueJob, setQueueJob] = useState<PlaylistJob | null>(null);
  // Songs requested from here, which show as queued without searching again
  const [requested, setRequested] = useState<Set<string>>(new Set());

  async function findTracks(fresh = false) {
    if (!matchesPath) return;
    setMatchError(null);
    try {
      setMatches(await zotify<Matches>(`${matchesPath}${fresh ? "?fresh=1" : ""}`, { method: "POST", body: {} }));
    } catch (error) {
      setMatchError((error as Error).message);
    }
  }

  // Find every track as soon as the playlist's read, and see how any earlier "request all" went
  useEffect(() => {
    if (!matchesPath || !queuePath) return;
    findTracks();
    zotify<PlaylistJob | null>(queuePath)
      .then(setQueueJob)
      .catch(() => {});
  }, [matchesPath]);

  usePolled(matchesPath, matches, setMatches);
  usePolled(queuePath, queueJob, (job) => {
    setQueueJob(job);
    if (!job.finishedAt) return;

    const queued = job.tracks.filter((track) => track.outcome === "queued").length;
    showToast({
      style: Toast.Style.Success,
      title: `Requested ${queued} songs`,
      message: job.stoppedEarly ?? undefined,
    });
    refreshMenuBar();
  });

  const name = playlist.data?.name ?? "Spotify Playlist";

  if (playlist.error || matchError) {
    return (
      <Detail
        navigationTitle={name}
        markdown={`# Couldn't open that playlist\n\n${playlist.error?.message ?? matchError}`}
        actions={
          matchError ? (
            <ActionPanel>
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => findTracks()} />
            </ActionPanel>
          ) : undefined
        }
      />
    );
  }

  // The loading screen, until every track has been looked up
  if (!matches?.finishedAt) {
    const total = matches?.tracks.length ?? playlist.data?.tracks.length ?? 0;
    const done = matches?.tracks.filter((track) => track.state !== "waiting").length ?? 0;
    return (
      <Detail
        isLoading
        navigationTitle={name}
        markdown={
          playlist.data
            ? `# ${name}\n\nFinding its tracks on Rockbot at ${venue.name}… **${done} of ${total}**`
            : "# Reading the playlist from Spotify…"
        }
      />
    );
  }

  // Each song once, marked queued if it was requested from here
  const songs = matches.tracks.flatMap((track, index) =>
    track.match && !track.duplicate
      ? [{ index, song: requested.has(track.match.id) ? { ...track.match, status: "queued" as const } : track.match }]
      : [],
  );
  const notFound = matches.tracks.filter((track) => track.state === "done" && !track.match);
  const failed = matches.tracks.filter((track) => track.state === "failed");
  const running = !!queueJob && !queueJob.finishedAt;

  async function requestAll() {
    if (!queuePath) return;

    const confirmed = await confirmAlert({
      title: `Request ${songs.length} songs?`,
      message: `Every song from the playlist that can be played at ${venue.name} goes into Zotify's queue, in order.`,
      icon: Icon.List,
      primaryAction: { title: "Request All" },
    });
    if (!confirmed) return;

    await withToast(
      { working: "Starting…", failed: "Couldn't request the playlist" },
      () => zotify<PlaylistJob>(queuePath, { method: "POST", body: {} }),
      (job) => {
        setQueueJob(job);
        return { title: `Requesting ${songs.length} songs…` };
      },
    );
  }

  const playlistActions = (song?: { name: string; artist: string }) => (
    <>
      <ActionPanel.Section>
        <Action
          title={`Request All ${songs.length} Songs`}
          icon={Icon.List}
          shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
          onAction={requestAll}
        />
      </ActionPanel.Section>
      <CommonActions
        song={song}
        school={school}
        onRefresh={() => findTracks(true)}
        onSearchArtist={(artist) => {
          pop();
          onSearchArtist(artist);
        }}
      />
    </>
  );

  // Tracks with no song to request: the first action opens them in Spotify instead
  const trackItem = (track: Matches["tracks"][number], icon: Icon, tooltip: string) => (
    <List.Item
      key={`${track.title}-${track.artist}`}
      title={track.title}
      subtitle={track.artist}
      icon={{ value: icon, tooltip }}
      actions={
        <ActionPanel title={track.title}>
          {track.uri && (
            <Action.OpenInBrowser
              title="Open in Spotify"
              url={spotifyUrl(track.uri)}
              shortcut={Keyboard.Shortcut.Common.Open}
            />
          )}
          {playlistActions({ name: track.title, artist: track.artist })}
        </ActionPanel>
      }
    />
  );

  return (
    <List isLoading={running} navigationTitle={name} searchBarPlaceholder={`Filter ${name}…`}>
      {RESULT_GROUPS.map(([group, title]) => {
        const here = songs.filter(({ song }) => resultGroup(song) === group);
        return (
          <List.Section key={group} title={title} subtitle={here.length ? String(here.length) : undefined}>
            {here.map(({ song, index }) => {
              const outcome = queueJob?.tracks[index]?.outcome;
              const tag = outcome ? OUTCOMES[outcome] : undefined;

              return (
                <SongItem
                  key={song.id}
                  song={song}
                  venueTitle={venueTitle}
                  accessories={tag ? [{ tag }] : []}
                  onRequest={async () => {
                    if (await requestSong(venue, song)) setRequested(new Set(requested).add(song.id));
                  }}
                  onUpvote={() =>
                    vote(venue, { pickId: song.pickId!, name: song.name, artist: song.artist }, undefined, song.id)
                  }
                  common={playlistActions(song)}
                />
              );
            })}
          </List.Section>
        );
      })}

      <List.Section title="Not on Rockbot" subtitle={notFound.length ? String(notFound.length) : undefined}>
        {notFound.map((track) => trackItem(track, Icon.XMarkCircle, "Rockbot doesn't have it"))}
      </List.Section>

      <List.Section title="Couldn't Look Up" subtitle={failed.length ? String(failed.length) : undefined}>
        {failed.map((track) => trackItem(track, Icon.Warning, "The search didn't work. Refresh (⌘R) to try again"))}
      </List.Section>
    </List>
  );
}
