import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Liste curée de grandes entreprises françaises reconnues pour des DSI
// d'envergure (CAC 40 + grands employeurs / acteurs publics). Noms et secteurs
// PUBLICS et vérifiables : aucune donnée inventée. Sert d'amorce ; l'analyse
// (recherche web) reste lancée compte par compte ou en lot par l'utilisateur.
const GRANDS_COMPTES = [
  ["TotalEnergies", "Énergie"],
  ["EDF", "Énergie"],
  ["Engie", "Énergie"],
  ["Orange", "Télécoms"],
  ["BNP Paribas", "Banque"],
  ["Crédit Agricole", "Banque"],
  ["Société Générale", "Banque"],
  ["BPCE", "Banque"],
  ["Crédit Mutuel", "Banque"],
  ["AXA", "Assurance"],
  ["CNP Assurances", "Assurance"],
  ["Groupama", "Assurance"],
  ["Covéa (MAAF, MMA, GMF)", "Assurance"],
  ["Sanofi", "Pharmacie / Santé"],
  ["L'Oréal", "Cosmétiques"],
  ["LVMH", "Luxe"],
  ["Kering", "Luxe"],
  ["Hermès", "Luxe"],
  ["Air Liquide", "Industrie / Chimie"],
  ["Schneider Electric", "Industrie / Énergie"],
  ["Saint-Gobain", "Matériaux"],
  ["Vinci", "BTP / Concessions"],
  ["Bouygues", "BTP / Télécoms / Médias"],
  ["Eiffage", "BTP / Concessions"],
  ["Stellantis", "Automobile"],
  ["Renault Group", "Automobile"],
  ["Michelin", "Industrie / Pneumatiques"],
  ["Valeo", "Équipementier auto"],
  ["Forvia (Faurecia)", "Équipementier auto"],
  ["Airbus", "Aéronautique / Défense"],
  ["Safran", "Aéronautique / Défense"],
  ["Thales", "Défense / Électronique"],
  ["Dassault Aviation", "Aéronautique / Défense"],
  ["Dassault Systèmes", "Logiciel"],
  ["Capgemini", "ESN / Conseil IT"],
  ["Sopra Steria", "ESN / Conseil IT"],
  ["Atos", "ESN / Services IT"],
  ["Worldline", "Paiement / Fintech"],
  ["OVHcloud", "Cloud / Hébergement"],
  ["Veolia", "Environnement / Eau"],
  ["Danone", "Agroalimentaire"],
  ["Pernod Ricard", "Spiritueux"],
  ["Carrefour", "Grande distribution"],
  ["Les Mousquetaires (Intermarché)", "Grande distribution"],
  ["Auchan", "Grande distribution"],
  ["Groupe Casino", "Grande distribution"],
  ["Decathlon", "Distribution / Sport"],
  ["Accor", "Hôtellerie"],
  ["Sodexo", "Restauration / Services"],
  ["Edenred", "Services prépayés"],
  ["Publicis", "Communication / Médias"],
  ["Legrand", "Industrie électrique"],
  ["Alstom", "Ferroviaire"],
  ["SNCF", "Transport"],
  ["RATP", "Transport"],
  ["La Poste", "Services postaux / Banque"],
  ["Pôle emploi (France Travail)", "Service public"],
  ["Ubisoft", "Jeux vidéo"],
];

export async function POST() {
  const supabase = getSupabase();

  const { data: existing } = await supabase.from("accounts").select("name");
  const known = new Set((existing || []).map((a) => a.name.toLowerCase().trim()));

  const toInsert = GRANDS_COMPTES
    .filter(([name]) => !known.has(name.toLowerCase().trim()))
    .map(([name, sector]) => ({ name, sector }));

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, total: GRANDS_COMPTES.length });
  }

  const { data, error } = await supabase.from("accounts").insert(toInsert).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ inserted: data.length, total: GRANDS_COMPTES.length });
}
