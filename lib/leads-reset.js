// Suppression de tous les leads Salesforce (bouton « Supprimer tous les leads »
// ou import en mode « Remplacer ») : comptes, contacts, résultats et recherches
// en file. Les autres comptes (hors Salesforce) ne sont pas touchés.
const CHUNK = 200;

export async function deleteAllLeads(supabase) {
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("accounts").select("id").eq("source", "salesforce").range(from, from + 999);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((r) => r.id));
    if (!data || data.length < 1000) break;
  }
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    await supabase.from("scrape_results").delete().in("account_id", part);
    await supabase.from("scrape_jobs").delete().in("params->>account_id", part);
    await supabase.from("jobs").delete().in("payload->>account_id", part);
    const { error } = await supabase.from("accounts").delete().in("id", part);
    if (error) throw new Error(error.message);
  }
  return { deleted: ids.length };
}
