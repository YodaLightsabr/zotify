import { Action, ActionPanel, Color, Icon, Image, List } from "@raycast/api";
import type { SearchResult } from "./zotify";

// Songs from Rockbot as list items, shared by Zotify Queue's search and a Spotify playlist's tracks: how they're grouped, and
// what ↵ does for each (see UX.md)

export const cover = (url?: string): Image.ImageLike =>
  url ? { source: url, mask: Image.Mask.RoundedRectangle } : Icon.Music;

// Search results' groups, in order: what you can request, then what you can't, like the website's but with the songs you can
// request first
export const RESULT_GROUPS = [
  ["available", "Available to Play"],
  ["elsewhere", "Only Available Elsewhere"],
  ["unavailable", "Unavailable Anywhere"],
  ["others", "Requested by Others"],
  ["cooldown", "On Cooldown"],
] as const;

/** Which group a search result belongs in. Songs Zotify queued can't be queued again, so like cooldown songs they're together */
export function resultGroup(song: SearchResult): (typeof RESULT_GROUPS)[number][0] {
  if (!song.requestable) return song.availableAt ? "elsewhere" : "unavailable";
  if (song.status === "queued" && song.queuedByZotify === false) return "others";
  if (song.status === "queued" || song.status === "cooldown") return "cooldown";
  return "available";
}

export interface SongItemProps {
  song: SearchResult;
  venueTitle: (id: string) => string;
  onRequest: () => void;
  onUpvote: () => void;
  // Left out where there's no queue to show, or venue to switch to, like a playlist's tracks
  onShowInQueue?: () => void;
  onSwitchVenue?: (id: string) => void;
  // Accessories after the song's status, like how requesting a whole playlist went
  accessories?: List.Item.Accessory[];
  common: React.ReactNode;
}

/** A search result. What ↵ does depends on where the song stands (see UX.md) */
export function SongItem({
  song,
  venueTitle,
  onRequest,
  onUpvote,
  onShowInQueue,
  onSwitchVenue,
  accessories = [],
  common,
}: SongItemProps) {
  const inRockbot = song.status === "queued" && !!song.pickId;
  const waiting = song.status === "queued" && !song.pickId;

  const tag = inRockbot
    ? { value: "In Queue", color: Color.Green }
    : waiting
      ? { value: "Waiting", color: Color.Yellow }
      : !song.requestable && song.availableAt
        ? { value: `At ${venueTitle(song.availableAt)}`, color: Color.Blue }
        : !song.requestable
          ? { value: "Unavailable", color: Color.Red }
          : song.status === "cooldown"
            ? { value: "Played Recently", color: Color.SecondaryText }
            : null;

  const primary = inRockbot ? (
    <Action title="Upvote" icon={Icon.ArrowUp} onAction={onUpvote} />
  ) : waiting ? (
    onShowInQueue && <Action title="Show in Queue" icon={Icon.List} onAction={onShowInQueue} />
  ) : song.requestable ? (
    <Action title="Request Song" icon={Icon.PlusCircle} onAction={onRequest} />
  ) : song.availableAt && onSwitchVenue ? (
    <Action
      title={`Switch to ${venueTitle(song.availableAt)}`}
      icon={Icon.Switch}
      onAction={() => onSwitchVenue(song.availableAt!)}
    />
  ) : null;

  return (
    <List.Item
      id={`song-${song.id}`}
      title={song.name}
      subtitle={song.artist}
      icon={cover(song.cover)}
      accessories={[...(tag ? [{ tag }] : []), ...accessories]}
      actions={
        <ActionPanel title={song.name}>
          {primary && <ActionPanel.Section>{primary}</ActionPanel.Section>}
          {common}
        </ActionPanel>
      }
    />
  );
}
