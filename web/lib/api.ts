import { API_URL } from "./config";

export type Venue = "anteatery" | "brandywine";

/** Where to send people who need to sign in, or who are signed in but not approved yet */
export function goToLogin(next = currentPath(), notApproved = false) {
    location.assign(`${notApproved ? "/beta" : "/login"}?${new URLSearchParams({ next })}`);
}

const currentPath = () => location.pathname + location.search;

/**
 * Calls the API with the session cookie. App routes answering 401 (session ended) or 403 "not approved" send people to sign in
 * or to the beta screen, like the old pages did; auth and admin routes are left for the caller to handle
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
    const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include" });
    const handlesItself = path.startsWith("/api/auth/") || path.startsWith("/api/admin/") || path.startsWith("/api/beta/");

    if (!handlesItself && response.status === 401) goToLogin();
    if (!handlesItself && response.status === 403 && (await response.clone().json().catch(() => null))?.notApproved) goToLogin(currentPath(), true);

    return response;
}

/** GET with query parameters. Returns the response and its JSON (or null) */
export async function getJson<T = any>(path: string, params?: Record<string, string>) {
    const response = await apiFetch(params ? `${path}?${new URLSearchParams(params)}` : path);
    return { response, data: (await response.json().catch(() => null)) as T };
}

export async function postJson<T = any>(path: string, body: unknown) {
    const response = await apiFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    return { response, data: (await response.json().catch(() => null)) as T };
}

/** Only send people on to a page on this site */
export function safeNext(value: string | null) {
    return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
