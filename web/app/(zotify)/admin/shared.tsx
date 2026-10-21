"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, goToLogin, postJson } from "@/lib/api";
import { cx } from "@/lib/format";

// Pieces the admin dashboard's sections share

export const when = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** GET an admin route, throwing its error. A 401 means the session ended, so sign in again */
export async function adminGet<T>(path: string, what: string) {
    const { response, data } = await getJson<T>(path);
    if (response.status === 401) goToLogin("/admin");
    if (!response.ok) throw new Error(`Couldn't load ${what} (${response.status})`);
    return data;
}

/** POST an admin route, throwing its error */
export async function adminPost<T = any>(path: string, body: unknown) {
    const { response, data } = await postJson<T>(path, body);
    if (!response.ok) throw new Error((data as any)?.error ?? `Request failed (${response.status})`);
    return data;
}

/** Loads something on mount and whenever reload() is called. Keeps showing the last value while reloading */
export function useLoad<T>(load: () => Promise<T>) {
    const [state, setState] = useState<{ data?: T, error?: string }>({});

    const reload = useCallback(async () => {
        try {
            setState({ data: await load() });
        } catch (error) {
            setState({ error: (error as Error).message });
        }
    }, [load]);

    useEffect(() => { reload(); }, [reload]);
    return { ...state, reload };
}

export const Loading = ({ error }: { error?: string }) => error ? <span className="error">{error}</span> : <span className="muted">Loading…</span>;

export const Rows = ({ children }: { children: React.ReactNode[] }) => children.length ? <div className="rows">{children}</div> : <p className="muted">None</p>;

/** A small button that disables itself while its action runs, and shows any error */
export function SmallButton({ label, className, onClick }: { label: string, className?: string, onClick: () => Promise<unknown> }) {
    const [busy, setBusy] = useState(false);

    return (
        <button type="button" className={cx("small", className)} disabled={busy} onClick={async () => {
            setBusy(true);
            try {
                await onClick();
            } catch (error) {
                if ((error as Error).message !== "Cancelled") alert((error as Error).message);
            } finally {
                setBusy(false);
            }
        }}>{label}</button>
    );
}

export function FormMessage({ message }: { message: { text: string, error?: boolean } }) {
    return <p className={cx("form-message", message.error && "error")} role="status">{message.text}</p>;
}
