// Import d'un lead Salesforce en compte Fox Prospect + contrôle de santé.
import { cleanCompanyName } from "@/lib/salesforce-leads";
import { checkCompanyHealth } from "@/lib/company-health";
import { normalizeSireneResult, upsertCompany } from "@/lib/sirene";

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Champs « santé » à écrire sur le compte, à partir du contrôle. */
export function healthFields(check) {
  const s = check.sirene;
  return {
    health_status: check.verdict.status,
    health_label: check.verdict.label,
    health_checked_at: new Date().toISOString(),
    health_detail: {
      siren: check.match?.siren || null,
      match_confidence: check.match?.confidence || null,
      sirene_name: s?.nom_complet || null,
      commune: s?.siege?.libelle_commune || null,
      naf: s?.activite_principale || null,
      effectif: s?.tranche_effectif_salarie || null,
      categorie: s?.categorie_entreprise || null,
      date_fermeture: s?.date_fermeture || null,
      procedure: check.bodacc?.procedure || null,
      procedure_date: check.bodacc?.date || null,
      procedure_nature: check.bodacc?.nature || null,
      // Dirigeants légaux : premier point d'entrée dans une PME (publics au RNE).
      dirigeants: (s?.dirigeants || [])
        .filter((d) => d.type_dirigeant !== "personne morale" && (d.nom || d.prenoms))
        .filter((d) => !/commissaire/i.test(d.qualite || ""))
        .slice(0, 4)
        .map((d) => ({ name: [d.prenoms, d.nom].filter(Boolean).join(" "), role: d.qualite || "" })),
    },
  };
}

async function linkCompany(supabase, check) {
  if (!check.sirene) return null;
  return upsertCompany(supabase, normalizeSireneResult(check.sirene)).catch(() => null);
}

/**
 * @param {object} supabase
 * @param {{ company: string, status?: string, campaign?: string }} lead
 */
export async function importLead(supabase, lead) {
  const name = (lead.company || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!name) return { company: lead.company, error: "nom vide" };

  let check;
  try {
    check = await checkCompanyHealth(cleanCompanyName(name));
  } catch (e) {
    return { company: name, error: `contrôle impossible : ${e.message}` };
  }

  const companyId = await linkCompany(supabase, check);
  const fields = {
    ...healthFields(check),
    source: "salesforce",
    sf_lead_status: (lead.status || "").slice(0, 40),
    sf_campaign: (lead.campaign || "").slice(0, 80),
    ...(companyId ? { company_id: companyId } : {}),
  };

  const { data: existing } = await supabase
    .from("accounts")
    .select("id")
    .ilike("name", escapeLike(name))
    .limit(1);

  let accountId;
  let created = false;
  if (existing?.length) {
    accountId = existing[0].id;
    const { error } = await supabase.from("accounts").update(fields).eq("id", accountId);
    if (error) return { company: name, error: error.message };
  } else {
    // auto_watch = false : 400 leads importés ne doivent pas tous partir dans la
    // veille automatique (recherche web payante). On l'active compte par compte.
    const { data, error } = await supabase
      .from("accounts")
      .insert({ name, auto_watch: false, ...fields })
      .select("id")
      .single();
    if (error) return { company: name, error: error.message };
    accountId = data.id;
    created = true;
  }

  return {
    company: name,
    accountId,
    created,
    status: check.verdict.status,
    label: check.verdict.label,
    siren: check.match?.siren || null,
    sirene_name: check.sirene?.nom_complet || null,
    confidence: check.match?.confidence || null,
  };
}

/** Re-contrôle d'un compte existant (bouton « Revérifier »). */
export async function recheckAccount(supabase, account) {
  const check = await checkCompanyHealth(cleanCompanyName(account.name));
  const companyId = await linkCompany(supabase, check);
  const fields = { ...healthFields(check), ...(companyId ? { company_id: companyId } : {}) };
  const { error } = await supabase.from("accounts").update(fields).eq("id", account.id);
  if (error) throw new Error(error.message);
  return fields;
}

const LEAD_COLUMNS =
  "id, name, sf_lead_status, sf_campaign, health_status, health_label, health_detail, health_checked_at, call_prep, call_prep_at, created_at";

/** Comptes issus de Salesforce, pour la page Leads. */
export async function listSalesforceLeads(supabase) {
  const { data } = await supabase
    .from("accounts")
    .select(LEAD_COLUMNS)
    .eq("source", "salesforce")
    .order("name", { ascending: true })
    .limit(2000);
  return (data || []).map(({ health_detail, call_prep, ...a }) => ({
    ...a,
    siren: health_detail?.siren || null,
    sirene_name: health_detail?.sirene_name || null,
    commune: health_detail?.commune || null,
    match_confidence: health_detail?.match_confidence || null,
    contacts_found: (call_prep?.contacts || []).length,
    standard_phone: call_prep?.coordonnees?.standard || "",
  }));
}
