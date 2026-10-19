import NowPlayingFooter from "./NowPlayingFooter";
import { cx } from "@/lib/format";
import "./card.css";

/** The centered card the sign-in and private beta pages sit in, under the navbar and with the live footer underneath */
export default function CardPage({ className, children }: { className?: string, children: React.ReactNode }) {
    return (
        <div className={cx("card-page", className)}>
            <main>
                <div className="card">
                    {children}
                </div>
            </main>
            <NowPlayingFooter />
        </div>
    );
}
