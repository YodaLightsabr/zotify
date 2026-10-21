// Works out a dining hall's hours on a given date from its schedule. A schedule has one "standard" entry and dated
// "special" ones (finals week, summer, holidays), each giving every meal period's hours in OpenStreetMap's
// opening_hours style: "Mo-Fr 07:15-11:00; Sa-Su 09:00-11:00", "We 11:30-14:00", "Mo-Su off". Later rules win for
// the days they name, and a meal period with no rule for a day isn't served that day
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
/** The days a part like "Mo-Fr", "Sa,Su" or "We" covers, as Sunday-first indexes. Ranges can wrap, like "Fr-Mo" */
function daysIn(part) {
    const days = new Set();
    for (const piece of part.split(",")) {
        const [from, to] = piece.trim().split("-").map(day => DAYS.indexOf(day.trim()));
        if (from < 0 || (to !== undefined && to < 0))
            continue;
        for (let day = from;; day = (day + 1) % 7) {
            days.add(day);
            if (to === undefined || day === to)
                break;
        }
    }
    return days;
}
/** A meal period's opening times on one day of the week, from its opening_hours text. Empty when it isn't served */
export function timesOn(openingHours, weekday) {
    let times = [];
    for (const rule of openingHours.split(";").map(rule => rule.trim()).filter(Boolean)) {
        // "Mo-Fr 07:15-11:00,12:00-13:00", "Sa-Su off", or times alone for every day
        const match = rule.match(/^(?:([A-Za-z]{2}(?:\s*[-,]\s*[A-Za-z]{2})*)\s+)?(.+)$/);
        if (!match)
            continue;
        const [, dayPart, timePart] = match;
        if (dayPart && !daysIn(dayPart.replace(/\s+/g, "")).has(weekday))
            continue;
        times = /^(off|closed)$/i.test(timePart.trim()) ? [] : [...timePart.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)]
            .map(([, opens, closes]) => ({ opens: opens.padStart(5, "0"), closes: closes.padStart(5, "0") }));
    }
    return times;
}
/** The schedule entry for a date: the narrowest special one covering it, otherwise the standard one */
function entryFor(schedule, date) {
    const specials = schedule.filter(entry => entry.type === "special" && entry.start_date && entry.end_date
        && entry.start_date <= date && date <= entry.end_date);
    const span = (entry) => Date.parse(entry.end_date) - Date.parse(entry.start_date);
    return specials.sort((a, b) => span(a) - span(b))[0] ?? schedule.find(entry => entry.type === "standard") ?? null;
}
/** A dining hall's meal periods and their hours on a date (YYYY-MM-DD), earliest first */
export function hoursOn(schedule, date) {
    const entry = schedule ? entryFor(schedule, date) : null;
    if (!entry)
        return { date, schedule: null, periods: [] };
    // Noon UTC, so the weekday is right whatever the server's timezone
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const periods = entry.meal_periods.flatMap(({ meal_period, opening_hours }) => timesOn(opening_hours ?? "", weekday).map(times => ({ period: meal_period, ...times })));
    return { date, schedule: entry.name, periods: periods.sort((a, b) => a.opens.localeCompare(b.opens)) };
}
//# sourceMappingURL=hours.js.map