import { Action, ActionPanel, Alert, confirmAlert, Icon, Keyboard, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import DownvoteForm from "./downvote-form";
import {
  refreshMenuBar,
  songName,
  zotify,
  type PickVotes,
  type QueueEntry,
  type School,
  type Venue,
  type VoteResult,
  type ZotifySong,
} from "./zotify";

// Everything you can do to a song, as actions for the queue's action panels. Each shows an animated toast while it works,
// then turns it into success or the API's own error. The menu bar is told to refresh after anything that changes the queue

/**
 * Runs task under an animated toast titled working, then shows success (from done) or failed with the API's error.
 * Returns whether it worked
 */
export async function withToast<T>(
  titles: { working: string; failed: string },
  task: () => Promise<T>,
  done: (result: T) => Toast.Options,
) {
  const toast = await showToast({ style: Toast.Style.Animated, title: titles.working });

  try {
    const result = await task();
    Object.assign(toast, { message: undefined, ...done(result), style: Toast.Style.Success });
    refreshMenuBar();
    return true;
  } catch (error) {
    Object.assign(toast, { style: Toast.Style.Failure, title: titles.failed, message: (error as Error).message });
    return false;
  }
}

const accounts = (count: number) => `${count} ${count === 1 ? "account" : "accounts"}`;

/** "Upvoted with 6 accounts", or what went wrong */
function votedToast(result: VoteResult, direction: "Upvoted" | "Downvoted"): Toast.Options {
  if (!result.requested) return { title: "Every account has already voted" };
  return {
    title: `${direction} with ${accounts(result.confirmed ?? result.requested)}`,
    message:
      result.confirmed !== null && result.confirmed < result.requested
        ? `${result.requested - result.confirmed} didn't go through`
        : undefined,
  };
}

export function vote(
  venue: Venue,
  entry: Pick<QueueEntry, "pickId" | "name" | "artist">,
  count?: number,
  songId?: string,
) {
  return withToast(
    { working: `Upvoting ${entry.name}…`, failed: `Couldn't upvote ${entry.name}` },
    () =>
      zotify<VoteResult>(`/v1/venues/${venue.id}/picks/${entry.pickId}/votes`, {
        method: "POST",
        body: { count, songId },
      }),
    (result) => votedToast(result, "Upvoted"),
  );
}

export function requestSong(venue: Venue, song: { id: string; name: string; artist: string }) {
  return withToast(
    { working: `Requesting ${song.name}…`, failed: `Couldn't request ${song.name}` },
    () =>
      zotify<{ position: number; alreadyWaiting: boolean }>(`/v1/venues/${venue.id}/requests`, {
        method: "POST",
        body: { songId: song.id },
      }),
    (result) => ({
      title: result.alreadyWaiting ? `${song.name} was already waiting` : `Requested ${song.name}`,
      message: `#${result.position} in Zotify's queue at ${venue.name}`,
      // Takes it back out, as long as it's still waiting in Zotify's queue
      primaryAction: result.alreadyWaiting
        ? undefined
        : {
            title: "Undo",
            shortcut: { modifiers: ["cmd"], key: "z" },
            onAction: (toast) => undoRequest(venue, song, toast),
          },
    }),
  );
}

/** Takes a song you just requested back out of Zotify's queue, if it hasn't moved into Rockbot's yet */
async function undoRequest(venue: Venue, song: { id: string; name: string }, toast: Toast) {
  Object.assign(toast, {
    style: Toast.Style.Animated,
    title: `Taking ${song.name} back out…`,
    message: undefined,
    primaryAction: undefined,
  });

  try {
    const { waiting } = await zotify<{ waiting: ZotifySong[] }>(`/v1/venues/${venue.id}/zotify-queue`);
    const entry = waiting.find((candidate) => candidate.songId === song.id && candidate.mine);
    if (!entry) throw new Error("It's already in Rockbot's queue");

    await zotify(`/v1/venues/${venue.id}/zotify-queue/${entry.id}`, { method: "DELETE" });
    Object.assign(toast, { style: Toast.Style.Success, title: `Took ${song.name} back out` });
    refreshMenuBar();
  } catch (error) {
    Object.assign(toast, {
      style: Toast.Style.Failure,
      title: `Couldn't undo ${song.name}`,
      message: (error as Error).message,
    });
  }
}

/** Upvote with every account that hasn't voted yet */
export function UpvoteAction({
  venue,
  entry,
  songId,
  onDone,
}: {
  venue: Venue;
  entry: QueueEntry;
  songId?: string;
  onDone: () => void;
}) {
  return (
    <Action
      title="Upvote"
      icon={Icon.ArrowUp}
      onAction={async () => {
        await vote(venue, entry, undefined, songId);
        onDone();
      }}
    />
  );
}

/** Loads how many accounts can still vote on a pick when a submenu opens */
function usePickVotes(venue: Venue, pickId: string) {
  const [votes, setVotes] = useState<PickVotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      setVotes(await zotify<PickVotes>(`/v1/venues/${venue.id}/picks/${pickId}/votes`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }

  return { votes, error, isLoading, load };
}

/** Counts from all of them down to 1, for picking how many accounts vote */
const counts = (most: number) => Array.from({ length: most }, (_, i) => most - i);

/** Picks how many accounts upvote. Choosing a number is the confirmation, like the website's vote dialog */
export function UpvoteWithSubmenu({ venue, entry, onDone }: { venue: Venue; entry: QueueEntry; onDone: () => void }) {
  const { votes, error, isLoading, load } = usePickVotes(venue, entry.pickId);
  const available = votes?.up.available ?? 0;

  return (
    <ActionPanel.Submenu
      title="Upvote with…"
      icon={Icon.ArrowUp}
      shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
      isLoading={isLoading}
      onOpen={load}
    >
      {error && <Action title={error} icon={Icon.Warning} />}
      {votes && !available && <Action title="Every Account Has Voted" icon={Icon.CheckCircle} />}
      {counts(available).map((count) => (
        <Action
          key={count}
          title={count === available ? `All ${accounts(count)}` : accounts(count)}
          icon={Icon.ArrowUp}
          onAction={async () => {
            await vote(venue, entry, count);
            onDone();
          }}
        />
      ))}
    </ActionPanel.Submenu>
  );
}

export async function downvote(venue: Venue, entry: QueueEntry, count: number, overrideReason?: string) {
  const confirmed = await confirmAlert({
    title: `Downvote ${entry.name}?`,
    message: `With ${accounts(count)}. Downvotes push a song down the queue, and enough of them take it out.`,
    icon: Icon.ArrowDown,
    primaryAction: { title: "Downvote", style: Alert.ActionStyle.Destructive },
  });
  if (!confirmed) return false;

  return withToast(
    { working: `Downvoting ${entry.name}…`, failed: `Couldn't downvote ${entry.name}` },
    () =>
      zotify<VoteResult>(`/v1/venues/${venue.id}/picks/${entry.pickId}/votes`, {
        method: "POST",
        body: { direction: "down", count, overrideReason },
      }),
    (result) => votedToast(result, "Downvoted"),
  );
}

/**
 * For admins: Zotify's downvote rules, loaded when it opens. Lists counts when they allow it, the override form when karma
 * protection is all that's in the way, and the reason when they don't
 */
export function DownvoteWithSubmenu({ venue, entry, onDone }: { venue: Venue; entry: QueueEntry; onDone: () => void }) {
  const { votes, error, isLoading, load } = usePickVotes(venue, entry.pickId);
  const check = votes?.down;

  return (
    <ActionPanel.Submenu
      title="Downvote with…"
      icon={Icon.ArrowDown}
      shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
      isLoading={isLoading}
      onOpen={load}
    >
      {error && <Action title={error} icon={Icon.Warning} />}
      {votes && !check && <Action title="Only Admins Can Downvote" icon={Icon.Lock} />}
      {check?.allowed &&
        counts(check.count).map((count) => (
          <Action
            key={count}
            title={count === check.count ? `All ${accounts(count)}` : accounts(count)}
            icon={Icon.ArrowDown}
            style={Action.Style.Destructive}
            onAction={async () => {
              if (await downvote(venue, entry, count)) onDone();
            }}
          />
        ))}
      {check && !check.allowed && (
        <Action title={check.reason ?? "Zotify's rules don't allow it"} icon={Icon.XMarkCircle} />
      )}
      {check && !check.allowed && check.overridable && (
        <Action.Push
          title="Override Karma Protection…"
          icon={Icon.Exclamationmark}
          target={<DownvoteForm venue={venue} entry={entry} most={check.count} karma={check.karma} onDone={onDone} />}
        />
      )}
    </ActionPanel.Submenu>
  );
}

/** Takes a waiting song out of Zotify's queue, after asking */
export function RemoveAction({
  venue,
  song,
  mine,
  onRemove,
}: {
  venue: Venue;
  song: ZotifySong;
  mine: boolean;
  onRemove: (task: Promise<unknown>) => Promise<unknown>;
}) {
  return (
    <Action
      title="Remove from Queue"
      icon={Icon.Trash}
      style={Action.Style.Destructive}
      shortcut={Keyboard.Shortcut.Common.Remove}
      onAction={async () => {
        const confirmed = await confirmAlert({
          title: `Remove ${song.name}?`,
          message: mine
            ? "It won't be requested. You can always request it again."
            : "Someone else requested it. It won't be requested.",
          primaryAction: { title: "Remove", style: Alert.ActionStyle.Destructive },
        });
        if (!confirmed) return;

        await withToast(
          { working: `Removing ${song.name}…`, failed: `Couldn't remove ${song.name}` },
          () => onRemove(zotify(`/v1/venues/${venue.id}/zotify-queue/${song.id}`, { method: "DELETE" })),
          () => ({ title: `Removed ${song.name}` }),
        );
      }}
    />
  );
}

/** For admins: move a waiting song up or down, and clear the whole queue */
export function AdminQueueActions({
  venue,
  waiting,
  index,
  onChange,
}: {
  venue: Venue;
  waiting: ZotifySong[];
  index: number;
  onChange: (task: Promise<unknown>, order: ZotifySong[] | null) => Promise<unknown>;
}) {
  const move = (by: number) => {
    const order = [...waiting];
    const [song] = order.splice(index, 1);
    order.splice(index + by, 0, song);

    return withToast(
      { working: `Moving ${song.name}…`, failed: `Couldn't move ${song.name}` },
      () =>
        onChange(
          zotify(`/v1/venues/${venue.id}/zotify-queue/order`, {
            method: "PUT",
            body: { ids: order.map((entry) => entry.id) },
          }),
          order,
        ),
      () => ({ title: `Moved ${song.name} to #${index + by + 1}` }),
    );
  };

  return (
    <ActionPanel.Section title="Admin">
      {index > 0 && (
        <Action
          title="Move Up"
          icon={Icon.ArrowUp}
          shortcut={Keyboard.Shortcut.Common.MoveUp}
          onAction={() => move(-1)}
        />
      )}
      {index < waiting.length - 1 && (
        <Action
          title="Move Down"
          icon={Icon.ArrowDown}
          shortcut={Keyboard.Shortcut.Common.MoveDown}
          onAction={() => move(1)}
        />
      )}
      <Action
        title="Clear Zotify's Queue"
        icon={Icon.XMarkCircle}
        style={Action.Style.Destructive}
        shortcut={Keyboard.Shortcut.Common.RemoveAll}
        onAction={async () => {
          const confirmed = await confirmAlert({
            title: "Clear Zotify's queue?",
            message: `Takes all ${waiting.length} waiting songs out at ${venue.name}. Songs already in Rockbot's queue stay.`,
            primaryAction: { title: "Clear", style: Alert.ActionStyle.Destructive },
          });
          if (!confirmed) return;

          await withToast(
            { working: "Clearing Zotify's queue…", failed: "Couldn't clear Zotify's queue" },
            () =>
              onChange(zotify<{ removed: number }>(`/v1/venues/${venue.id}/zotify-queue`, { method: "DELETE" }), []),
            () => ({ title: "Cleared Zotify's queue" }),
          );
        }}
      />
    </ActionPanel.Section>
  );
}

/** Search the artist, copy, refresh and open the website: at the bottom of every action panel */
export function CommonActions({
  song,
  school,
  onRefresh,
  onSearchArtist,
}: {
  song?: { name: string; artist: string };
  school?: School;
  onRefresh: () => void;
  // Searches for the song's artist, like clicking an artist on the website
  onSearchArtist?: (artist: string) => void;
}) {
  return (
    <ActionPanel.Section>
      {song?.artist && onSearchArtist && (
        <Action
          title="Search Artist"
          icon={Icon.MagnifyingGlass}
          shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
          onAction={() => onSearchArtist(song.artist)}
        />
      )}
      {song && (
        <Action.CopyToClipboard
          title="Copy Song Name"
          content={songName(song)}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
      )}
      <Action
        title="Refresh"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={onRefresh}
      />
      {school && <Action.OpenInBrowser title="Open Zotify" url={school.url} shortcut={Keyboard.Shortcut.Common.Open} />}
    </ActionPanel.Section>
  );
}
