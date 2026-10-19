// A pick history: songs grouped by day, newest first, each with "Request again". Used by the admin dashboard and My picks.
// PickHistory.create(container, options) returns { render(picks) }
const PickHistory = (() => {
    const VENUE_LABELS = { anteatery: "Anteatery", brandywine: "Brandywine" };
    const PAGE_SIZE = 100;

    function el(tag, props = {}, children = []) {
        const node = Object.assign(document.createElement(tag), props);
        node.append(...children);
        return node;
    }

    const shortEmail = email => email.replace(/@uci\.edu$/i, "");

    function dayLabel(timestamp) {
        const day = new Date(timestamp).toDateString();
        if (day === new Date().toDateString()) return "Today";
        if (day === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
        return new Date(timestamp).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    }

    async function postJson(url, body) {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { response, data: await response.json().catch(() => null) };
    }

    // Same two steps as the homepage: queue it, then upvote it with every account
    async function requestAgain(pick, button, status, onRequested) {
        const busy = label => {
            button.disabled = true;
            button.classList.add("busy");
            button.replaceChildren(el("span", { className: "spinner small" }), label);
        };
        const finish = (label, text = "", isError = false) => {
            button.classList.remove("busy");
            button.textContent = label;
            status.textContent = text;
            status.classList.toggle("error", isError);
        };

        busy("Queuing…");
        status.textContent = "";

        try {
            const { response, data } = await postJson("/api/queue", {
                song: { id: pick.songId, name: pick.name, artist: pick.artist, cover: pick.cover },
                venue: pick.venue
            });

            if (response.status === 409) return finish("Played recently", data?.error ?? "");
            if (!response.ok) throw new Error(data?.error ?? `Couldn't queue it (${response.status})`);

            busy("Voting…");
            const votes = await postJson("/api/vote", { pickId: data.id, venue: pick.venue, song: { name: pick.name, artist: pick.artist } });
            const summary = votes.response.ok
                ? (votes.data.confirmed === null ? `${votes.data.requested} votes sent` : `${votes.data.confirmed} of ${votes.data.requested} votes`)
                : "Queued, but voting failed";

            finish("Queued ✓", summary, !votes.response.ok);
            onRequested?.();
        } catch (error) {
            finish("Request again", error.message, true);
            button.disabled = false;
        }
    }

    function row(pick, { showRequester, onRequested }) {
        const status = el("span", { className: "row-status" });
        const button = el("button", { type: "button", className: "history-button", textContent: "Request again" });
        button.addEventListener("click", () => requestAgain(pick, button, status, onRequested));

        const who = showRequester && pick.requestedBy ? ` · ${shortEmail(pick.requestedBy)}` : "";
        return el("div", { className: "history-row" }, [
            el("div", { className: "song-cell" }, [
                el("span", { className: "time", textContent: new Date(pick.requestedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) }),
                pick.cover ? el("img", { src: pick.cover, alt: "", loading: "lazy" }) : el("div", { className: "no-cover", textContent: "♪" }),
                el("div", { className: "title" }, [
                    el("span", { className: "name", textContent: pick.name }),
                    el("span", { className: "details", textContent: `${pick.artist} · ${VENUE_LABELS[pick.venue] ?? pick.venue}${who}` })
                ])
            ]),
            el("div", { className: "row-actions" }, [status, button])
        ]);
    }

    /** showRequester: show who queued each pick. emptyText: shown with no picks. onRequested: called after a successful Request again */
    function create(container, { showRequester = false, emptyText = "Nothing here yet.", onRequested } = {}) {
        container.classList.add("pick-history");
        let picks = [];
        let shown = PAGE_SIZE;

        function draw() {
            if (!picks.length) {
                container.replaceChildren(el("p", { className: "empty", textContent: emptyText }));
                return;
            }

            // Group the shown picks by day, keeping newest first
            const days = new Map();
            for (const pick of picks.slice(0, shown)) {
                const label = dayLabel(pick.requestedAt);
                if (!days.has(label)) days.set(label, []);
                days.get(label).push(pick);
            }

            const sections = [...days].map(([label, dayPicks]) => el("section", { className: "history-day" }, [
                el("h3", { textContent: `${label} (${dayPicks.length})` }),
                el("div", { className: "history-rows" }, dayPicks.map(pick => row(pick, { showRequester, onRequested })))
            ]));

            if (picks.length > shown) {
                const more = el("button", { type: "button", className: "history-button", textContent: `Show more (${picks.length - shown} older)` });
                more.addEventListener("click", () => { shown += PAGE_SIZE; draw(); });
                sections.push(el("p", {}, [more]));
            }

            container.replaceChildren(...sections);
        }

        return {
            render(newPicks) {
                picks = [...newPicks].sort((a, b) => b.requestedAt - a.requestedAt);
                draw();
            }
        };
    }

    return { create };
})();
