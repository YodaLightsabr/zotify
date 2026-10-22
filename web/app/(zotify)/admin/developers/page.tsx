import type { Metadata } from "next";
import Developers from "../Developers";

export const metadata: Metadata = { title: "Developers" };

export default function Page() {
    return <Developers />;
}
