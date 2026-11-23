import { redirect } from "next/navigation";

// L'accueil, c'est la liste de leads.
export default function Page() {
  redirect("/leads");
}
