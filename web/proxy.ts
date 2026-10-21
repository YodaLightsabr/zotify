import { NextResponse, type NextRequest } from "next/server";
import { DOCS_HOST, DOCS_URL, INTERNAL_API_URL, MAIN_HOST, MAIN_URL, MEALS_HOST, MEALS_URL, SITE_DOMAIN, SPACES_HOST, SPACES_URL } from "./lib/config";
import { SCHOOL_HEADER } from "./lib/currentSchool";
import type { SchoolInfo } from "./lib/school";

// Every *.zotify.app address comes to this server. This works out which school's Zotify a request is for from its host:
// www.zotify.app is the main school, a configured subdomain like uf.zotify.app is that school, and zotify.app itself and any
// other subdomain are sent to www.zotify.app. The school is handed to the pages in a request header, so they render as that school from the start.
// meals.zotify.app is Zotify Meals, the main school's, served from the pages under app/meals; spaces.zotify.app is Zotify
// Spaces, from app/spaces; and docs.zotify.app is the API's docs, from app/docs

// How long the list of schools is reused before asking the API again
const SCHOOLS_TTL_MS = 30_000;

let schools: { list: SchoolInfo[], fetchedAt: number } | null = null;

async function getSchools() {
    if (schools && Date.now() - schools.fetchedAt < SCHOOLS_TTL_MS) return schools.list;

    try {
        const response = await fetch(`${INTERNAL_API_URL}/v1/schools`, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`The API answered ${response.status}`);
        schools = { list: await response.json(), fetchedAt: Date.now() };
    } catch (error) {
        // Keep using the last list if the API is briefly unreachable, like during a deploy
        if (!schools) throw error;
        console.error("Couldn't refresh the list of schools:", error);
    }

    return schools.list;
}

export async function proxy(request: NextRequest) {
    const host = (request.headers.get("host") ?? "").toLowerCase();
    let list: SchoolInfo[];

    try {
        list = await getSchools();
    } catch (error) {
        console.error("Couldn't load the list of schools:", error);
        return new NextResponse("Zotify is starting up. Try again in a moment.", { status: 503, headers: { "Retry-After": "5" } });
    }

    const main = list.find(school => !school.subdomain);
    let school: SchoolInfo | undefined = main;
    const { pathname, search } = request.nextUrl;
    const headers = new Headers(request.headers);

    // Zotify Meals: meals.zotify.app/favorites is app/meals/favorites. The link preview image is shared
    if (host === MEALS_HOST && main) {
        headers.set(SCHOOL_HEADER, encodeURIComponent(JSON.stringify(main)));
        if (pathname === "/og" || pathname.startsWith("/meals")) return NextResponse.next({ request: { headers } });
        return NextResponse.rewrite(new URL(`/meals${pathname === "/" ? "" : pathname}${search}`, request.url), { request: { headers } });
    }

    // The API's docs and Zotify Spaces, the same way: docs.zotify.app/authentication is app/docs/authentication
    for (const [subsite, subsiteHost] of [["docs", DOCS_HOST], ["spaces", SPACES_HOST]]) {
        if (host !== subsiteHost || !main) continue;
        headers.set(SCHOOL_HEADER, encodeURIComponent(JSON.stringify(main)));
        if (pathname === "/og" || pathname.startsWith(`/${subsite}`)) return NextResponse.next({ request: { headers } });
        return NextResponse.rewrite(new URL(`/${subsite}${pathname === "/" ? "" : pathname}${search}`, request.url), { request: { headers } });
    }

    // Zotify Meals, Zotify Spaces and the docs live at their own addresses
    for (const [subsite, url] of [["meals", MEALS_URL], ["spaces", SPACES_URL], ["docs", DOCS_URL]]) {
        if (pathname === `/${subsite}` || pathname.startsWith(`/${subsite}/`)) {
            return NextResponse.redirect(`${url}${pathname.slice(subsite.length + 1) || "/"}${search}`);
        }
    }

    // zotify.app itself goes to www, keeping the path (in development, the main school is at localhost itself)
    if (host === SITE_DOMAIN && host !== MAIN_HOST) return NextResponse.redirect(`${MAIN_URL}${pathname}${search}`);

    if (host !== MAIN_HOST && host.endsWith(`.${SITE_DOMAIN}`)) {
        const subdomain = host.slice(0, -SITE_DOMAIN.length - 1);
        school = list.find(candidate => candidate.subdomain === subdomain);

        // Not a school's subdomain, like a typo
        if (!school) return NextResponse.redirect(`${MAIN_URL}/`);
    }

    // Any other host (www.zotify.app, or the server's own address) is the main school
    if (!school) return new NextResponse("No school is set up yet.", { status: 503 });

    headers.set(SCHOOL_HEADER, encodeURIComponent(JSON.stringify(school)));
    return NextResponse.next({ request: { headers } });
}

export const config = {
    // Pages only, not Next.js's own files or the icons
    matcher: ["/((?!_next/|icons/|icon\\.svg|apple-icon|manifest\\.webmanifest|sw\\.js|offline\\.html|favicon).*)"]
};
