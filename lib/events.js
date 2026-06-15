import { getSupabase } from "@/lib/supabase";

// Fire-and-forget : un échec de log n'affecte jamais le flux principal.
// Même pattern que lib/ai-runs.js — erreurs avalées silencieusement.
export function logEvent({ kind, prospectId = null, accountId = null, fromStatus = null, toStatus = null, note = null }) {
  const supabase = getSupabase();
  supabase
    .from("events")
    .insert({
      kind,
      prospect_id: prospectId ?? null,
      account_id: accountId ?? null,
      from_status: fromStatus ?? null,
      to_status: toStatus ?? null,
      note: note ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[events] insert error:", error.message);
    });
}
