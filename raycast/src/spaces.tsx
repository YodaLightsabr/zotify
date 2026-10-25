import { Action, ActionPanel, Color, Form, Icon, Image, Keyboard, List, useNavigation } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useEffect, useState } from "react";
import { SITE_URL, zotify } from "./zotify";

// Zotify Spaces: study rooms at the libraries and housing, and when they're free, live from their booking sites. Public, so
// it needs no sign-in. The front screen is rooms free right now, by location; Find a Time, a room's week and every room's day
// are pushed from it. Zotify can't book rooms: ↵ opens the room's booking page. See UX.md

const SCHOOL = "uci";
const TIMEZONE = "America/Los_Angeles";
const SPACES_URL = SITE_URL.replace("www.", "spaces.");
// Availability changes by the minute, so it's fetched again this often while a list is open
const REFRESH_MS = 30_000;
const CAPACITIES = [0, 2, 4, 6, 8];

interface Room {
  id: string;
  name: string;
  capacity: number;
  location: string;
  locationName: string;
  locationShortName: string;
  image: string | null;
  description: string | null;
  directions: string | null;
  bookingUrl: string;
}

type FreeRoom = Room & { freeFrom: string; freeUntil: string; minutes: number; startsInMinutes?: number };

interface Stretch {
  start: string;
  end: string;
  minutes: number;
}

interface Slot {
  start: string;
  end: string;
  status: "available" | "booked" | "unavailable";
  past?: true;
}

interface Location {
  id: string;
  name: string;
  shortName: string;
}

const get = <T,>(path: string) => zotify<T>(`/v1/spaces/${SCHOOL}${path}`, { token: null });

const todayIn = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "Today", "Tomorrow", or "Sat, Oct 26" */
function dayName(date: string) {
  const today = todayIn();
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "14:30" → "2:30 PM" */
const clock = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours % 24 >= 12 ? "PM" : "AM"}`;
};

/** An API time, in the school's timezone, like "2026-10-21T14:30:00-07:00" → "2:30 PM" */
const timeOf = (iso: string) => clock(iso.slice(11, 16));

/** 135 → "2h 15m" */
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`;
}

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/** Fetches again every 30 seconds while the list is open */
function useEvery30s(revalidate: () => void) {
  useEffect(() => {
    const timer = setInterval(revalidate, REFRESH_MS);
    return () => clearInterval(timer);
  }, [revalidate]);
}

/** The rooms' locations, for grouping, with their casual names */
function useLocations() {
  const overview = useCachedPromise(() => get<{ locations: Location[] }>(""), [], { keepPreviousData: true });
  return overview.data?.locations ?? [];
}

/** Rooms grouped under their locations, in the locations' order */
function byLocation<T extends Room>(rooms: T[], locations: Location[]) {
  return locations
    .map((location) => ({ location, rooms: rooms.filter((room) => room.location === location.id) }))
    .filter((group) => group.rooms.length);
}

const roomIcon = (room: Room): Image.ImageLike =>
  room.image ? { source: room.image, mask: Image.Mask.RoundedRectangle } : Icon.Building;

/** The size filter in the search bar, remembered between runs */
function CapacityDropdown({ value, onChange }: { value: number; onChange: (capacity: number) => void }) {
  return (
    <List.Dropdown tooltip="Room Size" value={String(value)} onChange={(next) => onChange(Number(next))}>
      {CAPACITIES.map((capacity) => (
        <List.Dropdown.Item
          key={capacity}
          value={String(capacity)}
          title={capacity ? `${capacity}+ People` : "Any Size"}
          icon={Icon.Person}
        />
      ))}
    </List.Dropdown>
  );
}

function useCapacity() {
  const stored = useLocalStorage<number>("spaces-capacity", 0);
  return [stored.value ?? 0, stored.setValue] as const;
}

/** A room's detail pane: its photo and description, when it's free, and where it is */
function RoomDetail({ room, free }: { room: Room; free?: string }) {
  const markdown = [
    room.image ? `![${room.name}](${room.image}?raycast-height=170)` : null,
    `## ${room.name}`,
    room.description,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <List.Item.Detail
      markdown={markdown}
      metadata={
        <List.Item.Detail.Metadata>
          {free && (
            <List.Item.Detail.Metadata.Label
              title="Free"
              text={free}
              icon={{ source: Icon.Clock, tintColor: Color.Green }}
            />
          )}
          <List.Item.Detail.Metadata.Label title="Location" text={room.locationName} icon={Icon.Building} />
          <List.Item.Detail.Metadata.Label title="Size" text={people(room.capacity)} icon={Icon.Person} />
          {room.directions && <List.Item.Detail.Metadata.Label title="Directions" text={room.directions} />}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Link title="Book" target={room.bookingUrl} text={new URL(room.bookingUrl).host} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

/** Book, see the week, and the rest, for any room */
function RoomActions({ room, onRefresh }: { room: Room; onRefresh: () => void }) {
  return (
    <ActionPanel title={room.name}>
      <Action.OpenInBrowser title="Book Room" icon={Icon.Calendar} url={room.bookingUrl} />
      <Action.Push title="Show This Week" icon={Icon.List} target={<RoomWeek room={room} />} />
      <ActionPanel.Section>
        <Action.Push
          title="Find a Time…"
          icon={Icon.Clock}
          shortcut={{ modifiers: ["cmd"], key: "f" }}
          target={<FindATime />}
        />
        <Action.Push
          title="Browse All Rooms"
          icon={Icon.AppWindowList}
          shortcut={{ modifiers: ["cmd"], key: "b" }}
          target={<BrowseRooms />}
        />
      </ActionPanel.Section>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy Booking Link"
          content={room.bookingUrl}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        <Action
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={onRefresh}
        />
        <Action.OpenInBrowser title="Open Zotify Spaces" url={SPACES_URL} shortcut={Keyboard.Shortcut.Common.Open} />
      </ActionPanel.Section>
    </ActionPanel>
  );
}

/** A free room: how long it's free, and its size */
function FreeRoomItem({ room, now, onRefresh }: { room: FreeRoom; now?: boolean; onRefresh: () => void }) {
  const from = now && !room.startsInMinutes ? "now" : timeOf(room.freeFrom);
  const free = `${from === "now" ? "Now" : from} – ${timeOf(room.freeUntil)} (${duration(room.minutes)})`;

  return (
    <List.Item
      title={room.name}
      subtitle={`${from === "now" ? "Free" : `From ${from},`} until ${timeOf(room.freeUntil)}`}
      icon={roomIcon(room)}
      keywords={[room.locationName, room.locationShortName]}
      accessories={[
        { tag: { value: duration(room.minutes), color: Color.Green } },
        { icon: Icon.Person, text: String(room.capacity), tooltip: people(room.capacity) },
      ]}
      detail={<RoomDetail room={room} free={free} />}
      actions={<RoomActions room={room} onRefresh={onRefresh} />}
    />
  );
}

/** The front screen: rooms free now (or within half an hour), longest first, by location, then rooms free soon */
export default function FreeNow() {
  const locations = useLocations();
  const [capacity, setCapacity] = useCapacity();
  const now = useCachedPromise(
    (least: number) => get<{ rooms: FreeRoom[]; soon: FreeRoom[] }>(`/now?capacity=${least}`),
    [capacity],
    { keepPreviousData: true },
  );
  useEvery30s(now.revalidate);

  const rooms = now.data?.rooms ?? [];
  const soon = now.data?.soon ?? [];

  return (
    <List
      isLoading={now.isLoading}
      isShowingDetail={rooms.length + soon.length > 0}
      searchBarPlaceholder="Search rooms and locations…"
      searchBarAccessory={<CapacityDropdown value={capacity} onChange={setCapacity} />}
    >
      <List.EmptyView
        icon={Icon.Building}
        title="Nothing's free right now"
        description="Find a time later today, or another day."
        actions={
          <ActionPanel>
            <Action.Push title="Find a Time…" icon={Icon.Clock} target={<FindATime />} />
            <Action.Push title="Browse All Rooms" icon={Icon.AppWindowList} target={<BrowseRooms />} />
          </ActionPanel>
        }
      />
      {byLocation(rooms, locations).map(({ location, rooms: here }) => (
        <List.Section key={location.id} title={location.shortName} subtitle={`${here.length} free`}>
          {here.map((room) => (
            <FreeRoomItem key={room.id} room={room} now onRefresh={now.revalidate} />
          ))}
        </List.Section>
      ))}
      {soon.length > 0 && (
        <List.Section title="Free Soon" subtitle={String(soon.length)}>
          {soon.map((room) => (
            <FreeRoomItem key={room.id} room={room} onRefresh={now.revalidate} />
          ))}
        </List.Section>
      )}
    </List>
  );
}

/** One room's free times for each of the next seven days */
function RoomWeek({ room }: { room: Room }) {
  const week = useCachedPromise(
    (id: string) => get<{ days: { date: string; slots: Slot[]; free: Stretch[] }[] }>(`/rooms/${id}?days=7`),
    [room.id],
    { keepPreviousData: true },
  );
  useEvery30s(week.revalidate);

  return (
    <List isLoading={week.isLoading} navigationTitle={room.name} searchBarPlaceholder="Filter days…">
      {week.data?.days.map((day) => (
        <List.Section
          key={day.date}
          title={dayName(day.date)}
          subtitle={
            day.free.length
              ? `${duration(day.free.reduce((total, stretch) => total + stretch.minutes, 0))} free`
              : undefined
          }
        >
          {day.free.length ? (
            day.free.map((stretch) => (
              <List.Item
                key={stretch.start}
                title={`${timeOf(stretch.start)} – ${timeOf(stretch.end)}`}
                icon={{ source: Icon.Clock, tintColor: Color.Green }}
                keywords={[dayName(day.date)]}
                accessories={[{ tag: { value: duration(stretch.minutes), color: Color.Green } }]}
                actions={<RoomActions room={room} onRefresh={week.revalidate} />}
              />
            ))
          ) : (
            <List.Item
              title={day.slots.some((slot) => !slot.past) ? "Booked up" : "Can't be booked yet"}
              icon={{ source: Icon.XMarkCircle, tintColor: Color.SecondaryText }}
              keywords={[dayName(day.date)]}
              actions={<RoomActions room={room} onRefresh={week.revalidate} />}
            />
          )}
        </List.Section>
      ))}
    </List>
  );
}

// Times to pick from, every half hour from 6 AM to midnight
const TIMES = Array.from({ length: 37 }, (_, i) => {
  const minutes = 6 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** Picks a day and a stretch of time, then lists the rooms free for all of it */
function FindATime() {
  const { push } = useNavigation();
  const [capacity] = useCapacity();
  const [from, setFrom] = useState(() => {
    const [hours, minutes] = new Intl.DateTimeFormat("en-GB", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date())
      .split(":")
      .map(Number);
    return (
      TIMES.find((time) => time >= `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`) ?? TIMES[0]
    );
  });

  return (
    <Form
      navigationTitle="Find a Time"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Find Rooms"
            icon={Icon.MagnifyingGlass}
            onSubmit={(values: { date: Date | null; from: string; to: string; capacity: string }) => {
              const date = values.date
                ? new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(values.date)
                : todayIn();
              push(<FreeAtTime date={date} from={values.from} to={values.to} capacity={Number(values.capacity)} />);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Rooms free for the whole time you need. Bookings open about two weeks ahead." />
      <Form.DatePicker id="date" title="Day" type={Form.DatePicker.Type.Date} defaultValue={new Date()} />
      <Form.Dropdown id="from" title="From" value={from} onChange={setFrom}>
        {TIMES.slice(0, -1).map((time) => (
          <Form.Dropdown.Item key={time} value={time} title={clock(time)} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="to" title="Until" defaultValue={TIMES[Math.min(TIMES.indexOf(from) + 4, TIMES.length - 1)]}>
        {TIMES.filter((time) => time > from).map((time) => (
          <Form.Dropdown.Item key={time} value={time} title={time === "24:00" ? "Midnight" : clock(time)} />
        ))}
      </Form.Dropdown>
      <Form.Dropdown id="capacity" title="Room Size" defaultValue={String(capacity)}>
        {CAPACITIES.map((least) => (
          <Form.Dropdown.Item key={least} value={String(least)} title={least ? `${least}+ People` : "Any Size"} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

/** Rooms free from one time to another on a day, by location */
function FreeAtTime({ date, from, to, capacity }: { date: string; from: string; to: string; capacity: number }) {
  const locations = useLocations();
  const free = useCachedPromise(
    (query: string) => get<{ rooms: FreeRoom[] }>(`/free?${query}`),
    [new URLSearchParams({ date, from, to, capacity: String(capacity) }).toString()],
    { keepPreviousData: true },
  );
  useEvery30s(free.revalidate);
  const rooms = free.data?.rooms ?? [];

  return (
    <List
      isLoading={free.isLoading}
      isShowingDetail={rooms.length > 0}
      navigationTitle={`${dayName(date)}, ${clock(from)} – ${to === "24:00" ? "Midnight" : clock(to)}`}
      searchBarPlaceholder="Search rooms and locations…"
    >
      <List.EmptyView
        icon={Icon.Clock}
        title="Nothing's free for all of that time"
        description="Try a shorter stretch, or another day."
      />
      {byLocation(rooms, locations).map(({ location, rooms: here }) => (
        <List.Section key={location.id} title={location.shortName} subtitle={`${here.length} free`}>
          {here.map((room) => (
            <FreeRoomItem key={room.id} room={room} onRefresh={free.revalidate} />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

/** Every room's free times on a day, picked in the search bar, by location */
function BrowseRooms() {
  const locations = useLocations();
  const today = todayIn();
  const [date, setDate] = useState(today);
  const [capacity] = useCapacity();
  const day = useCachedPromise(
    (query: string) => get<{ rooms: (Room & { slots: Slot[]; free: Stretch[] })[] }>(`/availability?${query}`),
    [new URLSearchParams({ date, capacity: String(capacity) }).toString()],
    { keepPreviousData: true },
  );
  useEvery30s(day.revalidate);
  const rooms = day.data?.rooms ?? [];

  return (
    <List
      isLoading={day.isLoading}
      isShowingDetail={rooms.length > 0}
      navigationTitle="All Rooms"
      searchBarPlaceholder="Search rooms and locations…"
      searchBarAccessory={
        <List.Dropdown tooltip="Day" value={date} onChange={setDate}>
          {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((option) => (
            <List.Dropdown.Item key={option} value={option} title={dayName(option)} icon={Icon.Calendar} />
          ))}
        </List.Dropdown>
      }
    >
      {byLocation(rooms, locations).map(({ location, rooms: here }) => (
        <List.Section key={location.id} title={location.shortName} subtitle={String(here.length)}>
          {here.map((room) => {
            const total = room.free.reduce((sum, stretch) => sum + stretch.minutes, 0);
            const times = room.free.map((stretch) => `${timeOf(stretch.start)} – ${timeOf(stretch.end)}`);
            return (
              <List.Item
                key={room.id}
                title={room.name}
                subtitle={room.free[0] ? `Free from ${timeOf(room.free[0].start)}` : "Booked up"}
                icon={roomIcon(room)}
                keywords={[room.locationName, room.locationShortName]}
                detail={<RoomDetail room={room} free={times.length ? times.join(", ") : "Not at all"} />}
                accessories={total ? [{ tag: { value: duration(total), color: Color.Green } }] : []}
                actions={<RoomActions room={room} onRefresh={day.revalidate} />}
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
