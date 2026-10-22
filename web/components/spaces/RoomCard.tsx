import { duration, freeUntil, hideBrokenPhoto, timeOf, type FreeRoom, type SpaceLocation } from "@/lib/spaces";

/** A free room: its photo, when it's free and for how long. The whole card opens its booking site */
export default function RoomCard({ room, now = false }: { room: FreeRoom, now?: boolean }) {
    // "Now" when it's free right away, otherwise when it starts
    const from = now && !room.startsInMinutes ? "Now" : timeOf(room.freeFrom);

    return (
        <li>
            <a className="spaces-card" href={room.bookingUrl} target="_blank" rel="noreferrer" title={`Book ${room.name}`}>
                {room.image
                    ? <img className="spaces-card-photo" src={room.image} alt="" loading="lazy" onError={hideBrokenPhoto} />
                    : <div className="spaces-card-photo" aria-hidden="true" />}
                <div className="spaces-card-body">
                    <span className="spaces-card-name">{room.name}</span>
                    <span className="spaces-muted">{room.capacity} {room.capacity === 1 ? "person" : "people"}</span>
                    <span className="spaces-card-time">
                        <strong>{from}</strong> – {freeUntil(room)} <span className="spaces-muted">· {duration(room.minutes)}</span>
                    </span>
                </div>
            </a>
        </li>
    );
}

/** Rooms as cards under each location's name, in the locations' order, leaving out locations with none */
export function RoomsByLocation({ rooms, locations, now = false }: { rooms: FreeRoom[], locations: SpaceLocation[], now?: boolean }) {
    return <>
        {locations.map(location => ({ location, here: rooms.filter(room => room.location === location.id) }))
            .filter(({ here }) => here.length)
            .map(({ location, here }) => (
                <section key={location.id} className="spaces-location">
                    <h3 className="spaces-location-name">{location.name} <span className="spaces-muted">{here.length}</span></h3>
                    <ul className="spaces-cards">{here.map(room => <RoomCard key={room.id} room={room} now={now} />)}</ul>
                </section>
            ))}
    </>;
}
