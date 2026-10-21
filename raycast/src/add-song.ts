import { launchCommand, LaunchType, type LaunchProps } from "@raycast/api";

// Add Song to Zotify: a shortcut into Zotify Queue's search. Type "Add Song", Tab, a song, ↵, and Zotify Queue opens with the
// results, so there's one search screen to learn rather than two

export default async function AddSong({ arguments: { query } }: LaunchProps<{ arguments: Arguments.AddSong }>) {
  await launchCommand({ name: "queue", type: LaunchType.UserInitiated, context: { searchText: query?.trim() ?? "" } });
}
