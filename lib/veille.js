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

// Types de sources qui disposent d'un connecteur. Les autres sont configurées
// en base mais pas encore collectables : les afficher comme « silencieuses »
// revient à signaler une panne là où il n'y a qu'une fonctionnalité à venir,
// et noie les vraies pannes dans le bruit.
export const KINDS_COLLECTABLES = Object.freeze(["ted", "rss"]);

export function estCollectable(kind) {
  return KINDS_COLLECTABLES.includes(kind);
}

// Pays du périmètre. TED renvoie des codes ISO-3 ou NUTS ; l'app affiche de
// l'ISO-2, comme le reste du schéma (companies.country_code).
export const PAYS = Object.freeze({
  FR: "France", DE: "Allemagne", GB: "Royaume-Uni",
  BE: "Belgique", ES: "Espagne", IT: "Italie", NL: "Pays-Bas", LU: "Luxembourg",
});

const ISO3_VERS_ISO2 = Object.freeze({
  FRA: "FR", DEU: "DE", GBR: "GB", BEL: "BE", ESP: "ES", ITA: "IT",
  NLD: "NL", LUX: "LU",
});

/** Code pays ISO-2 depuis une liste de codes ISO-3/NUTS, ou null.
 *
 * Un code NUTS régional (« FRK2 », « DEA1 ») porte le pays sur ses deux
 * premières lettres : s'en servir évite de perdre la moitié des avis, qui ne
 * déclarent qu'une région et jamais le pays.
 */
export function codePays(valeurs) {
  for (const v of Array.isArray(valeurs) ? valeurs : [valeurs]) {
    const code = String(v || "").toUpperCase();
    if (ISO3_VERS_ISO2[code]) return ISO3_VERS_ISO2[code];
    // ISO-2 déjà normalisé, ou code NUTS régional dont les deux premières
    // lettres portent le pays. TED n'émet aujourd'hui que de l'ISO-3 et du
    // NUTS, mais un code à deux lettres ne doit pas ressortir « pays inconnu ».
    if (/^[A-Z]{2}([A-Z0-9]*)$/.test(code) && PAYS[code.slice(0, 2)]) {
      return code.slice(0, 2);
    }
  }
  return null;
}

export function labelPays(code) {
  return PAYS[code] || code || "Pays inconnu";
}

/** Répartit une liste déjà triée en tourniquet entre pays.
 *
 * Sans cela, une liste « les douze acheteurs les plus actifs » affiche douze
 * acheteurs allemands — non parce que le marché allemand vaut mieux, mais parce
 * que l'Allemagne publie plus d'avis. Le tourniquet garantit qu'aucun pays ne
 * confisque la liste, tout en gardant l'ordre de pertinence À L'INTÉRIEUR de
 * chaque pays.
 */
export function equilibrerParPays(elements, total, cle = (e) => e.pays) {
  const groupes = new Map();
  for (const e of elements) {
    const p = cle(e) || "??";
    if (!groupes.has(p)) groupes.set(p, []);
    groupes.get(p).push(e);
  }
  // Les pays les mieux représentés passent en premier dans le tourniquet : à
  // nombre égal de tours, ils gardent leur avance sans l'emporter seuls.
  const files = [...groupes.values()].sort((a, b) => b.length - a.length);
  const sortie = [];
  for (let i = 0; sortie.length < total; i++) {
    let servi = false;
    for (const file of files) {
      if (i < file.length) {
        sortie.push(file[i]);
        servi = true;
        if (sortie.length >= total) break;
      }
    }
    if (!servi) break;   // toutes les files épuisées
  }
  return sortie;
}

/** Un signal retenu par mot-clé seul, qu'aucun modèle n'a encore relu.
 *
 * La distinction n'est pas cosmétique. La provenance dit de QUI parle le
 * document ; elle ne dit pas que c'en est un signal d'achat. Un filtre lexical
 * réglé large confond une formule de présentation avec une annonce — mesuré :
 * « powered by Artificial Intelligence », que le groupe Atos place dans chacun
 * de ses communiqués, a fait passer un sponsoring pour un projet datacenter.
 *
 * Tant que le jugement n'a pas eu lieu (plafond atteint, API indisponible), le
 * dire vaut mieux que de laisser croire à une validation qui n'existe pas.
 */
export function estNonJuge(signal) {
  return !signal?.judged_at;
}

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
