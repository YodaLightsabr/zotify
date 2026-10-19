import type { Venue } from "./api";

export const VENUES: [Venue, string][] = [["anteatery", "Anteatery"], ["brandywine", "Brandywine"]];
export const VENUE_LABELS: Record<Venue, string> = { anteatery: "Anteatery", brandywine: "Brandywine" };
export const otherVenue = (venue: Venue): Venue => venue === "anteatery" ? "brandywine" : "anteatery";

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** UCI accounts show just their UCInetID; other email addresses show in full */
export const shortEmail = (email: string) => email.replace(/@uci\.edu$/i, "");

export function timeAgo(timestamp: number) {
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min ago`;
}

export function formatTime(seconds: number) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const voteSummary = (votes: { requested: number, confirmed: number | null }) => votes.confirmed === null
    ? `${plural(votes.requested, "vote")} sent (couldn't confirm them)`
    : `${votes.confirmed} of ${votes.requested} votes confirmed`;

/** Joins the class names that are set */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
