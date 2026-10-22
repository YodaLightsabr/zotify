import type { Metadata } from "next";
import Beta from "../Beta";

export const metadata: Metadata = { title: "Beta" };

export default function Page() {
    return <Beta />;
}
