import { ImageResponse } from "next/og";
import { SCHOOL_HEADER } from "@/lib/currentSchool";
import { listOf } from "@/lib/format";
import type { SchoolInfo } from "@/lib/school";

// The link preview image (1200 × 630) for a school's Zotify: the logo, the school, its venues and tagline. The school comes
// from proxy.ts like every page's, so uf.zotify.app gets UF's. Linked from the metadata in app/layout.tsx

const SIZE = { width: 1200, height: 630 };

// The colours in app/globals.css
const GOLD = "#fecc07";
const NAVY = "#002244";
const MUTED = "#c6beb5";

export async function GET(request: Request) {
    const raw = request.headers.get(SCHOOL_HEADER);
    const school: SchoolInfo | null = raw ? JSON.parse(decodeURIComponent(raw)) : null;
    const venues = listOf(school?.venues.map(venue => venue.name) ?? []);

    return new ImageResponse(
        (
            <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: NAVY, color: "white" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
                    {/* The app icon, as in app/icon.svg */}
                    <svg width="136" height="136" viewBox="0 0 512 512">
                        <rect width="512" height="512" rx="128" fill={GOLD} />
                        <g fill={NAVY}>
                            <rect x="112" y="208" width="32" height="96" rx="16" />
                            <rect x="176" y="160" width="32" height="192" rx="16" />
                            <rect x="240" y="128" width="32" height="256" rx="16" />
                            <rect x="304" y="192" width="32" height="128" rx="16" />
                            <rect x="368" y="224" width="32" height="64" rx="16" />
                        </g>
                    </svg>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1 }}>Zotify</div>
                        {school && <div style={{ fontSize: 44, color: GOLD, marginTop: 12 }}>{school.name}</div>}
                    </div>
                </div>
                <div style={{ fontSize: 40, marginTop: 64 }}>{school?.tagline ?? "Pick the soundtrack."}</div>
                {/* One string: the image renderer wants a flex box around anything with several pieces */}
                {venues && <div style={{ fontSize: 32, color: MUTED, marginTop: 16 }}>{`Search and queue songs at ${venues}`}</div>}
            </div>
        ),
        { ...SIZE, headers: { "Cache-Control": "public, max-age=3600" } }
    );
}
