import {
  Color,
  environment,
  getPreferenceValues,
  Icon,
  Image,
  Keyboard,
  launchCommand,
  LaunchType,
  MenuBarExtra,
  open,
  showHUD,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useVenue } from "./venues";
import {
  clock,
  getVenueQueue,
  savedToken,
  songName,
  zotify,
  type QueueEntry,
  type VoteResult,
  type ZotifyQueue,
} from "./zotify";

// Zotify Now Playing: the song playing at your venue in the menu bar, and the queue in its menu. It refreshes every minute
// in the background and whenever it's clicked. It never asks to sign in: the queue is public, and Zotify's waiting songs
// only show when a token is already saved (see savedToken)

// How many Coming Up songs the menu lists before "more…"
const UP_NEXT = 8;
const MAX_TITLE = 24;

const cover = (url?: string): Image.ImageLike =>
  url ? { source: url, mask: Image.Mask.RoundedRectangle } : Icon.Music;
const shorten = (text: string) => (text.length > MAX_TITLE ? `${text.slice(0, MAX_TITLE - 1).trimEnd()}…` : text);

/** Opens Zotify Queue, which signs in if it needs to. pickId selects that song there; searchText starts a search */
const openQueue = (context: { pickId?: string; searchText?: string } = {}) =>
  launchCommand({ name: "queue", type: LaunchType.UserInitiated, context });

export default function NowPlaying() {
  const { showTitle } = getPreferenceValues<Preferences.NowPlaying>();
  const { venue, school, schools, setVenue, isLoading: venueLoading } = useVenue();

  // Only refresh an expired token when someone clicked, not in the background
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const token = await savedToken(environment.launchType === LaunchType.UserInitiated);
      const [queue, waiting] = await Promise.all([
        getVenueQueue(id),
        token ? zotify<ZotifyQueue>(`/v1/venues/${id}/zotify-queue`, { token }).catch(() => null) : null,
      ]);
      return { ...queue, waiting: waiting?.waiting ?? null };
    },
    [venue?.id ?? ""],
    { execute: !!venue, keepPreviousData: true },
  );

  const playing = data?.queue?.nowPlaying;
  // In the same order as Zotify Queue: on deck, then Zotify's waiting songs, then the rest of Rockbot's queue
  const onDeck = data?.queue?.onDeck ?? [];
  const comingUp = data?.queue?.comingUp ?? [];
  const secondsLeft =
    playing?.secondsRemaining !== undefined && data
      ? Math.max(0, playing.secondsRemaining - (Date.now() - data.fetchedAt) / 1000)
      : undefined;

  async function upvote(entry: QueueEntry) {
    const token = await savedToken(true);
    if (!token || !venue) return openQueue({ pickId: entry.pickId });

    try {
      const result = await zotify<VoteResult>(`/v1/venues/${venue.id}/picks/${entry.pickId}/votes`, {
        method: "POST",
        token,
        body: {},
      });
      await showHUD(
        result.requested
          ? `Upvoted ${entry.name} with ${result.confirmed ?? result.requested} accounts`
          : `Every account has already voted for ${entry.name}`,
      );
      revalidate();
    } catch (error) {
      await showHUD(`Couldn't upvote ${entry.name}: ${(error as Error).message}`);
    }
  }

  const songItem = (entry: QueueEntry, subtitle: string) => (
    <MenuBarExtra.Item
      key={entry.pickId}
      title={entry.name}
      subtitle={subtitle}
      icon={cover(entry.cover)}
      tooltip={entry.zotify ? "Requested through Zotify" : undefined}
      onAction={() => openQueue({ pickId: entry.pickId })}
      alternate={
        <MenuBarExtra.Item title={`Upvote ${entry.name}`} icon={Icon.ArrowUp} onAction={() => upvote(entry)} />
      }
    />
  );

  const upcoming = (entry: QueueEntry) =>
    songItem(
      entry,
      [entry.artist, entry.zotify ? "Zotify" : null, `▲${entry.upvotes ?? 0}`].filter(Boolean).join(" · "),
    );

  return (
    <MenuBarExtra
      icon={{ source: "menu-bar.png", tintColor: Color.PrimaryText }}
      title={showTitle && playing ? shorten(playing.name) : undefined}
      tooltip={playing && venue ? `${songName(playing)}, at ${venue.name}` : "Zotify"}
      isLoading={venueLoading || isLoading}
    >
      {data?.closed && <MenuBarExtra.Item title={data.closed} icon={Icon.Moon} />}

      {playing && venue && (
        <MenuBarExtra.Section title={`Now Playing at ${venue.name}`}>
          {songItem(
            playing,
            [playing.artist, secondsLeft !== undefined ? `${clock(secondsLeft)} left` : null]
              .filter(Boolean)
              .join(" · "),
          )}
        </MenuBarExtra.Section>
      )}

      {!data?.closed && !playing && venue && data && <MenuBarExtra.Item title={`Nothing's playing at ${venue.name}`} />}

      {onDeck.length > 0 && <MenuBarExtra.Section title="On Deck">{onDeck.map(upcoming)}</MenuBarExtra.Section>}

      {!!data?.waiting?.length && (
        <MenuBarExtra.Section title="Waiting in Zotify">
          {data.waiting.map((song, index) => (
            <MenuBarExtra.Item
              key={song.id}
              title={`${index + 1}. ${song.name}`}
              subtitle={[song.artist, song.mine ? "You" : null].filter(Boolean).join(" · ")}
              icon={cover(song.cover)}
              onAction={() => openQueue()}
            />
          ))}
        </MenuBarExtra.Section>
      )}

      {comingUp.length > 0 && (
        <MenuBarExtra.Section title="Coming Up">
          {comingUp.slice(0, UP_NEXT).map(upcoming)}
          {comingUp.length > UP_NEXT && (
            <MenuBarExtra.Item title={`${comingUp.length - UP_NEXT} more…`} onAction={() => openQueue()} />
          )}
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Add Song…"
          icon={Icon.PlusCircle}
          shortcut={Keyboard.Shortcut.Common.New}
          onAction={() => openQueue({ searchText: "" })}
        />
        <MenuBarExtra.Item
          title="Open Zotify Queue"
          icon={Icon.List}
          shortcut={Keyboard.Shortcut.Common.Open}
          onAction={() => openQueue()}
        />
        <MenuBarExtra.Submenu title={venue ? `Venue: ${venue.name}` : "Venue"} icon={Icon.Building}>
          {schools.map((entry) => (
            <MenuBarExtra.Section key={entry.id} title={entry.name}>
              {entry.venues.map((option) => (
                <MenuBarExtra.Item
                  key={option.id}
                  title={option.name}
                  icon={option.id === venue?.id ? Icon.Checkmark : Icon.Building}
                  onAction={() => setVenue(option.id)}
                />
              ))}
            </MenuBarExtra.Section>
          ))}
        </MenuBarExtra.Submenu>
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={revalidate}
        />
        {school && (
          <MenuBarExtra.Item title="Open Zotify Website" icon={Icon.Globe} onAction={() => open(school.url)} />
        )}
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
