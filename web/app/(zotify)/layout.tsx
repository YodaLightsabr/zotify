import Navbar from "@/components/Navbar";
import NowPlayingBar from "@/components/NowPlayingBar";
import TabBar from "@/components/TabBar";
import { LiveProvider } from "@/lib/live";
import { NavigationProvider } from "@/lib/navigation";

/** Zotify's own pages (not Zotify Meals): the navbar, live updates, the now playing bar and, on phones, the tab bar */
export default function ZotifyLayout({ children }: { children: React.ReactNode }) {
    return (
        // One live connection for the whole visit, so pages update without polling
        <LiveProvider>
            <NavigationProvider>
                {/* One navbar for every page, kept mounted while moving between them */}
                <Navbar />
                {children}
                {/* Everywhere but the homepage, which shows the queue itself */}
                <NowPlayingBar />
                {/* Phones only: navigation along the bottom */}
                <TabBar />
            </NavigationProvider>
        </LiveProvider>
    );
}
