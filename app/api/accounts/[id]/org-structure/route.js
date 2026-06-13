import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { callClaudeJson } from "@/lib/anthropic";
import { orgStructureSystemPrompt, orgStructureUserPrompt } from "@/lib/prompts-accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export async function POST(_request, { params }) {
  const supabase = getSupabase();
  const { id } = params;

  const { data: account, error } = await supabase.from("accounts").select("*").eq("id", id).single();
  if (error || !account) return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });

  const { data: contacts } = await supabase
    .from("account_contacts")
    .select("id, first_name, last_name, role, manager_id")
    .eq("account_id", id);
  if (!contacts || contacts.length < 2) {
    return NextResponse.json({ error: "Pas assez de contacts pour déduire une hiérarchie." }, { status: 400 });
  }

  // Résolution nom → id (premier porteur du nom).
  const byName = new Map();
  for (const c of contacts) {
    const key = norm(`${c.first_name} ${c.last_name}`);
    if (!byName.has(key)) byName.set(key, c.id);
  }

  let links;
  try {
    const { json } = await callClaudeJson({
      system: orgStructureSystemPrompt(),
      user: orgStructureUserPrompt({ account, contacts }),
      maxTokens: 3000,
      webSearch: false,
    });
    links = json.links || [];
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Graphe parent existant, puis application des liens proposés avec garde anti-cycle.
  const parent = new Map(contacts.map((c) => [c.id, c.manager_id || null]));
  const createsCycle = (childId, mgrId) => {
    let cur = mgrId, steps = 0;
    while (cur && steps++ < contacts.length + 1) {
      if (cur === childId) return true;
      cur = parent.get(cur) || null;
    }
    return false;
  };

  let applied = 0;
  const updates = [];
  for (const link of links) {
    const childId = byName.get(norm(link.person || ""));
    const mgrId = byName.get(norm(link.manager || ""));
    if (!childId || !mgrId || childId === mgrId) continue;
    if (createsCycle(childId, mgrId)) continue;
    parent.set(childId, mgrId);
    updates.push({ childId, mgrId });
  }

  for (const u of updates) {
    await supabase.from("account_contacts").update({ manager_id: u.mgrId }).eq("id", u.childId);
    applied++;
  }

  return NextResponse.json({ proposed: links.length, applied });
}
