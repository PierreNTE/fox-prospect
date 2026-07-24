"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Title2, Body1, Caption1, Button } from "@fluentui/react-components";
import {
  Pulse24Regular,
  Warning24Regular,
  Target24Regular,
  PlugConnected24Regular,
} from "@fluentui/react-icons";
import { provenance, NIVEAU_COULEUR, LIGNES, TYPES_SIGNAL, dateCourte, estCollectable } from "@/lib/veille";

const BRAND = "#5B53E6";

/* ── Filtres ──────────────────────────────────────────────────────────────
   Trois axes seulement, choisis sur ce qu'un commercial se demande vraiment :
   « est-ce mon rayon ? » (ligne produit), « qu'est-ce que c'est ? » (type),
   « puis-je le citer ? » (fiabilité). Tout le reste est du tri, pas du filtre. */

const FILTRES_LIGNE = [
  { cle: "tout", label: "Toutes lignes" },
  { cle: "csg", label: "Poste de travail" },
  { cle: "isg", label: "Datacenter & IA" },
];

const FILTRES_FIABILITE = [
  { cle: "tout", label: "Tous" },
  { cle: "sur", label: "Citables" },
  { cle: "a_verifier", label: "À vérifier" },
];

function Onglets({ options, valeur, onChange, aria }) {
  return (
    <div role="group" aria-label={aria} style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {options.map((o) => {
        const actif = o.cle === valeur;
        return (
          <button
            key={o.cle}
            type="button"
            onClick={() => onChange(o.cle)}
            aria-pressed={actif}
            style={{
              border: `1px solid ${actif ? BRAND : "var(--colorNeutralStroke2)"}`,
              background: actif ? `color-mix(in srgb, ${BRAND} 10%, transparent)` : "transparent",
              color: actif ? BRAND : "var(--colorNeutralForeground2)",
              fontWeight: actif ? 700 : 500,
              fontSize: 13, borderRadius: 8, padding: "5px 12px", cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Provenance({ methode, confiance }) {
  const p = provenance(methode);
  const couleur = NIVEAU_COULEUR[p.niveau];
  const pct = typeof confiance === "number" ? Math.round(confiance * 100) : null;
  return (
    <span title={p.aide} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 600, color: couleur, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: couleur }} />
      {p.label}
      {p.niveau === "a_verifier" && pct !== null && ` · ${pct} %`}
    </span>
  );
}

function SignalRow({ s, proches, onProches, chargementProches }) {
  const l = LIGNES[s.product_line];
  let domaine = "";
  try { domaine = s.source_url ? new URL(s.source_url).hostname.replace(/^www\./, "") : ""; } catch { domaine = ""; }

  return (
    <div style={{
      display: "flex", gap: 14, padding: "13px 0",
      borderBottom: "1px solid var(--colorNeutralStroke2)",
    }}>
      <div style={{ flexShrink: 0, width: 116 }}>
        {l && s.product_line !== "none" && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: l.couleur, whiteSpace: "nowrap",
            background: `color-mix(in srgb, ${l.couleur} 12%, transparent)`,
            borderRadius: 6, padding: "2px 8px",
          }}>{l.label}</span>
        )}
        {typeof s.priority === "number" && (
          // Le tri n'est plus chronologique : sans ce chiffre, l'ordre des
          // lignes paraîtrait arbitraire.
          <Caption1
            title="Priorité : impact du type × fraîcheur × fiabilité du rattachement"
            style={{ display: "block", marginTop: 6, color: "var(--colorNeutralForeground3)" }}
          >
            priorité {s.priority}
          </Caption1>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {s.account_id ? (
          <Link href={`/accounts/${s.account_id}`}
                style={{ color: BRAND, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
            {s.account_name || "Compte"}
          </Link>
        ) : (
          <Caption1 style={{ fontWeight: 700 }}>{s.account_name}</Caption1>
        )}
        <Body1 style={{ display: "block", marginTop: 2 }}>{s.title || s.detail}</Body1>
        {s.summary && (
          // Le résumé du modèle, distinct du titre de la source : c'est la
          // seule phrase française d'un avis allemand, et elle répond à
          // « pourquoi appeler ce compte maintenant ».
          <Caption1 style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 3 }}>
            {s.summary}
          </Caption1>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 5 }}>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            {TYPES_SIGNAL[s.type] || s.type}
            {s.observed_at && ` · ${dateCourte(s.observed_at)}`}
          </Caption1>
          <Provenance methode={s.match_method} confiance={s.match_confidence} />
          {typeof s.similarite === "number" && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
              proximité {s.similarite} %
            </Caption1>
          )}
          {domaine && (
            <Caption1>
              <a href={s.source_url} target="_blank" rel="noreferrer"
                 style={{ color: BRAND, textDecoration: "none" }}>{domaine} ↗</a>
            </Caption1>
          )}
          {onProches && (
            <button
              type="button"
              onClick={() => onProches(s.id)}
              style={{
                border: "none", background: "none", padding: 0, cursor: "pointer",
                color: BRAND, fontSize: 11, fontWeight: 600,
              }}
            >
              {chargementProches ? "recherche…" : "signaux proches"}
            </button>
          )}
        </div>

        {proches && (
          <div style={{
            marginTop: 8, paddingLeft: 12,
            borderLeft: "2px solid var(--colorNeutralStroke2)",
          }}>
            {proches.length === 0 ? (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                Aucun signal proche — soit c&apos;est un cas isolé, soit les vecteurs
                de comparaison ne sont pas encore calculés.
              </Caption1>
            ) : proches.map((p) => (
              <Caption1 key={p.id} style={{ display: "block", marginTop: 3 }}>
                <span style={{ color: "var(--colorNeutralForeground3)" }}>{p.similarite} % · </span>
                {p.account_name ? <b>{p.account_name} — </b> : null}
                {p.source_url ? (
                  <a href={p.source_url} target="_blank" rel="noreferrer"
                     style={{ color: "inherit", textDecoration: "none" }}>{p.title} ↗</a>
                ) : p.title}
              </Caption1>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Santé des sources ────────────────────────────────────────────────────
   Pas un écran d'administration : une source qui change de format et renvoie
   zéro résultat ne lève AUCUNE erreur. Sans cet affichage, la veille se tarit
   sans que personne ne s'en aperçoive — le mode de panne le plus coûteux. */

function joursDepuis(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function SourcesCard({ sources }) {
  // Une source configurée sans connecteur n'est pas en panne : elle attend son
  // implémentation. Les mélanger ferait passer six fonctionnalités à venir pour
  // six incidents, et noierait les vraies pannes.
  const actives = sources.filter((s) => s.enabled && estCollectable(s.kind));
  const aVenir = sources.filter((s) => s.enabled && !estCollectable(s.kind));

  const enPanne = actives.filter((s) => s.last_error);
  const muettes = actives.filter((s) => {
    const j = joursDepuis(s.last_ok_at);
    return !s.last_error && (j === null || j > 3);
  });
  const saines = actives.filter(
    (s) => !s.last_error && joursDepuis(s.last_ok_at) !== null && joursDepuis(s.last_ok_at) <= 3
  );

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <PlugConnected24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Sources</Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          {saines.length} active{saines.length > 1 ? "s" : ""}
          {enPanne.length > 0 && ` · ${enPanne.length} en échec`}
          {muettes.length > 0 && ` · ${muettes.length} silencieuse${muettes.length > 1 ? "s" : ""}`}
        </Caption1>
      </div>

      {actives.length === 0 && sources.length > 0 ? (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          Aucune source collectable : seuls TED et les flux RSS ont un connecteur.
        </Caption1>
      ) : sources.length === 0 ? (
        // Distinct de « tout va bien » : aucune source lue n'est un problème,
        // pas un état sain.
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          Aucune source lue. Les migrations de veille sont-elles appliquées ?
        </Caption1>
      ) : [...enPanne, ...muettes].length === 0 ? (
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          Toutes les sources actives ont collecté ces trois derniers jours.
        </Caption1>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {enPanne.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Warning24Regular style={{ color: "#C50F1F", flexShrink: 0, width: 16, height: 16, marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <Caption1 style={{ fontWeight: 700, display: "block" }}>{s.label}</Caption1>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>
                  {String(s.last_error).slice(0, 140)}
                </Caption1>
              </div>
            </div>
          ))}
          {muettes.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Warning24Regular style={{ color: "#E8730C", flexShrink: 0, width: 16, height: 16 }} />
              <Caption1>
                <b>{s.label}</b>{" — "}
                {s.last_ok_at ? `rien depuis ${joursDepuis(s.last_ok_at)} jours` : "jamais collecté"}
              </Caption1>
            </div>
          ))}
        </div>
      )}

      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 12 }}>
        {actives.filter((s) => s.account_id).length} flux rattachés à un compte ·
        {" "}{actives.filter((s) => !s.account_id).length} généralistes
        {aVenir.length > 0 && ` · ${aVenir.length} sans connecteur`}
      </Caption1>
    </Card>
  );
}

function CandidatsCard({ candidats }) {
  if (!candidats.length) return null;
  // Un même acheteur publie plusieurs avis : on compte les occurrences plutôt
  // que d'aligner cinquante lignes redondantes. Un acheteur récurrent est un
  // meilleur candidat qu'un acheteur ponctuel.
  const parAcheteur = new Map();
  for (const c of candidats) {
    if (!c.acheteur) continue;
    const e = parAcheteur.get(c.acheteur) || { nom: c.acheteur, n: 0, url: c.url, date: c.published_at };
    e.n += 1;
    parAcheteur.set(c.acheteur, e);
  }
  const liste = [...parAcheteur.values()].sort((a, b) => b.n - a.n).slice(0, 12);

  return (
    <Card style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Target24Regular style={{ color: BRAND }} />
        <Body1 style={{ fontWeight: 700, fontSize: 15 }}>Candidats à la prospection</Body1>
      </div>
      <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 12 }}>
        Acheteurs publics avec un marché informatique en cours, absents du portefeuille.
      </Caption1>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {liste.map((c) => (
          <div key={c.nom} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Caption1 style={{ fontWeight: 700, color: BRAND, minWidth: 26 }}>{c.n}×</Caption1>
            <Caption1 style={{ minWidth: 0 }}>
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer"
                   style={{ color: "inherit", textDecoration: "none" }}>{c.nom} ↗</a>
              ) : c.nom}
            </Caption1>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function VeilleClient({ initialData }) {
  const { signals = [], sources = [], candidats = [], themes = [], erreurs = [] } = initialData || {};
  const [ligne, setLigne] = useState("tout");
  const [fiabilite, setFiabilite] = useState("tout");
  const [type, setType] = useState("tout");

  // ── Recherche sémantique ────────────────────────────────────────────────
  // Un thème est une phrase de recherche vectorisée par le passage quotidien.
  // Le sélectionner remplace la liste par les signaux les plus proches, quelle
  // que soit leur langue — c'est ce qu'un filtre par mot-clé ne sait pas faire.
  const [theme, setTheme] = useState(null);
  const [resultats, setResultats] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreurRecherche, setErreurRecherche] = useState("");
  const [proches, setProches] = useState({});
  const [procheEnCours, setProcheEnCours] = useState(null);

  async function choisirTheme(id) {
    if (id === theme) { setTheme(null); setResultats(null); setErreurRecherche(""); return; }
    setTheme(id);
    setChargement(true);
    setErreurRecherche("");
    try {
      const res = await fetch(`/api/veille/recherche?theme=${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      setResultats(json.signals || []);
    } catch (e) {
      // Affiché, jamais avalé : une recherche muette se confondrait avec une
      // absence de résultat, c'est-à-dire avec « rien ne se passe ».
      setErreurRecherche(e.message);
      setResultats([]);
    } finally {
      setChargement(false);
    }
  }

  async function chercherProches(id) {
    if (proches[id]) { setProches((p) => ({ ...p, [id]: null })); return; }
    setProcheEnCours(id);
    try {
      const res = await fetch(`/api/veille/recherche?proche=${id}`, { cache: "no-store" });
      const json = await res.json();
      setProches((p) => ({ ...p, [id]: res.ok ? (json.signals || []) : [] }));
    } catch {
      setProches((p) => ({ ...p, [id]: [] }));
    } finally {
      setProcheEnCours(null);
    }
  }

  // La liste affichée est celle de la recherche sémantique quand un thème est
  // actif, sinon celle du serveur. Les filtres locaux s'appliquent aux deux.
  const base = resultats || signals;

  const typesPresents = useMemo(() => {
    const vus = [...new Set(base.map((s) => s.type))];
    return [{ cle: "tout", label: "Tous types" },
            ...vus.map((t) => ({ cle: t, label: TYPES_SIGNAL[t] || t }))];
  }, [base]);

  const filtres = useMemo(() => base.filter((s) => {
    if (ligne !== "tout" && s.product_line !== ligne && s.product_line !== "both") return false;
    if (type !== "tout" && s.type !== type) return false;
    if (fiabilite !== "tout") {
      const niveau = provenance(s.match_method).niveau;
      const sur = niveau === "certain" || niveau === "fiable";
      if (fiabilite === "sur" && !sur) return false;
      if (fiabilite === "a_verifier" && sur) return false;
    }
    return true;
  }), [base, ligne, type, fiabilite]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1100 }}>
      <div>
        <Title2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pulse24Regular style={{ color: BRAND }} />
          Veille
        </Title2>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 4 }}>
          Signaux collectés automatiquement sur les comptes suivis, avec leur provenance.
        </Caption1>
      </div>

      {erreurs.length > 0 && (
        <Card style={{ padding: "14px 18px", borderLeft: "3px solid #C50F1F" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Warning24Regular style={{ color: "#C50F1F", flexShrink: 0, marginTop: 1 }} />
            <div>
              <Body1 style={{ fontWeight: 700, display: "block" }}>
                Lecture incomplète — l&apos;écran ci-dessous ne montre pas tout
              </Body1>
              {erreurs.map((e) => (
                <Caption1 key={e} style={{ color: "var(--colorNeutralForeground2)", display: "block", marginTop: 3 }}>
                  {e}
                </Caption1>
              ))}
              <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 6 }}>
                Cause la plus fréquente : une migration Supabase non appliquée.
              </Caption1>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <Card style={{ padding: "18px 20px 20px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
              <Onglets options={FILTRES_LIGNE} valeur={ligne} onChange={setLigne} aria="Ligne de produit" />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Onglets options={typesPresents} valeur={type} onChange={setType} aria="Type de signal" />
                <Onglets options={FILTRES_FIABILITE} valeur={fiabilite} onChange={setFiabilite} aria="Fiabilité" />
              </div>

              {themes.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Thème :</Caption1>
                  <Onglets
                    options={themes.map((t) => ({ cle: t.id, label: t.label }))}
                    valeur={theme}
                    onChange={choisirTheme}
                    aria="Recherche par thème"
                  />
                  {theme && (
                    <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                      {chargement ? "recherche…" : "recherche sémantique — toutes langues"}
                    </Caption1>
                  )}
                </div>
              )}

              {erreurRecherche && (
                <Caption1 style={{ color: "#C50F1F" }}>{erreurRecherche}</Caption1>
              )}
            </div>

            {base.length === 0 && !theme ? (
              <div style={{ padding: "26px 0", textAlign: "center" }}>
                <Body1 style={{ display: "block", fontWeight: 600 }}>Aucun signal pour le moment</Body1>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 6 }}>
                  Le passage quotidien collecte à 04 h 30 UTC. Vérifiez l&apos;état des sources ci-contre.
                </Caption1>
              </div>
            ) : filtres.length === 0 ? (
              <div style={{ padding: "22px 0", textAlign: "center" }}>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
                  {theme
                    ? "Aucun signal proche de ce thème."
                    : "Aucun signal ne correspond à ces filtres."}
                </Caption1>
                <div style={{ marginTop: 10 }}>
                  <Button size="small" appearance="secondary" onClick={() => {
                    setLigne("tout"); setType("tout"); setFiabilite("tout");
                    setTheme(null); setResultats(null); setErreurRecherche("");
                  }}>Tout afficher</Button>
                </div>
              </div>
            ) : (
              <>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 8 }}>
                  {filtres.length} {filtres.length > 1 ? "signaux" : "signal"}
                  {filtres.length !== base.length && ` sur ${base.length}`}
                  {theme && " · classés par priorité, pas par proximité"}
                </Caption1>
                <div style={{ marginTop: 2 }}>
                  {filtres.map((s) => (
                    <SignalRow
                      key={s.id}
                      s={s}
                      proches={proches[s.id]}
                      onProches={chercherProches}
                      chargementProches={procheEnCours === s.id}
                    />
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <SourcesCard sources={sources} />
          <CandidatsCard candidats={candidats} />
        </div>
      </div>
    </div>
  );
}
