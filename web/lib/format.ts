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

export function formatTime(seconds: number) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const voteSummary = (votes: { requested: number, confirmed: number | null }) => votes.confirmed === null
    ? `${plural(votes.requested, "vote")} sent (couldn't confirm them)`
    : `${votes.confirmed} of ${votes.requested} votes confirmed`;

/** Joins the class names that are set */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
