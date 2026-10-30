"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import { useLibrary } from "@/lib/library";

/** A heart that saves a Rockbot song to your Library, or takes it out. Nothing for people without a Library */
export default function SaveButton({ song }: { song: { id: string, name: string } }) {
    const { saved, setSaved } = useLibrary();
    const [busy, setBusy] = useState(false);

    if (!saved) return null;
    const isSaved = saved.has(song.id);

    async function toggle() {
        setBusy(true);

        try {
            await setSaved(song.id, !isSaved);
        } catch (error) {
            alert((error as Error).message);
        } finally {
            setBusy(false);
        }
    }

    const label = isSaved ? `Remove ${song.name} from your Library` : `Save ${song.name} to your Library`;

    return (
        <button type="button" className={cx("row-icon save", isSaved && "saved")} title={isSaved ? "In your Library" : "Save to your Library"}
            aria-label={label} aria-pressed={isSaved} disabled={busy} onClick={toggle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
            </svg>
        </button>
    );
}
