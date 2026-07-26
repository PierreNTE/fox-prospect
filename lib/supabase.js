import { createClient } from "@supabase/supabase-js";

let client;

export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false },
        global: {
          // Next remplace `fetch` par une version qui MÉMORISE les réponses.
          // Appliquée à Supabase, elle transforme la base de données en cache
          // figé : la requête part une fois, sa réponse est resservie ensuite.
          //
          // Observé le 26 juillet, et coûteux à diagnostiquer : la recherche
          // sémantique renvoyait sept signaux tous à 100 % de proximité —
          // exactement le résultat qu'elle donnait à l'époque où la base
          // contenait des vecteurs de test identiques. Les vrais vecteurs
          // étaient en place, le SQL renvoyait des valeurs correctes, la
          // bibliothèque appelée hors de Next aussi. Seule la route servait du
          // périmé, y compris après suppression du dossier de cache — la copie
          // en mémoire du serveur survivait.
          //
          // `dynamic = "force-dynamic"` ne suffit PAS : il rend la route
          // dynamique, il ne désarme pas la mémorisation des `fetch` qu'elle
          // effectue. Le neutraliser ici plutôt que route par route évite
          // qu'un prochain appel réintroduise le défaut en silence.
          fetch: (url, options = {}) => fetch(url, { ...options, cache: "no-store" }),
        },
      }
    );
  }
  return client;
}
