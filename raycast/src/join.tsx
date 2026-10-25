import { Action, ActionPanel, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { withToast } from "./actions";
import { zotify, type School } from "./zotify";

// Joining a school's Zotify during its private beta, without leaving Raycast: asking to join, or using an invite code. Shown
// by Zotify Queue in place of the queue's search when someone isn't in the venue's school's Zotify yet

type Request = { status: "pending" | "approved" | "rejected"; requestedAt: number } | null;

/** The empty view for someone who isn't in the school's Zotify: where their request stands, and how to get in */
export function JoinView({ school, request, onJoined }: { school: School; request: Request; onJoined: () => void }) {
  const pending = request?.status === "pending";
  const rejected = request?.status === "rejected";

  return (
    <List.EmptyView
      icon={pending ? Icon.Clock : Icon.Lock}
      title={pending ? "Your request to join is waiting" : `You're not in ${school.shortName}'s Zotify yet`}
      description={
        pending
          ? `You asked ${new Date(request.requestedAt).toLocaleDateString()}. You'll get an email when you're in, or use an invite code if you have one.`
          : rejected
            ? "Your request wasn't approved, but an invite code still works."
            : "It's in private beta. Ask to join, or use an invite code if you have one."
      }
      actions={
        <ActionPanel>
          {!request && (
            <Action
              title="Request to Join"
              icon={Icon.AddPerson}
              onAction={() =>
                withToast(
                  { working: "Asking to join…", failed: "Couldn't ask to join" },
                  () => zotify(`/v1/schools/${school.id}/join-request`, { method: "POST", body: {} }),
                  () => {
                    onJoined();
                    return { title: "Asked to join", message: "You'll get an email when you're in" };
                  },
                )
              }
            />
          )}
          <Action.Push
            title="Use an Invite Code…"
            icon={Icon.Ticket}
            shortcut={{ modifiers: ["cmd"], key: "i" }}
            target={<InviteCodeForm school={school} onJoined={onJoined} />}
          />
          <Action.OpenInBrowser title="Open Zotify" url={school.url} />
        </ActionPanel>
      }
    />
  );
}

function InviteCodeForm({ school, onJoined }: { school: School; onJoined: () => void }) {
  const { pop } = useNavigation();
  const [error, setError] = useState<string | undefined>();

  return (
    <Form
      navigationTitle="Invite Code"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Join"
            icon={Icon.Ticket}
            onSubmit={async ({ code }: { code: string }) => {
              if (!code.trim()) return setError("Enter the code");

              const toast = await showToast({ style: Toast.Style.Animated, title: "Joining…" });
              try {
                await zotify(`/v1/schools/${school.id}/invite-codes/redeem`, {
                  method: "POST",
                  body: { code: code.trim() },
                });
                Object.assign(toast, { style: Toast.Style.Success, title: `You're in ${school.shortName}'s Zotify` });
                onJoined();
                pop();
              } catch (err) {
                toast.hide();
                setError((err as Error).message);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={`An invite code lets you into ${school.shortName}'s Zotify straight away.`} />
      <Form.TextField
        id="code"
        title="Invite Code"
        placeholder="ABCD2345"
        error={error}
        onChange={() => setError(undefined)}
      />
    </Form>
  );
}
