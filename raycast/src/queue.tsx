import { Action, ActionPanel, Color, Icon, List, type LaunchProps } from "@raycast/api";
import { useCachedPromise, withAccessToken } from "@raycast/utils";
import { useEffect, useState } from "react";
import {
  AdminQueueActions,
  CommonActions,
  DownvoteWithSubmenu,
  RemoveAction,
  requestSong,
  UpvoteAction,
  UpvoteWithSubmenu,
  vote,
} from "./actions";
import { JoinView } from "./join";
import PlaylistView from "./playlist";
import { cover, RESULT_GROUPS, resultGroup, SongItem } from "./songs";
import { useVenue, venueName } from "./venues";
import {
  clock,
  getVenueQueue,
  songName,
  zotify,
  zotifyAuth,
  ZotifyError,
  type Me,
  type NowPlaying,
  type QueueEntry,
  spotifyLink,
  type SearchResult,
  type ZotifyQueue,
} from "./zotify";

// Zotify Queue: what's playing and what's next at a venue, and search to request songs. With the search bar empty it's the
// queue; typing searches Rockbot instead, and Esc clears it back to the queue. See UX.md for the whole plan

// How often the queue is fetched while it's open. The API only asks Rockbot about this often anyway
const REFRESH_MS = 15_000;

interface Context {
  // Start searching for this, from Add Song to Zotify
  searchText?: string;
  // Select this pick, from clicking a song in the menu bar
  pickId?: string;
}

function Queue({ launchContext }: LaunchProps<{ launchContext: Context }>) {
  const [searchText, setSearchText] = useState(launchContext?.searchText ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    launchContext?.pickId ? `pick-${launchContext.pickId}` : undefined,
  );

  const me = useCachedPromise(() => zotify<Me>("/v1/me"), [], { keepPreviousData: true });
  const { venue, school, schools, setVenue, isLoading: venueLoading } = useVenue(me.data);
  const membership = me.data?.schools.find((entry) => entry.id === school?.id);
  const admin = !!membership?.admin && (!me.data?.scopes || me.data.scopes.includes("admin"));

  const queue = useCachedPromise(getVenueQueue, [venue?.id ?? ""], { execute: !!venue, keepPreviousData: true });
  const zotifyQueue = useCachedPromise(
    (id: string) => zotify<ZotifyQueue>(`/v1/venues/${id}/zotify-queue`),
    [venue?.id ?? ""],
    {
      execute: !!venue,
      keepPreviousData: true,
    },
  );

  const searching = searchText.trim().length > 0;
  // A pasted Spotify link: a track is looked up on Rockbot instead of searched for, and a playlist opens on its own
  const link = spotifyLink(searchText);
  const spotifyTrack = useCachedPromise(
    (id: string, url: string) =>
      zotify<{ match: SearchResult | null; track: { title: string; artist: string } }>(
        `/v1/venues/${id}/match?${new URLSearchParams({ spotify: url })}`,
      ),
    [venue?.id ?? "", link?.url ?? ""],
    { execute: !!venue && link?.kind === "track", keepPreviousData: false },
  );
  const search = useCachedPromise(
    (id: string, query: string) => zotify<SearchResult[]>(`/v1/venues/${id}/search?q=${encodeURIComponent(query)}`),
    [venue?.id ?? "", searchText.trim()],
    {
      execute: !!venue && searching && !link,
      keepPreviousData: true,
      // Not being in the school's Zotify gets its own empty view, not a toast
      onError: (error) => {
        if (!(error instanceof ZotifyError && error.code === "not_approved")) console.error(error);
      },
    },
  );

  const refresh = () => {
    queue.revalidate();
    zotifyQueue.revalidate();
    if (searching) search.revalidate();
  };

  // Keep the queue fresh while it's open. The playing song's time left counts down in NowPlayingItem, so only that row
  // re-renders every second
  useEffect(() => {
    const poll = setInterval(() => {
      queue.revalidate();
      zotifyQueue.revalidate();
    }, REFRESH_MS);
    return () => clearInterval(poll);
  }, [venue?.id]);

  const venueDropdown = (
    <List.Dropdown tooltip="Venue" value={venue?.id} onChange={(id) => id && id !== venue?.id && setVenue(id)}>
      {schools.map((entry) => (
        <List.Dropdown.Section key={entry.id} title={entry.name}>
          {entry.venues.map((option) => (
            <List.Dropdown.Item key={option.id} value={option.id} title={option.name} icon={Icon.Building} />
          ))}
        </List.Dropdown.Section>
      ))}
    </List.Dropdown>
  );

  const notApproved = me.data && school && !membership?.approved;
  const isLoading =
    venueLoading ||
    queue.isLoading ||
    (searching && !link && search.isLoading) ||
    (link?.kind === "track" && spotifyTrack.isLoading);

  if (!venue || !school) {
    return <List isLoading={isLoading || me.isLoading} searchBarAccessory={venueDropdown} />;
  }

  // Someone who isn't in the venue's school's Zotify can see the queue, and join from here
  const joinView = <JoinView school={school} request={membership?.request ?? null} onJoined={() => me.revalidate()} />;

  // Searching
  if (searching) {
    const track = link?.kind === "track" ? spotifyTrack : null;
    const results = track ? (track.data?.match ? [track.data.match] : []) : link ? [] : (search.data ?? []);
    const error = track ? track.error : search.error;
    const notApprovedError = error instanceof ZotifyError && error.code === "not_approved";

    return (
      <List
        isLoading={isLoading}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        throttle
        searchBarPlaceholder="Search songs or paste a Spotify link…"
        searchBarAccessory={venueDropdown}
      >
        {notApprovedError || notApproved ? (
          joinView
        ) : error ? (
          <List.EmptyView
            icon={Icon.Warning}
            title={track ? "Couldn't look up that track" : "Search didn't work"}
            description={error.message}
          />
        ) : track ? (
          track.data &&
          !track.data.match && (
            <List.EmptyView
              icon={Icon.MagnifyingGlass}
              title={`Rockbot doesn't have ${track.data.track.title}`}
              description={`By ${track.data.track.artist}, from Spotify`}
            />
          )
        ) : (
          !link &&
          !search.isLoading && (
            <List.EmptyView icon={Icon.MagnifyingGlass} title={`No songs found for "${searchText.trim()}"`} />
          )
        )}
        {link?.kind === "playlist" && !notApproved && (
          <List.Section title="Spotify Playlist">
            <List.Item
              title="Open Playlist"
              subtitle="See its tracks, and request them"
              icon={Icon.List}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Open Playlist"
                    icon={Icon.List}
                    target={
                      <PlaylistView
                        venue={venue}
                        school={school}
                        url={link.url}
                        venueTitle={(id) => venueName(schools, id)}
                        onSearchArtist={setSearchText}
                      />
                    }
                  />
                </ActionPanel>
              }
            />
          </List.Section>
        )}
        {RESULT_GROUPS.map(([group, title]) => {
          const songs = results.filter((song) => resultGroup(song) === group);
          const others = school.venues.filter((other) => other.id !== venue.id).map((other) => other.name);

          return (
            <List.Section
              key={group}
              title={group === "elsewhere" ? `Only Available at ${others.join(" or ")}` : title}
              subtitle={songs.length ? String(songs.length) : undefined}
            >
              {songs.map((song) => (
                <SongItem
                  key={song.id}
                  song={song}
                  venueTitle={(id) => venueName(schools, id)}
                  onSwitchVenue={(id) => setVenue(id)}
                  onShowInQueue={() => {
                    const waiting = zotifyQueue.data?.waiting.find((entry) => entry.songId === song.id);
                    setSearchText("");
                    setSelectedId(waiting ? `zotify-${waiting.id}` : song.pickId ? `pick-${song.pickId}` : undefined);
                  }}
                  onRequest={async () => {
                    // Shows as waiting straight away; requestSong's toast says if it didn't work, and it goes back
                    const requested = requestSong(venue, song).then(
                      (ok) => ok || Promise.reject(new Error("Not requested")),
                    );
                    await search
                      .mutate(requested, {
                        optimisticUpdate: (data) =>
                          data?.map((entry) => (entry.id === song.id ? { ...entry, status: "queued" } : entry)),
                      })
                      .catch(() => {});
                    zotifyQueue.revalidate();
                  }}
                  onUpvote={async () => {
                    await vote(
                      venue,
                      { pickId: song.pickId!, name: song.name, artist: song.artist },
                      undefined,
                      song.id,
                    );
                    refresh();
                  }}
                  common={
                    <CommonActions song={song} school={school} onRefresh={refresh} onSearchArtist={setSearchText} />
                  }
                />
              ))}
            </List.Section>
          );
        })}
      </List>
    );
  }

  // The queue
  const now = Date.now();
  const { queue: rockbot, closed, fetchedAt } = queue.data ?? { queue: null, closed: null, fetchedAt: now };
  const waiting = zotifyQueue.data?.waiting ?? [];
  const failures = zotifyQueue.data?.failures ?? [];
  const playing = rockbot?.nowPlaying;
  const empty = !playing && !rockbot?.onDeck.length && !rockbot?.comingUp.length && !waiting.length;

  const entryItem = (entry: QueueEntry, upcoming: boolean) => (
    <List.Item
      key={entry.pickId}
      id={`pick-${entry.pickId}`}
      title={entry.name}
      subtitle={entry.artist}
      icon={cover(entry.cover)}
      accessories={[
        ...(entry.zotify
          ? [{ tag: { value: "Zotify", color: Color.Yellow }, tooltip: "Requested through Zotify" }]
          : []),
        ...(entry.downvotes ? [{ icon: Icon.ArrowDown, text: String(entry.downvotes), tooltip: "Downvotes" }] : []),
        { icon: Icon.ArrowUp, text: String(entry.upvotes ?? 0), tooltip: "Upvotes" },
      ]}
      actions={
        <ActionPanel title={entry.name}>
          {upcoming && (
            <ActionPanel.Section>
              <UpvoteAction venue={venue} entry={entry} onDone={refresh} />
              <UpvoteWithSubmenu venue={venue} entry={entry} onDone={refresh} />
              {admin && <DownvoteWithSubmenu venue={venue} entry={entry} onDone={refresh} />}
            </ActionPanel.Section>
          )}
          <CommonActions song={entry} school={school} onRefresh={refresh} onSearchArtist={setSearchText} />
        </ActionPanel>
      }
    />
  );

  // Changes to Zotify's queue show straight away, and go back if they fail
  const changeWaiting = (task: Promise<unknown>, order: ZotifyQueue["waiting"] | null) =>
    zotifyQueue.mutate(task, { optimisticUpdate: (data) => (data && order ? { ...data, waiting: order } : data) });

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      throttle
      selectedItemId={selectedId}
      searchBarPlaceholder="Search songs or paste a Spotify link…"
      searchBarAccessory={venueDropdown}
    >
      {closed ? (
        <List.EmptyView icon={Icon.Moon} title={closed} description="Check back when it's open." />
      ) : notApproved ? (
        joinView
      ) : (
        empty && (
          <List.EmptyView
            icon={Icon.Music}
            title={`Nothing's queued at ${venue.name}`}
            description="Type to search for a song to request."
          />
        )
      )}

      {playing && (
        <List.Section title={`Now Playing at ${venue.name}`}>
          <NowPlayingItem
            playing={playing}
            fetchedAt={fetchedAt}
            actions={
              <ActionPanel title={playing.name}>
                <CommonActions song={playing} school={school} onRefresh={refresh} onSearchArtist={setSearchText} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      <List.Section title="On Deck" subtitle="Next up, locked in">
        {rockbot?.onDeck.map((entry) => entryItem(entry, true))}
      </List.Section>

      <List.Section title="Waiting in Zotify" subtitle="Goes into Rockbot's queue as there's room">
        {waiting.map((song, index) => (
          <List.Item
            key={song.id}
            id={`zotify-${song.id}`}
            title={song.name}
            subtitle={song.artist}
            icon={cover(song.cover)}
            accessories={[
              ...(song.mine ? [{ tag: { value: "You", color: Color.Blue } }] : []),
              { text: `#${index + 1}`, tooltip: "Place in Zotify's queue" },
            ]}
            actions={
              <ActionPanel title={song.name}>
                <ActionPanel.Section>
                  <Action.CopyToClipboard title="Copy Song Name" content={songName(song)} />
                  {(song.mine || admin) && (
                    <RemoveAction
                      venue={venue}
                      song={song}
                      mine={song.mine}
                      onRemove={(task) =>
                        zotifyQueue.mutate(task, {
                          optimisticUpdate: (data) =>
                            data && { ...data, waiting: data.waiting.filter((entry) => entry.id !== song.id) },
                        })
                      }
                    />
                  )}
                </ActionPanel.Section>
                {admin && <AdminQueueActions venue={venue} waiting={waiting} index={index} onChange={changeWaiting} />}
                <CommonActions school={school} onRefresh={refresh} onSearchArtist={setSearchText} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title="Coming Up" subtitle="By votes">
        {rockbot?.comingUp.map((entry) => entryItem(entry, true))}
      </List.Section>

      <List.Section title="Couldn't Be Requested">
        {failures.map((song) => (
          <List.Item
            key={song.id}
            id={`failed-${song.id}`}
            title={song.name}
            subtitle={song.artist}
            icon={{ source: Icon.Warning, tintColor: Color.Orange }}
            accessories={[
              { text: song.error ?? "Rockbot wouldn't take it", tooltip: song.error ?? undefined },
              { date: new Date(song.failedAt) },
            ]}
            actions={
              <ActionPanel title={song.name}>
                <Action
                  title="Request Again"
                  icon={Icon.Repeat}
                  onAction={async () => {
                    await requestSong(venue, { id: song.songId, name: song.name, artist: song.artist });
                    zotifyQueue.revalidate();
                  }}
                />
                <CommonActions song={song} school={school} onRefresh={refresh} onSearchArtist={setSearchText} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

/**
 * The playing song, counting down its time left. The timer is in here so that only this row re-renders every second, not the
 * whole list
 */
function NowPlayingItem({
  playing,
  fetchedAt,
  actions,
}: {
  playing: NowPlaying;
  fetchedAt: number;
  actions: React.ReactNode;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft =
    playing.secondsRemaining !== undefined
      ? Math.max(0, playing.secondsRemaining - (now - fetchedAt) / 1000)
      : undefined;

  return (
    <List.Item
      id={`pick-${playing.pickId}`}
      title={playing.name}
      subtitle={playing.artist}
      icon={cover(playing.cover)}
      accessories={[
        ...(playing.zotify
          ? [{ tag: { value: "Zotify", color: Color.Yellow }, tooltip: "Requested through Zotify" }]
          : []),
        ...(secondsLeft !== undefined ? [{ icon: Icon.Clock, text: `${clock(secondsLeft)} left` }] : []),
      ]}
      actions={actions}
    />
  );
}

export default withAccessToken(zotifyAuth)(Queue);
