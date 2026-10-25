import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { useState } from "react";
import { downvote } from "./actions";
import type { QueueEntry, Venue } from "./zotify";

// For admins: downvoting a song that Zotify's karma protection would otherwise stop, with a reason that's recorded.
// Pushed from Downvote with… in the queue's action panel

interface Props {
  venue: Venue;
  entry: QueueEntry;
  // The most accounts that can downvote
  most: number;
  karma: number | null;
  onDone: () => void;
}

export default function DownvoteForm({ venue, entry, most, karma, onDone }: Props) {
  const { pop } = useNavigation();
  const [reasonError, setReasonError] = useState<string | undefined>();

  return (
    <Form
      navigationTitle={`Downvote ${entry.name}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Downvote"
            icon={Icon.ArrowDown}
            style={Action.Style.Destructive}
            onSubmit={async (values: { count: string; reason: string }) => {
              const reason = values.reason.trim();
              if (reason.length < 3 || reason.length > 200)
                return setReasonError("Give a reason of 3 to 200 characters");

              if (await downvote(venue, entry, Number(values.count), reason)) {
                onDone();
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Karma Protection"
        text={`${entry.name} has ${karma === null ? "positive" : `+${karma}`} karma, so people want it. Override only for a good reason; it's recorded.`}
      />
      <Form.Dropdown
        id="count"
        title="Accounts"
        defaultValue="1"
        info="Start with as few as will do; you can add more later."
      >
        {Array.from({ length: most }, (_, i) => i + 1).map((count) => (
          <Form.Dropdown.Item
            key={count}
            value={String(count)}
            title={count === most && count > 1 ? `All ${count} Left` : String(count)}
          />
        ))}
      </Form.Dropdown>
      <Form.TextArea
        id="reason"
        title="Reason"
        placeholder="Why it's worth overriding"
        error={reasonError}
        onChange={() => setReasonError(undefined)}
      />
    </Form>
  );
}
