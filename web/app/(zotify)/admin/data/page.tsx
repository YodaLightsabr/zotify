import type { Metadata } from "next";
import Cache from "../Data";

export const metadata: Metadata = { title: "Raw data" };

export default function Page() {
    return <Cache />;
}
