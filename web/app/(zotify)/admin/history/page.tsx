import type { Metadata } from "next";
import History from "../History";

export const metadata: Metadata = { title: "History" };

export default function Page() {
    return <History />;
}
