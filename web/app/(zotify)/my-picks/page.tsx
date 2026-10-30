import { redirect } from "next/navigation";

/** My picks is now the History in your Library */
export default function MyPicksPage() {
    redirect("/library/history");
}
