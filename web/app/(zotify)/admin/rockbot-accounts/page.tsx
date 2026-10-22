import type { Metadata } from "next";
import RockbotAccounts from "../RockbotAccounts";

export const metadata: Metadata = { title: "Rockbot accounts" };

export default function Page() {
    return <RockbotAccounts />;
}
