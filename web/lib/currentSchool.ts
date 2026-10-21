import { headers } from "next/headers";
import type { SchoolInfo } from "./school";

// The header proxy.ts uses to hand the school to the pages
export const SCHOOL_HEADER = "x-zotify-school";

/** For server components: the school this request is for, as worked out by proxy.ts */
export async function currentSchool(): Promise<SchoolInfo> {
    const raw = (await headers()).get(SCHOOL_HEADER);
    if (!raw) throw new Error("No school for this request; is proxy.ts running?");
    return JSON.parse(decodeURIComponent(raw));
}
