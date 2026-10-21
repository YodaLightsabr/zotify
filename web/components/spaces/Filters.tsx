"use client";

import { cx } from "@/lib/format";
import { useSpaceFilters, type SpaceLocation } from "@/lib/spaces";

const CAPACITIES = [0, 2, 4, 6, 8];

/** How many people and where, shared by every page and remembered in the browser */
export default function Filters({ locations }: { locations: SpaceLocation[] }) {
    const [filters, setFilters] = useSpaceFilters();

    const toggle = (id: string) => setFilters({
        ...filters,
        locations: filters.locations.includes(id) ? filters.locations.filter(location => location !== id) : [...filters.locations, id]
    });

    return (
        <div className="spaces-filters">
            <div className="spaces-chips" role="group" aria-label="People">
                {CAPACITIES.map(capacity => (
                    <button key={capacity} type="button" className={cx("spaces-chip", filters.capacity === capacity && "current")}
                        aria-pressed={filters.capacity === capacity} onClick={() => setFilters({ ...filters, capacity })}>
                        {capacity ? `${capacity}+ people` : "Any size"}
                    </button>
                ))}
            </div>
            <div className="spaces-chips" role="group" aria-label="Locations">
                <button type="button" className={cx("spaces-chip", !filters.locations.length && "current")} aria-pressed={!filters.locations.length}
                    onClick={() => setFilters({ ...filters, locations: [] })}>Everywhere</button>
                {locations.map(location => (
                    <button key={location.id} type="button" className={cx("spaces-chip", filters.locations.includes(location.id) && "current")}
                        aria-pressed={filters.locations.includes(location.id)} onClick={() => toggle(location.id)}>
                        {location.name}
                    </button>
                ))}
            </div>
        </div>
    );
}
