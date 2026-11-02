// Venue names and short emails depend on the school, so they're in lib/school.tsx

// "A", "A and B", or "A, B and C"
export const listOf = (names: string[]) => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function timeAgo(timestamp: number) {
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min ago`;
}

/** How long ago, in the biggest whole unit: "just now", "5 minutes ago", "1 day ago", "3 months ago" */
export function relativeTime(timestamp: number) {
    const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";

    const units: [string, number][] = [["year", 365 * 86400], ["month", 30 * 86400], ["week", 7 * 86400], ["day", 86400], ["hour", 3600], ["minute", 60]];
    const [unit, size] = units.find(([, size]) => seconds >= size)!;
    return `${plural(Math.floor(seconds / size), unit)} ago`;
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
