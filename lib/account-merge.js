// Doublons et groupes de sociétés parmi les leads.
//
// - Doublon sûr : même SIREN (ou l'un est le repreneur de l'autre). Fusionné
//   automatiquement : contacts, recherches, tâches… passent sur le compte gardé.
// - Doublon possible : noms quasi identiques, SIREN différents ou inconnus →
//   simple alerte avec un bouton « Fusionner ».
// - Même groupe : mêmes dirigeants « personne morale » (holding présidente) ou
//   l'un est la société mère de l'autre → alerte « filiale / groupe ».
import { normalizeName, nameScore } from "@/lib/company-health";

const ALIVE = (s) => (/^new/i.test(s || "") ? 0 : /^working/i.test(s || "") ? 1 : /closed/i.test(s || "") ? 3 : 2);

const sirenOf = (l) => l.health_detail?.siren || l.siren || null;
const successorOf = (l) => (l.health_detail?.successor?.confidence === "forte" ? l.health_detail.successor.siren : null);
const groupOf = (l) => l.health_detail?.groupe || l.groupe || null;

/** Compte à garder dans une paire : statut Salesforce le plus vivant, puis le plus ancien. */
export function pickKeeper(a, b) {
  const ra = ALIVE(a.sf_lead_status);
  const rb = ALIVE(b.sf_lead_status);
  if (ra !== rb) return ra < rb ? [a, b] : [b, a];
  const da = String(a.sf_first_seen_at || a.created_at || "");
  const db = String(b.sf_first_seen_at || b.created_at || "");
  return da <= db ? [a, b] : [b, a];
}

/**
 * Analyse pure des leads.
 * @returns {{ sure: [keep, drop, reason][], possible: [a, b][], groups: Map<string, {name, siren, ids}> , parentOf: Map<id, lead> }}
 */
export function analyzeDuplicates(leads) {
  const bySiren = new Map();
  for (const l of leads) {
    const s = sirenOf(l);
    if (s) bySiren.set(s, [...(bySiren.get(s) || []), l]);
  }
  const sure = [];
  const seen = new Set();
  for (const [, list] of bySiren) {
    for (let i = 1; i < list.length; i++) {
      const [keep, drop] = pickKeeper(list[0], list[i]);
      sure.push([keep, drop, "même SIREN"]);
      seen.add(drop.id);
    }
  }
  // Repreneur : la société fermée continue sous le SIREN d'un autre lead.
  for (const l of leads) {
    const succ = successorOf(l);
    const other = succ && (bySiren.get(succ) || []).find((x) => x.id !== l.id && sirenOf(x) === succ && !seen.has(x.id));
    if (other && !seen.has(l.id)) {
      sure.push([other, l, "repris par l'autre compte"]);
      seen.add(l.id);
    }
  }

  // Doublons possibles : noms quasi identiques, pas déjà fusionnables.
  const possible = [];
  const rest = leads.filter((l) => !seen.has(l.id));
  const key = (l) => normalizeName(l.health_detail?.sirene_name || l.name);
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const a = rest[i];
      const b = rest[j];
      if (sirenOf(a) && sirenOf(b) && sirenOf(a) === sirenOf(b)) continue;
      const ka = key(a);
      const kb = key(b);
      if (!ka || !kb) continue;
      if (ka === kb || (Math.min(ka.length, kb.length) >= 6 && nameScore(ka, kb) >= 0.92 && nameScore(kb, ka) >= 0.92)) {
        possible.push([a, b]);
      }
    }
  }

  // Groupes : même société « présidente » (holding) ou mère présente dans la liste.
  const groups = new Map();
  for (const l of leads) {
    const g = groupOf(l);
    if (!g?.siren) continue;
    const entry = groups.get(g.siren) || { siren: g.siren, name: g.name, ids: [] };
    entry.ids.push(l.id);
    groups.set(g.siren, entry);
  }
  const parentOf = new Map();
  for (const l of leads) {
    const g = groupOf(l);
    const parent = g?.siren && (bySiren.get(g.siren) || [])[0];
    if (parent && parent.id !== l.id) parentOf.set(l.id, parent);
  }
  for (const [s, g] of groups) {
    if (g.ids.length < 2 && !(bySiren.get(s) || []).length) groups.delete(s);
  }
  return { sure, possible, groups, parentOf };
}

/** Étiquettes à afficher par lead (doublon possible, groupe, filiale). */
export function duplicateFlags(leads) {
  const { possible, groups, parentOf } = analyzeDuplicates(leads);
  const byId = new Map(leads.map((l) => [l.id, l]));
  const flags = new Map();
  const add = (id, f) => flags.set(id, [...(flags.get(id) || []), f]);
  for (const [a, b] of possible) {
    add(a.id, { kind: "doublon", other_id: b.id, other_name: b.name });
    add(b.id, { kind: "doublon", other_id: a.id, other_name: a.name });
  }
  for (const [, g] of groups) {
    const members = g.ids.map((id) => byId.get(id)).filter(Boolean);
    for (const m of members) {
      const others = members.filter((x) => x.id !== m.id).map((x) => x.name);
      if (others.length) add(m.id, { kind: "groupe", group_name: g.name, others });
    }
  }
  for (const [id, parent] of parentOf) add(id, { kind: "filiale", other_id: parent.id, other_name: parent.name });
  return flags;
}

const MOVE_TABLES = ["scrape_results", "prospects", "tasks", "events", "documents", "opportunities", "company_signals", "company_research", "veille_sources"];

/**
 * Fusionne `dropId` dans `keepId` puis supprime `dropId`.
 * Contacts dédoublonnés par nom ; champs du compte gardé complétés par l'autre.
 */
export async function mergeAccounts(supabase, keepId, dropId) {
  if (!keepId || !dropId || keepId === dropId) throw new Error("Deux comptes différents sont nécessaires.");
  const { data: rows, error } = await supabase.from("accounts").select("*").in("id", [keepId, dropId]);
  if (error) throw new Error(error.message);
  const keep = rows.find((r) => r.id === keepId);
  const drop = rows.find((r) => r.id === dropId);
  if (!keep || !drop) throw new Error("Compte introuvable.");

  // 1. Contacts : on déplace ceux que le compte gardé n'a pas déjà.
  const { data: kc } = await supabase.from("account_contacts").select("first_name, last_name").eq("account_id", keepId);
  const k = (c) => `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  const known = new Set((kc || []).map(k));
  const { data: dc } = await supabase.from("account_contacts").select("id, first_name, last_name").eq("account_id", dropId);
  const moveIds = (dc || []).filter((c) => !known.has(k(c))).map((c) => c.id);
  if (moveIds.length) await supabase.from("account_contacts").update({ account_id: keepId }).in("id", moveIds);

  // 2. Le reste suit le compte gardé (tables absentes ignorées).
  for (const t of MOVE_TABLES) {
    await supabase.from(t).update({ account_id: keepId }).eq("account_id", dropId).then(() => null, () => null);
  }

  // 3. Champs : on complète ce qui manque au compte gardé.
  const alive = [keep.sf_lead_status, drop.sf_lead_status].sort((a, b) => ALIVE(a) - ALIVE(b))[0] || keep.sf_lead_status;
  const campaigns = [...new Set([keep.sf_campaign, drop.sf_campaign].filter(Boolean).flatMap((c) => c.split(" · ")))].join(" · ").slice(0, 80);
  const minDate = (a, b) => [a, b].filter(Boolean).sort()[0] || null;
  const maxDate = (a, b) => [a, b].filter(Boolean).sort().pop() || null;
  const fill = (f) => (keep[f] == null || keep[f] === "" ? drop[f] : keep[f]);
  const update = {
    sf_lead_status: alive,
    sf_campaign: campaigns || keep.sf_campaign,
    sf_first_seen_at: minDate(keep.sf_first_seen_at, drop.sf_first_seen_at),
    sf_last_seen_at: maxDate(keep.sf_last_seen_at, drop.sf_last_seen_at),
    website: fill("website"),
    domain: fill("domain"),
    web_intel: fill("web_intel"),
    web_intel_at: fill("web_intel_at"),
    call_status: fill("call_status"),
    call_note: [keep.call_note, drop.call_note].filter(Boolean).join("\n") || null,
    recall_at: fill("recall_at"),
  };
  for (const f of Object.keys(update)) if (!(f in keep)) delete update[f];
  const { error: upErr } = await supabase.from("accounts").update(update).eq("id", keepId);
  if (upErr) throw new Error(upErr.message);

  const { error: delErr } = await supabase.from("accounts").delete().eq("id", dropId);
  if (delErr) throw new Error(delErr.message);
  return { kept: keepId, merged: dropId, contacts_moved: moveIds.length, names: [keep.name, drop.name] };
}

/** Fusionne automatiquement les doublons sûrs (même SIREN / repris). */
export async function autoMergeDuplicates(supabase, leads) {
  const { sure } = analyzeDuplicates(leads);
  const done = [];
  for (const [keep, drop, reason] of sure) {
    try {
      const r = await mergeAccounts(supabase, keep.id, drop.id);
      done.push({ ...r, reason });
    } catch (e) {
      done.push({ kept: keep.id, merged: drop.id, error: e.message });
    }
  }
  return done;
}
