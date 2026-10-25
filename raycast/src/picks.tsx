import { Action, ActionPanel, Icon, Keyboard, launchCommand, LaunchType, List } from "@raycast/api";
import { useCachedPromise, withAccessToken } from "@raycast/utils";
import { requestSong } from "./actions";
import { cover } from "./songs";
import { useVenue, venueName } from "./venues";
import { songName, zotify, zotifyAuth, type Me } from "./zotify";

// My Zotify Picks: every song you've requested that made it into a Rockbot queue, newest first, grouped by day like the
// website's My picks. ↵ requests one again at the venue in the search bar's dropdown

interface Pick {
  pickId: string;
  songId: string;
  name: string;
  artist: string;
  cover?: string;
  venue: string;
  requestedAt: number;
}

/** "Today", "Yesterday", or the date */
function dayLabel(timestamp: number) {
  const day = new Date(timestamp).toDateString();
  if (day === new Date().toDateString()) return "Today";
  if (day === new Date(Date.now() - 86_400_000).toDateString()) return "Yesterday";
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function MyPicks() {
  const me = useCachedPromise(() => zotify<Me>("/v1/me"), [], { keepPreviousData: true });
  const { venue, school, schools, setVenue, isLoading: venueLoading } = useVenue(me.data);
  const picks = useCachedPromise((id: string) => zotify<Pick[]>(`/v1/me/picks?school=${id}`), [school?.id ?? ""], {
    execute: !!school,
    keepPreviousData: true,
  });

  // Grouped by day, newest first
  const days = new Map<string, Pick[]>();
  for (const pick of picks.data ?? []) {
    const label = dayLabel(pick.requestedAt);
    days.set(label, [...(days.get(label) ?? []), pick]);
  }

  return (
    <List
      isLoading={venueLoading || picks.isLoading}
      searchBarPlaceholder="Filter your picks…"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Request Again At"
          value={venue?.id}
          onChange={(id) => id && id !== venue?.id && setVenue(id)}
        >
          {schools.map((entry) => (
            <List.Dropdown.Section key={entry.id} title={entry.name}>
              {entry.venues.map((option) => (
                <List.Dropdown.Item key={option.id} value={option.id} title={option.name} icon={Icon.Building} />
              ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
    >
      <List.EmptyView
        icon={Icon.Music}
        title="No picks yet"
        description="Songs you request show up here once they're in a venue's queue."
        actions={
          <ActionPanel>
            <Action
              title="Search for a Song"
              icon={Icon.MagnifyingGlass}
              onAction={() =>
                launchCommand({ name: "queue", type: LaunchType.UserInitiated, context: { searchText: "" } })
              }
            />
          </ActionPanel>
        }
      />
      {[...days].map(([label, dayPicks]) => (
        <List.Section key={label} title={label} subtitle={String(dayPicks.length)}>
          {dayPicks.map((pick) => (
            <List.Item
              key={pick.pickId}
              title={pick.name}
              subtitle={pick.artist}
              icon={cover(pick.cover)}
              keywords={[pick.artist]}
              accessories={[
                { text: venueName(schools, pick.venue), icon: Icon.Building },
                {
                  text: new Date(pick.requestedAt).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                },
              ]}
              actions={
                <ActionPanel title={pick.name}>
                  {venue && (
                    <Action
                      title="Request Again"
                      icon={Icon.Repeat}
                      onAction={() => requestSong(venue, { id: pick.songId, name: pick.name, artist: pick.artist })}
                    />
                  )}
                  <ActionPanel.Section>
                    <Action
                      title="Search Artist"
                      icon={Icon.MagnifyingGlass}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
                      onAction={() =>
                        launchCommand({
                          name: "queue",
                          type: LaunchType.UserInitiated,
                          context: { searchText: pick.artist },
                        })
                      }
                    />
                    <Action.CopyToClipboard
                      title="Copy Song Name"
                      content={songName(pick)}
                      shortcut={Keyboard.Shortcut.Common.Copy}
                    />
                    <Action
                      title="Refresh"
                      icon={Icon.ArrowClockwise}
                      shortcut={Keyboard.Shortcut.Common.Refresh}
                      onAction={picks.revalidate}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

export default withAccessToken(zotifyAuth)(MyPicks);
