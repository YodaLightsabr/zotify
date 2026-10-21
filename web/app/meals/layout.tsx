import type { Metadata } from "next";
import MealsHeader from "@/components/meals/MealsHeader";
import { currentSchool } from "@/lib/currentSchool";
import { listOf } from "@/lib/format";
import "./meals.css";

export async function generateMetadata(): Promise<Metadata> {
    const school = await currentSchool();
    const halls = listOf(school.venues.map(venue => venue.name));
    const description = `What's on at ${school.shortName}'s ${halls}: every meal, counter and dish, with allergens and nutrition.`;

    return {
        // absolute, so the root layout's "· Zotify" isn't added
        title: { absolute: "Zotify Meals", template: "%s · Zotify Meals" },
        description,
        openGraph: { type: "website", siteName: "Zotify Meals", title: "Zotify Meals", description, url: "/" },
        twitter: { card: "summary_large_image", title: "Zotify Meals", description }
    };
}

/** Zotify Meals (meals.zotify.app; see proxy.ts): its own header instead of Zotify's navbar */
export default function MealsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="meals">
            <MealsHeader />
            {children}
        </div>
    );
}
