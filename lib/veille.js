// Vocabulaire d'affichage du module de veille.
//
// Le parti pris d'interface, qui découle directement du pipeline : la PROVENANCE
// d'un signal prime sur sa date. Un signal issu de la salle de presse d'un
// compte est certain — la source ne parle que de lui. Un signal issu de la
// presse généraliste repose sur la reconnaissance d'un nom dans un texte, la
// méthode qui a produit cinq faux rattachements sur six lors des premiers
// essais. Les afficher pareil reviendrait à mentir au commercial.

export const PROVENANCE = Object.freeze({
  source: {
    label: "Salle de presse",
    aide: "Flux dédié à ce compte : le rattachement ne peut pas se tromper.",
    niveau: "certain",
  },
  lei: { label: "Identifiant LEI", aide: "Rapproché par identifiant officiel.", niveau: "certain" },
  siren: { label: "SIREN", aide: "Rapproché par identifiant officiel.", niveau: "certain" },
  registre: { label: "Registre", aide: "Rapproché via un registre officiel.", niveau: "certain" },
  domaine: { label: "Domaine", aide: "Rapproché par nom de domaine.", niveau: "fiable" },
  manuel: { label: "Manuel", aide: "Rattaché à la main.", niveau: "certain" },
  nom: {
    label: "Similarité de nom",
    aide: "Rapproché par ressemblance de raison sociale — à vérifier.",
    niveau: "a_verifier",
  },
  mention: {
    label: "Mention presse",
    aide: "Nom du compte repéré dans un article généraliste — à vérifier.",
    niveau: "a_verifier",
  },
});

export const NIVEAU_COULEUR = Object.freeze({
  certain: "#16A34A",
  fiable: "#0EA5E9",
  a_verifier: "#E8730C",
});

// Lignes de produit Dell. Ce que le commercial cherche d'abord : « est-ce du
// poste de travail ou du datacenter ? ».
export const LIGNES = Object.freeze({
  csg: { label: "Poste de travail", court: "CSG", couleur: "#0EA5E9" },
  isg: { label: "Datacenter & IA", court: "ISG", couleur: "#8B5CF6" },
  both: { label: "Mixte", court: "Mixte", couleur: "#64748B" },
  none: { label: "Hors périmètre", court: "—", couleur: "#94A3B8" },
});

export const TYPES_SIGNAL = Object.freeze({
  projet: "Projet",
  rfp_it: "Appel d'offres",
  concurrence: "Concurrence",
  nomination: "Nomination",
  recrutement: "Recrutement",
  levee: "Opération financière",
  incident: "Incident",
  reglementaire: "Réglementaire",
  prise_de_parole: "Prise de parole",
  autre: "Autre",
});

export function provenance(methode) {
  return PROVENANCE[methode] || {
    label: methode || "Inconnue",
    aide: "Méthode de rattachement non renseignée.",
    niveau: "a_verifier",
  };
}

/** Date courte, sans dépendance : « 2026-07-24 » → « 24 juil. ». */
export function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
