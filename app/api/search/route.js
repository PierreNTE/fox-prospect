import { getSupabase } from "@/lib/supabase";

export async function GET(request) {
  const raw = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!raw) return Response.json({ prospects: [], accounts: [] });

  // Neutralise les caractères structurels du langage de filtre PostgREST
  // (virgule = séparateur de conditions, parenthèses = groupes, * = joker) pour
  // empêcher l'injection de filtre via le terme de recherche. Borne aussi la taille.
  const q = raw.replace(/[(),*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) return Response.json({ prospects: [], accounts: [] });

  const supabase = getSupabase();
  const term = `%${q}%`;

  const [{ data: prospects }, { data: accounts }] = await Promise.all([
    supabase
      .from("prospects")
      .select("id, first_name, last_name, role, company, status")
      .or(`first_name.ilike.${term},last_name.ilike.${term},company.ilike.${term},role.ilike.${term}`)
      .limit(6),
    supabase
      .from("accounts")
      .select("id, name, domain, sector")
      .or(`name.ilike.${term},domain.ilike.${term}`)
      .limit(4),
  ]);

  return Response.json({ prospects: prospects || [], accounts: accounts || [] });
}
