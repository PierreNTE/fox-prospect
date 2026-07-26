import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { signalPriority } from "@/lib/scoring";

export const dynamic = "force-dynamic";

/**
 * Recherche sémantique sur les signaux de veille.
 *
 * Deux points de départ, une seule route, parce que c'est la même opération —
 * comparer un vecteur à l'index HNSW — et que la seule différence est l'origine
 * du vecteur :
 *
 *   ?theme=<id>   un thème pré-vectorisé par le passage quotidien ;
 *   ?proche=<id>  un signal déjà en base (« qu'est-ce qui ressemble à ça ? »).
 *
 * Pourquoi pas de texte libre : l'application tourne sur Vercel et ne peut pas
 * embarquer BGE-M3 (2 Go, plusieurs secondes de chargement). Vectoriser une
 * requête à la volée demanderait un service d'embedding en ligne, donc une
 * dépendance payante et une donnée qui sort du périmètre. La recherche par
 * thème couvre le besoin récurrent, la recherche par proximité couvre le besoin
 * ponctuel, et la recherche plein texte (index GIN de v12) reste le bon outil
 * pour un nom propre.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const theme = searchParams.get("theme");
  const proche = searchParams.get("proche");
  const limite = Math.min(Number(searchParams.get("limite")) || 30, 100);

  if (!theme && !proche) {
    return NextResponse.json({ error: "Paramètre theme ou proche requis." }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = theme
    ? await supabase.rpc("veille_signaux_par_theme", {
        p_theme_id: Number(theme), p_limite: limite,
      })
    : await supabase.rpc("veille_signaux_proches", {
        p_signal_id: Number(proche), p_limite: Math.min(limite, 8),
      });

  if (error) {
    // Le cas le plus probable n'est pas une panne mais une migration v16 non
    // appliquée. Le dire explicitement évite de chercher côté vecteurs.
    return NextResponse.json(
      { error: `Recherche sémantique indisponible : ${error.message}` },
      { status: 500 }
    );
  }

  const now = Date.now();
  // Trié par PRIORITÉ, pas par proximité. La proximité dit « ça parle bien du
  // sujet » ; elle ne dit pas par quoi commencer. Un appel d'offres de la
  // semaine passe avant un article de blog qui colle mieux au thème — et la
  // proximité reste affichée pour que le classement soit vérifiable.
  const signals = (data || [])
    .map((s) => ({
      ...s,
      similarite: Math.round((s.similarite ?? 0) * 100),
      priority: signalPriority(s, now),
    }))
    .sort((a, b) => b.priority - a.priority);

  return NextResponse.json({ signals, ...discrimination(signals) });
}

// Écart minimal, en points de proximité, en deçà duquel un classement
// sémantique n'ordonne plus rien.
const ETALEMENT_MINIMAL = 8;

/**
 * Ce résultat distingue-t-il quoi que ce soit ?
 *
 * Mesuré le 26 juillet sur les sept premiers signaux réels : toutes les
 * proximités tenaient entre 35 % et 54 %, quel que soit le thème. « Nomination
 * informatique » plaçait en tête un accord-cadre EDF — alors qu'aucune
 * nomination n'existait en base. Un seuil absolu ne sépare rien dans une bande
 * aussi étroite, et le tri par priorité rendait la liste vraisemblable, donc
 * trompeuse.
 *
 * Plutôt que d'accorder un seuil sur sept points — ce qui reviendrait à régler
 * un instrument sur son propre bruit — on mesure l'étalement et on le dit. Un
 * classement plat s'annonce comme plat.
 */
function discrimination(signals) {
  if (signals.length < 2) return { discrimine: true };
  const valeurs = signals.map((s) => s.similarite);
  const etalement = Math.max(...valeurs) - Math.min(...valeurs);
  return {
    discrimine: etalement >= ETALEMENT_MINIMAL,
    etalement,
    proximiteMin: Math.min(...valeurs),
    proximiteMax: Math.max(...valeurs),
  };
}
