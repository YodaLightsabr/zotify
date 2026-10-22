import type { Metadata } from "next";
import TestAccounts from "../TestAccounts";

export const metadata: Metadata = { title: "Test accounts" };

export default function Page() {
    return <TestAccounts />;
}
