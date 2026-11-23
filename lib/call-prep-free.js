// Fiche d'approche 100 % gratuite (sans IA).
//
// Même format que la fiche IA (normalizeCallPrep) pour que l'écran ne change
// pas, mais construite uniquement à partir de données publiques déjà collectées
// gratuitement : SIRENE / RNE (identité, dirigeants), BODACC (procédures,
// repreneur), collecte web (site, standard, emails, outils, DNS), BOAMP
// (marchés publics IT), Google Actualités (RSS) et contacts déjà trouvés.
// Les messages sont des modèles personnalisés par règles (taille, secteur,
// outils repérés, signaux) — rien n'est inventé : un champ inconnu reste vide.
import { effectifLabel } from "@/lib/sirene";
import { leadAngle } from "@/lib/lead-priority";
import { isPublicBuyer } from "@/lib/boamp";
import { normalizeCallPrep } from "@/lib/prompts-call-prep";

const EFFECTIF_MIN = { "0": 0, "1": 1, "2": 3, "3": 6, "11": 10, "12": 20, "21": 50, "22": 100, "31": 200, "32": 250, "41": 500, "42": 1000, "51": 2000, "52": 5000, "53": 10000 };

export function sizeBand(effectifCode) {
  const n = EFFECTIF_MIN[String(effectifCode || "").replace(/^0(?=\d)/, "")];
  if (n == null) return "inconnue";
  if (n < 10) return "tpe";
  if (n < 50) return "petite";
  if (n < 250) return "moyenne";
  return "grande";
}

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || "";
const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());

/** Postes à viser selon la taille et le type d'organisation. */
export function rolesToTarget(band, publicBuyer) {
  if (publicBuyer) return ["Directeur général des services (DGS)", "Responsable informatique / DSI", "Élu ou adjoint en charge du numérique"];
  return {
    tpe: ["Gérant / dirigeant (décide seul)", "Prestataire informatique ou infogérant"],
    petite: ["Responsable informatique (souvent seul)", "DAF / responsable administratif", "Gérant"],
    moyenne: ["Responsable informatique / DSI", "Administrateur systèmes et réseaux", "DAF"],
    grande: ["DSI", "Responsable infrastructure / production", "RSSI"],
    inconnue: ["Responsable informatique", "Dirigeant"],
  }[band];
}

/** Accroche principale, du signal le plus fort au plus générique. */
export function pickAngle({ detail, intel, publicBuyer }) {
  const tech = new Set((intel?.tech || []).map((t) => t.label));
  const openTender = (intel?.public_contracts || []).find((n) => n.ouvert);
  if (openTender) {
    return { key: "appel_offres", text: `Appel d'offres informatique ouvert jusqu'au ${openTender.limite} (« ${openTender.objet.slice(0, 90)} ») : vérifier le lot et se positionner, seul ou via un partenaire.` };
  }
  if (tech.has("VMware")) {
    return { key: "vmware", text: "Environnement VMware cité : les changements de licences depuis le rachat par Broadcom poussent beaucoup d'équipes à revoir leur virtualisation — bon moment pour parler serveurs, hyperviseur et fin de maintenance." };
  }
  if (tech.has("NetApp") || tech.has("Synology") || tech.has("QNAP") || tech.has("HPE")) {
    return { key: "stockage", text: "Stockage en place repéré : demander l'âge de la baie / du NAS, sa fin de support et le volume utilisé — porte d'entrée stockage et sauvegarde." };
  }
  if (tech.has("Veeam") || tech.has("Acronis") || tech.has("Veritas")) {
    return { key: "sauvegarde", text: "Logiciel de sauvegarde repéré : parler de la cible de sauvegarde (immuabilité, reprise après rançongiciel) et du serveur qui l'héberge." };
  }
  if (detail?.successor?.confidence === "forte") {
    return { key: "fusion", text: `Rapprochement récent (${detail.successor.reason_label}) : l'intégration des deux SI est souvent l'occasion de consolider serveurs, stockage et postes.` };
  }
  return { key: "secteur", text: leadAngle({ naf: detail?.naf, publicBuyer }) };
}

function ouverture(angleKey, band, publicBuyer) {
  if (angleKey === "appel_offres") return "Qui suit ce marché côté informatique, et le cahier des charges est-il déjà figé ?";
  if (angleKey === "vmware") return "Où en êtes-vous de votre réflexion sur la virtualisation depuis les nouvelles licences VMware ?";
  if (angleKey === "stockage") return "De quand date votre stockage actuel, et êtes-vous encore sous maintenance ?";
  if (angleKey === "sauvegarde") return "Si un rançongiciel chiffrait vos serveurs demain, combien de temps vous faudrait-il pour repartir ?";
  if (publicBuyer) return "Passez-vous par une centrale d'achat ou par vos propres marchés pour le matériel informatique ?";
  if (band === "tpe") return "Qui s'occupe de votre informatique aujourd'hui : vous-même ou un prestataire ?";
  return "De quand datent vos serveurs actuels, et la fin de maintenance arrive-t-elle bientôt ?";
}

/**
 * @param {{ account: object, contacts?: object[], sender?: object }} input
 * @returns fiche au format normalizeCallPrep, + mode: "gratuit"
 */
export function buildFreeCallPrep({ account, contacts = [], sender = {} }) {
  const d = account.health_detail || {};
  const w = account.web_intel || {};
  const name = d.successor?.confidence === "forte" ? d.successor.name : (d.sirene_name || account.name);
  const shortName = cap(name);
  const publicBuyer = isPublicBuyer(d);
  const band = sizeBand(d.effectif);
  const tranche = effectifLabel(String(d.effectif || "").replace(/^0(?=\d)/, ""));
  const angle = pickAngle({ detail: d, intel: w, publicBuyer });
  const question = ouverture(angle.key, band, publicBuyer);
  const signer = [sender?.sender_name, sender?.sender_role, "Dell Technologies"].filter(Boolean).join("\n");
  const me = sender?.sender_name ? firstName(sender.sender_name) : "";

  // Interlocuteurs : contacts déjà trouvés (scraping, organigramme), puis dirigeants légaux.
  const ranked = [...contacts]
    .filter((c) => c.first_name || c.last_name)
    .sort((a, b) => Number(/informati|dsi|syst|r[ée]seau|infra|it\b/i.test(b.role || "")) - Number(/informati|dsi|syst|r[ée]seau|infra|it\b/i.test(a.role || "")))
    .slice(0, 3)
    .map((c) => ({
      prenom: c.first_name || "", nom: c.last_name || "", poste: c.role || "", linkedin_url: c.linkedin_url || "",
      source: c.source || "Contacts du compte", confiance: c.linkedin_url ? "moyenne" : "basse",
      pourquoi: /informati|dsi|syst|r[ée]seau|infra/i.test(c.role || "") ? "Poste informatique" : "Contact déjà identifié sur le compte",
    }));
  const known = new Set(ranked.map((c) => `${c.prenom} ${c.nom}`.toLowerCase()));
  const leaders = (d.dirigeants || [])
    .filter((x) => !known.has(String(x.name || "").toLowerCase()))
    .slice(0, Math.max(0, 4 - ranked.length))
    .map((x) => {
      const parts = String(x.name || "").trim().split(/\s+/);
      return {
        prenom: cap(parts.slice(0, -1).join(" ")), nom: cap(parts.slice(-1).join(" ")), poste: x.role || "Dirigeant",
        linkedin_url: "", source: "Dirigeant légal (RNE)", confiance: "moyenne",
        pourquoi: band === "tpe" || band === "petite" ? "Dans une petite structure, le dirigeant décide souvent des achats informatiques" : "Peut orienter vers le responsable informatique",
      };
    });
  const people = [...ranked, ...leaders];
  const target = people[0];
  const hello = target?.prenom ? `Bonjour ${target.prenom},` : "Bonjour,";

  const leader = (w.leaders_emails || [])[0];
  const pattern = leader?.confidence === "motif observé" ? "motif observé sur le site" : leader ? "motif courant, à vérifier" : null;
  const fixe = (w.phones || []).find((p) => p.kind === "fixe" || p.kind === "voip") || (w.phones || [])[0];

  // Actus : appels d'offres ouverts, événements BODACC, presse (RSS).
  const actus = [
    ...(w.public_contracts || []).filter((n) => n.ouvert).slice(0, 1).map((n) => ({ titre: `Appel d'offres : ${n.objet}`, date: n.date, source: "BOAMP" })),
    ...(d.successor?.confidence === "forte" ? [{ titre: `${d.successor.reason_label} : continue sous « ${d.successor.name} »`, date: String(d.successor.date || "").slice(0, 10), source: "BODACC" }] : []),
    ...(d.procedure ? [{ titre: `Procédure collective : ${d.procedure_nature || d.procedure}`, date: d.procedure_date || "", source: "BODACC" }] : []),
    ...(w.news || []).map((n) => ({ titre: n.titre, date: n.date, source: n.source || "Presse" })),
  ].slice(0, 3);

  const techList = (w.tech || []).filter((t) => t.cat !== "Services (DNS)").map((t) => t.label);
  const it = band === "tpe"
    ? "Probablement gérée par le dirigeant ou un prestataire : demander au standard qui s'occupe de l'informatique."
    : techList.length ? `Outils cités publiquement : ${techList.slice(0, 5).join(", ")}.` : null;

  const ctx = [
    tranche ? `${tranche} salariés` : null,
    d.commune ? `à ${cap(d.commune)}` : null,
    d.etablissements > 1 ? `${d.etablissements} établissements` : null,
  ].filter(Boolean).join(", ");

  const objet = angle.key === "appel_offres" ? `Votre appel d'offres informatique — ${shortName}`
    : angle.key === "vmware" ? `${shortName} — virtualisation après les nouvelles licences VMware`
    : angle.key === "stockage" ? `${shortName} — votre stockage et sa fin de support`
    : angle.key === "sauvegarde" ? `${shortName} — reprise après incident`
    : `${shortName} — vos serveurs et leur fin de maintenance`;

  const corps = [
    hello,
    "",
    `Je suis ${sender?.sender_name || "commercial"} chez Dell Technologies et je m'occupe des entreprises ${publicBuyer ? "et collectivités " : ""}de votre secteur.`,
    angle.text,
    "",
    question,
    "",
    "Si le sujet est d'actualité chez vous, je vous propose un échange de 15 minutes cette semaine ou la suivante. Sinon, pouvez-vous m'indiquer la bonne personne ?",
    "",
    "Bien à vous,",
    signer,
  ].join("\n");

  const prep = normalizeCallPrep({
    identite: [shortName, ctx, d.categorie ? `catégorie ${d.categorie}` : null].filter(Boolean).join(" — "),
    coordonnees: {
      site: w.site?.url || account.website || null,
      standard: fixe?.number || null,
      email_generique: (w.emails?.generic || [])[0] || null,
      domaine_email: w.dns?.has_mx && account.domain ? account.domain : null,
      format_email: leader ? `${leader.email} (exemple : ${leader.name})` : null,
      format_source: pattern,
      adresse: d.commune ? cap(d.commune) : null,
    },
    contacts: people,
    it_externalisee: it,
    postes_a_chercher: rolesToTarget(band, publicBuyer),
    actus,
    angle: `${angle.text} Question d'ouverture : « ${question} »`,
    messages: {
      email: { objet, corps },
      linkedin_invitation: `${hello} je suis ${me || "commercial"} chez Dell Technologies et j'accompagne les ${publicBuyer ? "collectivités" : "entreprises"} de votre secteur sur leurs serveurs, stockage et sauvegarde. Ravi d'échanger avec vous.`.slice(0, 300),
      linkedin_message: [
        `Merci pour la mise en relation${target?.prenom ? `, ${target.prenom}` : ""}.`,
        angle.text,
        question,
        "Seriez-vous ouvert(e) à un court échange ?",
      ].join(" "),
      relance: {
        objet: `Re: ${objet}`,
        corps: [
          hello, "",
          "Je me permets de revenir vers vous suite à mon message de la semaine dernière.",
          question, "",
          "Si ce n'est pas vous qui suivez ce sujet, un simple nom me suffit.", "",
          "Bien à vous,", signer,
        ].join("\n"),
      },
    },
    standard: {
      phrases: [
        `Bonjour, ${me ? `${me} de ` : ""}Dell Technologies. Je cherche à joindre la personne qui s'occupe de l'informatique chez ${shortName} : c'est en interne ou chez un prestataire ?`,
        target?.nom ? `Pourriez-vous me passer ${[target.prenom, target.nom].filter(Boolean).join(" ")} ? C'est au sujet de vos serveurs et de leur maintenance.` : "Pourriez-vous me passer le responsable informatique ? C'est au sujet de vos serveurs et de leur maintenance.",
        "Je comprends. Quel est le meilleur moment pour le joindre, et a-t-il une adresse email directe ?",
      ],
      si_mail: "Pouvez-vous me donner son adresse email, ou celle du service informatique ? Je lui écris deux lignes pour qu'il me rappelle s'il est concerné.",
    },
    sources: [
      d.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${d.siren}` : null,
      w.site?.url || null,
      ...(w.public_contracts || []).slice(0, 2).map((n) => n.url).filter(Boolean),
      ...(w.news || []).slice(0, 3).map((n) => n.url).filter(Boolean),
    ].filter(Boolean),
  });
  return { ...prep, mode: "gratuit" };
}
