import { getPreferenceValues, launchCommand, LaunchType, OAuth } from "@raycast/api";
import { getAccessToken, OAuthService } from "@raycast/utils";

// Signing in to Zotify, and calling its API (docs.zotify.app). The queue command signs in with withAccessToken; the menu bar
// never does, since it runs in the background where a sign-in window would come out of nowhere (see savedToken)

export const API_URL = "https://api.zotify.app";
export const SITE_URL = "https://www.zotify.app";

// Zotify's public OAuth app for this extension, registered at www.zotify.app/developers with the redirect URI
// https://raycast.com/redirect?packageName=Extension. Client IDs aren't secret
export const CLIENT_ID = "zotify_app_314cdd2328d57a082f2a7ee0";

const preferences = getPreferenceValues<Preferences>();

export const client = new OAuth.PKCEClient({
  redirectMethod: OAuth.RedirectMethod.Web,
  providerName: "Zotify",
  providerIcon: "icon.png",
  description: "Connect your Zotify account to see the queue and request songs.",
});

export const zotifyAuth = new OAuthService({
  client,
  clientId: CLIENT_ID,
  scope: ["music:read", "music:write", ...(preferences.adminTools ? ["admin"] : [])].join(" "),
  authorizeUrl: `${SITE_URL}/oauth/authorize`,
  tokenUrl: `${API_URL}/v1/oauth/token`,
  bodyEncoding: "url-encoded",
  personalAccessToken: preferences.personalAccessToken || undefined,
});

/**
 * A token for the menu bar, without ever asking to sign in: the personal access token, or the saved OAuth token. An expired
 * one is only refreshed when refresh is true (opened by a click, not in the background). Null when there isn't one
 */
export async function savedToken(refresh: boolean): Promise<string | null> {
  if (preferences.personalAccessToken) return preferences.personalAccessToken;

  const tokens = await client.getTokens();
  if (!tokens?.accessToken) return null;
  if (!tokens.isExpired()) return tokens.accessToken;
  if (!refresh || !tokens.refreshToken) return null;

  // Done here rather than with zotifyAuth.authorize(), which opens the sign-in window when a refresh fails
  const response = await fetch(`${API_URL}/v1/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refreshToken,
    }),
  }).catch(() => null);

  if (!response?.ok) return null;
  const refreshed = (await response.json()) as OAuth.TokenResponse;
  await client.setTokens(refreshed);
  return refreshed.access_token;
}

/** An error from the API, with its status and code (like "not_approved") */
export class ZotifyError extends Error {
  status: number;
  code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ZotifyError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Calls the API. token defaults to the signed-in one, inside withAccessToken; pass a token, or null for public routes.
 * Throws a ZotifyError with the API's own message when it answers with an error
 */
export async function zotify<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = options.token === undefined ? getAccessToken().token : options.token;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ZotifyError("Couldn't reach Zotify. Check your connection.", 0);
  }

  if (response.status === 204) return undefined as T;

  const data = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!response.ok)
    throw new ZotifyError(data?.error ?? `Zotify answered ${response.status}`, response.status, data?.code);
  return data as T;
}

/** Tells the menu bar to fetch the queue again, after something changed it. Fine if it isn't turned on */
export function refreshMenuBar() {
  launchCommand({ name: "now-playing", type: LaunchType.Background }).catch(() => {});
}

// What the API answers with (see the reference at docs.zotify.app/reference)

export interface Venue {
  id: string;
  name: string;
}

export interface School {
  id: string;
  name: string;
  shortName: string;
  url: string;
  venues: Venue[];
}

export interface Me {
  email: string;
  // What this token may do; null for sessions
  scopes: string[] | null;
  schools: { id: string; name: string; admin: boolean; approved: boolean }[];
}

export interface QueueEntry {
  pickId: string;
  songId?: string;
  name: string;
  artist: string;
  cover?: string;
  upvotes?: number;
  downvotes?: number;
  zotify: boolean;
}

export interface VenueQueue {
  nowPlaying: (QueueEntry & { duration?: number; secondsRemaining?: number }) | null;
  onDeck: QueueEntry[];
  comingUp: QueueEntry[];
}

export interface SearchResult {
  id: string;
  name: string;
  artist: string;
  cover?: string;
  requestable: boolean;
  availableAt: string | null;
  pickId: string | null;
  // When it's in Rockbot's queue, whether Zotify requested it
  queuedByZotify: boolean | null;
  status: "queued" | "cooldown" | null;
}

export interface ZotifySong {
  id: number;
  songId: string;
  name: string;
  artist: string;
  cover?: string;
  requestedAt: number;
  mine: boolean;
}

export interface ZotifyQueue {
  waiting: ZotifySong[];
  failures: (ZotifySong & { failedAt: number; attempts: number; error: string | null })[];
}

export interface DownvoteCheck {
  allowed: boolean;
  reason: string | null;
  karma: number | null;
  overridable: boolean;
  // The most accounts that can downvote
  count: number;
}

export interface PickVotes {
  up: { total: number; voted: number; available: number };
  down: DownvoteCheck | null;
}

export interface VoteResult {
  requested: number;
  confirmed: number | null;
}

/**
 * A venue's Rockbot queue, from the public route, with when it was fetched for counting down the playing song. closed is
 * the reason when the venue isn't taking requests
 */
export async function getVenueQueue(venue: string) {
  try {
    const queue = await zotify<VenueQueue>(`/v1/venues/${venue}/queue`, { token: null });
    return { queue, closed: null, fetchedAt: Date.now() };
  } catch (error) {
    if (error instanceof ZotifyError && error.code === "venue_unavailable")
      return { queue: null, closed: error.message, fetchedAt: Date.now() };
    throw error;
  }
}

export interface Playlist {
  id: string;
  name: string;
  owner?: string;
  // Spotify only shows the first 100 tracks
  mayBeTruncated: boolean;
  tracks: { title: string; artist: string; uri?: string }[];
}

export type TrackOutcome =
  | "waiting"
  | "working"
  | "queued"
  | "not-found"
  | "unavailable"
  | "already-queued"
  | "played-recently"
  | "duplicate"
  | "failed";

/** Requesting a whole playlist at a venue, which the server works through in the background */
export interface PlaylistJob {
  finishedAt: number | null;
  stoppedEarly: string | null;
  // Every track in playlist order, and what happened to it
  tracks: { title: string; artist: string; outcome: TrackOutcome; error?: string }[];
}

/** A Spotify track or playlist link (or spotify: URI) in some text, like the search bar. Null for anything else */
export function spotifyLink(text: string): { kind: "track" | "playlist"; url: string } | null {
  const match = text
    .trim()
    .match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?|spotify:)(track|playlist)[/:]([A-Za-z0-9]{22})/i);
  return match ? { kind: match[1].toLowerCase() as "track" | "playlist", url: text.trim() } : null;
}

/** A Spotify URI like spotify:track:… as a link to open */
export const spotifyUrl = (uri: string) => `https://open.spotify.com/${uri.split(":").slice(1).join("/")}`;

export const getSchools = () => zotify<School[]>("/v1/schools", { token: null });

/** "Song by Artist" */
export const songName = (song: { name: string; artist: string }) =>
  song.artist ? `${song.name} by ${song.artist}` : song.name;

/** 95 → "1:35" */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
