import Link from "next/link";
import { duration, freeUntil, hideBrokenPhoto, timeOf, type FreeRoom } from "@/lib/spaces";

/** A free room: when it's free and for how long, and a link to book it on its booking site */
export default function RoomCard({ room, now = false }: { room: FreeRoom, now?: boolean }) {
    // "Now" when it's free right away, otherwise when it starts
    const from = now && !room.startsInMinutes ? "Now" : timeOf(room.freeFrom);

    return (
        <li className="spaces-card">
            {room.image
                ? <img className="spaces-card-photo" src={room.image} alt="" loading="lazy" onError={hideBrokenPhoto} />
                : <div className="spaces-card-photo" aria-hidden="true" />}
            <div className="spaces-card-body">
                <Link className="spaces-card-name" href={`/rooms/${room.id}`}>{room.name}</Link>
                <p className="spaces-muted">{room.locationName} · {room.capacity} {room.capacity === 1 ? "person" : "people"}</p>
                <p className="spaces-card-time">
                    <strong>{from}</strong> – {freeUntil(room)} <span className="spaces-muted">· {duration(room.minutes)}</span>
                </p>
            </div>
            <a className="spaces-book" href={room.bookingUrl} target="_blank" rel="noreferrer">Book</a>
        </li>
    );
}
