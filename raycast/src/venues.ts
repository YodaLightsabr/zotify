import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useEffect } from "react";
import { getSchools, type Me, type School, type Venue } from "./zotify";

// Which venue you're looking at. It's kept in LocalStorage, which every command of the extension shares, so the queue and
// the menu bar always show the same one

export interface VenueChoice {
  venue: Venue | undefined;
  school: School | undefined;
  schools: School[];
  setVenue: (id: string) => Promise<void>;
  isLoading: boolean;
}

/**
 * The chosen venue and its school. Until one's chosen it's the first venue at a school you're in (when me is known), or the
 * first venue of all
 */
export function useVenue(me?: Me): VenueChoice {
  const schools = useCachedPromise(getSchools, [], { keepPreviousData: true });
  const stored = useLocalStorage<string>("venue");

  const list = schools.data ?? [];
  const approved = list.find((school) => me?.schools.some((entry) => entry.id === school.id && entry.approved));
  const venueId = stored.value ?? approved?.venues[0]?.id ?? list[0]?.venues[0]?.id;
  const school = list.find((candidate) => candidate.venues.some((venue) => venue.id === venueId));

  // Once the queue has worked out a default from where you're a member, keep it, so the menu bar shows the same venue
  useEffect(() => {
    if (me && approved && !stored.isLoading && !stored.value && venueId) stored.setValue(venueId);
  }, [me, approved, stored.isLoading, stored.value, venueId]);

  return {
    venue: school?.venues.find((venue) => venue.id === venueId),
    school,
    schools: list,
    setVenue: stored.setValue,
    isLoading: (schools.isLoading && !schools.data) || stored.isLoading,
  };
}

/** A venue's name from its ID, like "Brandywine", for "At Brandywine" */
export const venueName = (schools: School[], id: string) =>
  schools.flatMap((school) => school.venues).find((venue) => venue.id === id)?.name ?? id;
