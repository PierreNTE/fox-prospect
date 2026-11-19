// Qualification Dell : modèle de la fiche, complétude, et résumé Salesforce.
//
// Chez Dell, une « opportunité » naît d'une qualification d'infrastructure
// (parc serveurs, hyperviseur, stockage, backup — la FIN DE MAINTENANCE étant
// l'information clé), et un « next step » d'un projet qualifié en BANT.
// Module pur (client + serveur), sans accès réseau.

export const HEALTH_META = {
  active: { label: "Active", color: "success" },
  vigilance: { label: "Procédure en cours", color: "warning" },
  fermee: { label: "Fermée / liquidée", color: "danger" },
  introuvable: { label: "À vérifier", color: "informative" },
};

export const QUALIF_SECTIONS = [
  {
    key: "servers",
    title: "Serveurs",
    fields: [
      { key: "count", label: "Nombre de serveurs", placeholder: "ex. 12 (dont 3 hôtes ESXi)", required: true },
      { key: "brand", label: "Marque", placeholder: "Dell, HPE, Lenovo…", required: true },
      { key: "model", label: "Modèle(s)", placeholder: "PowerEdge R740, ProLiant DL380 Gen10…" },
      { key: "hypervisor", label: "Hyperviseur", placeholder: "VMware vSphere 7, Hyper-V, Proxmox, Nutanix…", required: true },
      { key: "eos", label: "Fin de maintenance", type: "month", required: true, key_info: true },
      { key: "notes", label: "Notes", placeholder: "âge du parc, datacenter, cloud, VxRail…" },
    ],
  },
  {
    key: "storage",
    title: "Stockage",
    fields: [
      { key: "brand", label: "Marque", placeholder: "Dell PowerStore, NetApp, HPE, Pure…", required: true },
      { key: "model", label: "Modèle", placeholder: "PowerStore 500T, FAS2750…" },
      { key: "capacity", label: "Volumétrie", placeholder: "ex. 40 To utiles, 70 % occupés", required: true },
      { key: "eos", label: "Fin de maintenance", type: "month", required: true, key_info: true },
      { key: "notes", label: "Notes", placeholder: "SAN/NAS, croissance, réplication…" },
    ],
  },
  {
    key: "backup",
    title: "Backup",
    fields: [
      { key: "solution", label: "Solution / marque", placeholder: "Veeam, Commvault, Data Domain, Synology…", required: true },
      { key: "model", label: "Modèle / appliance", placeholder: "DD3300, PowerProtect DM5500…" },
      { key: "capacity", label: "Volumétrie", placeholder: "ex. 60 To, rétention 30 j", required: true },
      { key: "eos", label: "Fin de maintenance", type: "month", required: true, key_info: true },
      { key: "notes", label: "Notes", placeholder: "externalisation, cyber-résilience, PRA…" },
    ],
  },
  {
    key: "bant",
    title: "Projet (BANT)",
    fields: [
      { key: "budget", label: "Budget", placeholder: "montant, enveloppe votée, exercice budgétaire…", required: true },
      { key: "authority", label: "Décisionnaires", placeholder: "qui signe, qui influence (DSI, DAF, DG…)", required: true },
      { key: "need", label: "Besoin", placeholder: "ce qu'ils veulent faire", required: true, multiline: true },
      { key: "gain", label: "Enjeu / gain", placeholder: "en quoi c'est important, ce que ça leur fait gagner", multiline: true },
      { key: "consultation", label: "Début de consultation", type: "month", required: true },
      { key: "deadline", label: "Mise en place / fin de projet", type: "month", required: true },
    ],
  },
  {
    key: "call",
    title: "Appel",
    fields: [
      { key: "interlocutor", label: "Interlocuteur", placeholder: "Prénom Nom" },
      { key: "role", label: "Fonction", placeholder: "DSI, responsable infra…" },
      { key: "next_step", label: "Next step", placeholder: "RDV avec l'AE le…, envoi d'une offre…", multiline: true },
    ],
  },
];

const filled = (v) => typeof v === "string" ? v.trim() !== "" : v != null;

/** Complétude par bloc et indicateurs Dell. */
export function qualifProgress(q = {}, now = new Date()) {
  const sections = {};
  for (const s of QUALIF_SECTIONS) {
    const req = s.fields.filter((f) => f.required);
    const ok = req.filter((f) => filled(q?.[s.key]?.[f.key])).length;
    sections[s.key] = { done: ok, total: req.length, ratio: req.length ? ok / req.length : 0 };
  }

  const eosList = ["servers", "storage", "backup"]
    .map((k) => ({ block: k, eos: q?.[k]?.eos }))
    .filter((e) => filled(e.eos));

  // Opportunité = au moins un bloc d'infra avec marque + fin de maintenance,
  // et le parc serveurs dimensionné (nombre + hyperviseur).
  const s = q.servers || {};
  const infraBlocks = ["servers", "storage", "backup"].filter((k) => {
    const b = q[k] || {};
    return filled(b.eos) && (filled(b.brand) || filled(b.solution));
  });
  const opportunity = infraBlocks.length > 0 && filled(s.count) && filled(s.hypervisor);
  const nextStep = sections.bant.done === sections.bant.total;

  // Fin de maintenance dans les 12 mois (ou déjà passée) = fenêtre de renouvellement.
  const soon = eosList
    .map((e) => ({ ...e, months: monthsUntil(e.eos, now) }))
    .filter((e) => e.months != null && e.months <= 12)
    .sort((a, b) => a.months - b.months);

  const infraTotal = sections.servers.total + sections.storage.total + sections.backup.total;
  const infraDone = sections.servers.done + sections.storage.done + sections.backup.done;

  return {
    sections,
    infra: { done: infraDone, total: infraTotal, ratio: infraDone / infraTotal },
    opportunity,
    nextStep,
    renewalSoon: soon,
  };
}

/** "2027-03" → nombre de mois depuis `now` (négatif si passé). */
export function monthsUntil(ym, now = new Date()) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || "").trim());
  if (!m) return null;
  return (Number(m[1]) - now.getFullYear()) * 12 + (Number(m[2]) - 1 - now.getMonth());
}

/** "2027-03" → "03/2027" ; texte libre conservé tel quel. */
export function fmtMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(v || "").trim());
  return m ? `${m[2]}/${m[1]}` : String(v || "").trim();
}

function line(parts) {
  return parts.filter((p) => filled(p)).join(" · ");
}

/**
 * Texte à coller dans Salesforce (champ Description / Notes du lead).
 * Les blocs vides sont signalés « non qualifié » pour que l'AE voie le trou.
 */
export function salesforceSummary(q = {}, { accountName = "", date = new Date() } = {}) {
  const d = date.toLocaleDateString("fr-FR");
  const s = q.servers || {};
  const st = q.storage || {};
  const b = q.backup || {};
  const p = q.bant || {};
  const c = q.call || {};
  const NQ = "non qualifié";
  const eos = (v) => (filled(v) ? `fin de maintenance ${fmtMonth(v)}` : "");

  const out = [];
  out.push(`QUALIF INFRA${accountName ? ` — ${accountName}` : ""} — ${d}`);
  if (filled(c.interlocutor) || filled(c.role)) {
    out.push(`Interlocuteur : ${line([c.interlocutor, c.role])}`);
  }
  out.push("");
  out.push(`SERVEURS : ${line([
    filled(s.count) ? `${s.count} serveur(s)` : "",
    line([s.brand, s.model]),
    filled(s.hypervisor) ? `hyperviseur ${s.hypervisor}` : "",
    eos(s.eos),
  ]) || NQ}`);
  if (filled(s.notes)) out.push(`  ↳ ${s.notes.trim()}`);
  out.push(`STOCKAGE : ${line([line([st.brand, st.model]), st.capacity, eos(st.eos)]) || NQ}`);
  if (filled(st.notes)) out.push(`  ↳ ${st.notes.trim()}`);
  out.push(`BACKUP : ${line([line([b.solution, b.model]), b.capacity, eos(b.eos)]) || NQ}`);
  if (filled(b.notes)) out.push(`  ↳ ${b.notes.trim()}`);

  const bantFilled = ["budget", "authority", "need", "gain", "consultation", "deadline"].some((k) => filled(p[k]));
  if (bantFilled) {
    out.push("");
    out.push("PROJET (BANT)");
    out.push(`- Budget : ${filled(p.budget) ? p.budget.trim() : NQ}`);
    out.push(`- Décisionnaires : ${filled(p.authority) ? p.authority.trim() : NQ}`);
    out.push(`- Besoin : ${filled(p.need) ? p.need.trim() : NQ}${filled(p.gain) ? ` (enjeu : ${p.gain.trim()})` : ""}`);
    const tl = line([
      filled(p.consultation) ? `consultation ${fmtMonth(p.consultation)}` : "",
      filled(p.deadline) ? `mise en place ${fmtMonth(p.deadline)}` : "",
    ]);
    out.push(`- Timeline : ${tl || NQ}`);
  }
  if (filled(c.next_step)) {
    out.push("");
    out.push(`NEXT STEP : ${c.next_step.trim()}`);
  }
  return out.join("\n");
}

/** Nettoie une fiche reçue du client : seules les clés connues, chaînes bornées. */
export function sanitizeQualif(input = {}) {
  const out = {};
  for (const s of QUALIF_SECTIONS) {
    const src = input?.[s.key];
    if (!src || typeof src !== "object") continue;
    const block = {};
    for (const f of s.fields) {
      const v = src[f.key];
      if (typeof v === "string" && v.trim()) block[f.key] = v.slice(0, 2000);
    }
    if (Object.keys(block).length) out[s.key] = block;
  }
  return out;
}
