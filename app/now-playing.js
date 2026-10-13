// Fills #now-playing-text with what's playing at either venue and keeps it fresh, so pages like sign-in feel live
const VENUES = [["anteatery", "Anteatery"], ["brandywine", "Brandywine"]];
const nowPlayingText = document.getElementById("now-playing-text");

async function updateNowPlaying() {
    for (const [venue, label] of VENUES) {
        try {
            const response = await fetch(`/api/venue-queue?${new URLSearchParams({ venue })}`);
            const song = response.ok ? (await response.json()).nowPlaying : null;

            if (song) {
                const title = document.createElement("strong");
                title.textContent = song.name;
                nowPlayingText.replaceChildren(`Now playing at ${label}: `, title, ` by ${song.artist}`);
                return;
            }
        } catch {}
    }

    nowPlayingText.textContent = "Nothing's playing right now";
}

updateNowPlaying();
setInterval(() => { if (!document.hidden) updateNowPlaying(); }, 20_000);
