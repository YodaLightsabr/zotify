import type { Metadata } from "next";
import Schools from "../Schools";

export const metadata: Metadata = { title: "Schools" };

export default function Page() {
    return <Schools />;
}
