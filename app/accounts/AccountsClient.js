"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Button,
  Input,
  Title2,
  Body1,
  Caption1,
  Spinner,
} from "@fluentui/react-components";
import {
  Add24Regular,
  BuildingMultiple24Regular,
  Search24Regular,
  ChevronRight24Regular,
} from "@fluentui/react-icons";
import { SkeletonAccountCards } from "@/components/Skeleton";
import { fetchJson } from "@/lib/fetch-json";

const BRAND = "#5B53E6";
const AMBER = "#F6A623";
const RED = "#C50F1F";

// Chaleur d'un compte (QW2) : dérivée côté serveur des actualités récentes et de
// leur impact (cf. computeAccountHeatFull). Trois paliers lisibles d'un coup d'œil.
function heatMeta(heat) {
  if (heat >= 55) return { label: "Chaud", color: RED };
  if (heat >= 25) return { label: "Tiède", color: AMBER };
  return { label: "Calme", color: "var(--colorNeutralForeground3)" };
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (Number.isNaN(d)) return null;
  if (d <= 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d} j`;
  return `il y a ${Math.floor(d / 30)} mois`;
}

// Carte compte : une seule question — « où en suis-je sur ce compte ? »
function AccountRow({ account, onClick }) {
  const analyzed = !!account.last_refreshed_at;
  const hm = analyzed ? heatMeta(account.heat || 0) : null;
  const fresh = daysAgo(account.last_news_date);
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
        borderBottom: "1px solid var(--colorNeutralStroke2)", cursor: "pointer",
      }}
    >
      <span style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 10,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `color-mix(in srgb, ${BRAND} 12%, transparent)`, color: BRAND,
      }}>
        <BuildingMultiple24Regular />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Body1 style={{ fontWeight: 600, display: "block" }}>{account.name}</Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
          {account.sector || "Secteur à préciser"}
        </Caption1>
      </div>
      {analyzed ? (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
          <span title={`Chaleur ${account.heat || 0}/100`}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: hm.color }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: hm.color }} />
            {hm.label}
          </span>
          {account.news_count > 0 && (
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", whiteSpace: "nowrap" }}>
              {account.news_count} actu{account.news_count > 1 ? "s" : ""}{fresh ? ` · ${fresh}` : ""}
            </Caption1>
          )}
        </div>
      ) : (
        <span style={{
          flexShrink: 0, fontSize: 11, fontWeight: 600, color: "var(--colorNeutralForeground3)",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--colorNeutralForeground4)" }} />
          À analyser
        </span>
      )}
      <ChevronRight24Regular style={{ flexShrink: 0, color: "var(--colorNeutralForeground3)", fontSize: 18 }} />
    </div>
  );
}

// Les données initiales arrivent du composant serveur (rendu SSR).
export default function AccountsClient({ initialAccounts = null, veille = [] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accounts] = useState(initialAccounts);
  const [error, setError] = useState("");
  // Filtre initialisé depuis l'URL : le retour depuis une fiche (router.back)
  // retrouve la liste telle qu'on l'avait laissée.
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Import SIRENE. Le curseur de pagination vit désormais côté serveur
  // (settings.sirene_page) : un état d'écran repartait de zéro à chaque
  // rechargement, et l'import rescannait alors des pages déjà vues.
  const [importing, setImporting] = useState(false);
  const [sireneResult, setSireneResult] = useState(null);

  // Synchronise le filtre dans l'URL sans re-rendu serveur (replaceState :
  // pas de navigation App Router, donc pas de refetch à chaque frappe).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set("q", q); else params.delete("q");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [q]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError("");
    const { ok, data, error: err } = await fetchJson("/api/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (!ok) { setError(err); return; }
    router.push(`/accounts/${data.account.id}`);
  };

  // Inflow de nouveaux comptes depuis l'API publique recherche-entreprises,
  // filtrée sur l'ICP des réglages. L'endpoint existait mais n'avait aucun
  // appelant : le levier documenté pour tenir 200-300 prospects/mois n'était
  // branché nulle part, d'où une liste de comptes figée.
  const importSirene = async () => {
    setImporting(true); setError(""); setSireneResult(null);
    const { ok, data, error: err } = await fetchJson("/api/accounts/import-sirene", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 50 }),   // la page vient du curseur serveur
    });
    setImporting(false);
    if (!ok) { setError(err); return; }
    setSireneResult(data);
    // Les comptes viennent du rendu serveur : sans ce refresh, la liste
    // n'afficherait les nouveaux venus qu'au prochain chargement de page.
    if (data.imported > 0) router.refresh();
  };

  const filtered = (accounts || [])
    .filter((a) =>
      a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
    )
    // Comptes chauds en tête (QW2) : analysés d'abord, triés par chaleur ; les
    // non analysés ensuite, par ordre alphabétique.
    .sort((a, b) => {
      const aa = !!a.last_refreshed_at, bb = !!b.last_refreshed_at;
      if (aa !== bb) return aa ? -1 : 1;
      if (aa && bb && (b.heat || 0) !== (a.heat || 0)) return (b.heat || 0) - (a.heat || 0);
      return a.name.localeCompare(b.name, "fr");
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Header ── */}
      <div>
        <Title2>Comptes</Title2>
        <Body1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
          Les entreprises que tu suis. Ajoute un compte, comprends-le, contacte ses décideurs.
        </Body1>
      </div>

      {/* ── Error ── */}
      {error && (
        <Card style={{ borderLeft: "3px solid #C50F1F", padding: "12px 16px" }}>
          <Body1 style={{ color: "#C50F1F" }}>{error}</Body1>
        </Card>
      )}

      {/* ── Ajouter un compte ── */}
      <Card style={{ padding: "18px 20px" }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 12 }}>Ajouter un compte à suivre</Body1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Input
            placeholder="Nom de l'entreprise (ex. Coopérative U)"
            value={name}
            onChange={(_, d) => setName(d.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            style={{ flex: 1, minWidth: 240 }}
          />
          <Button appearance="primary" disabled={busy || !name.trim()} onClick={create}
            icon={busy ? <Spinner size="tiny" /> : <Add24Regular />}>
            Ajouter
          </Button>
        </div>
      </Card>

      {/* ── Élargir la liste depuis SIRENE ──
          Le nombre de comptes suivis plafonne tout le reste : la veille ne crée
          un signal que pour un compte de cette liste. Ajouter des comptes ne
          coûte RIEN en IA — l'import les crée hors veille (auto_watch=false),
          c'est toi qui décides ensuite lesquels surveiller. */}
      <Card style={{ padding: "18px 20px" }}>
        <Body1 style={{ fontWeight: 700, fontSize: 15, display: "block", marginBottom: 4 }}>
          Élargir la liste depuis SIRENE
        </Body1>
        <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginBottom: 12 }}>
          Base officielle des entreprises, filtrée sur ton ICP (Réglages). Gratuit, sans clé,
          et sans coût IA : les comptes arrivent hors veille, tu choisis lesquels surveiller.
        </Caption1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button appearance="primary" disabled={importing} onClick={importSirene}
            icon={importing ? <Spinner size="tiny" /> : <BuildingMultiple24Regular />}>
            {importing ? "Import en cours…" : "Importer des comptes"}
          </Button>
          <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>
            reprend automatiquement où le dernier import s'est arrêté
          </Caption1>
        </div>

        {sireneResult && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--colorNeutralStroke2)" }}>
            <Body1 style={{ fontWeight: 600, fontSize: 13, display: "block" }}>
              {sireneResult.imported > 0
                ? `${sireneResult.imported} compte${sireneResult.imported > 1 ? "s" : ""} ajouté${sireneResult.imported > 1 ? "s" : ""}`
                : "Aucun nouveau compte sur ce lot"}
            </Body1>
            {/* Le détail explique un lot vide, qui sinon ressemble à une panne :
                hors ICP = le filtre a fait son travail, doublons = déjà suivis. */}
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 2 }}>
              {sireneResult.scanned} scannée{sireneResult.scanned > 1 ? "s" : ""} ·
              {" "}{sireneResult.skipped_icp} hors ICP ·
              {" "}{sireneResult.duplicates} déjà en base
              {sireneResult.has_more
                ? ` · prochain import à la page ${sireneResult.next_page}`
                : " · fin de la base atteinte"}
            </Caption1>
            {sireneResult.sample?.length > 0 && (
              <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block", marginTop: 6 }}>
                {sireneResult.sample.join(" · ")}
              </Caption1>
            )}
          </div>
        )}
      </Card>

      {/* ── Veille (IA3) : actus à fort impact, tous comptes. Zéro coût IA. ── */}
      {veille.length > 0 && (
        <Card style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <Body1 style={{ fontWeight: 800, fontSize: 15 }}>Veille</Body1>
            <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>actualités les plus marquantes de tes comptes (12 mois)</Caption1>
          </div>
          {veille.map((v, i) => (
            <div key={i} onClick={() => router.push(`/accounts/${v.account_id}`)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--colorNeutralStroke2)", cursor: "pointer" }}>
              {v.category && (
                <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, color: AMBER, border: `1px solid ${AMBER}`, borderRadius: 4, padding: "1px 6px" }}>
                  {v.category}
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Body1 style={{ fontWeight: 600, fontSize: 13 }}>{v.title}</Body1>
                <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>
                  {v.account_name}{v.date ? ` · ${v.date}` : ""}
                </Caption1>
              </div>
              <ChevronRight24Regular style={{ flexShrink: 0, color: "var(--colorNeutralForeground3)", fontSize: 18 }} />
            </div>
          ))}
        </Card>
      )}

      {/* ── Next Best Account (IA5, déterministe) : chaleur + joignabilité ── */}
      {(() => {
        const scored = (accounts || [])
          .filter((a) => a.last_refreshed_at)
          .map((a) => ({ a, score: (a.heat || 0) + Math.min(a.reachable_contacts || 0, 3) * 8 }))
          .filter((x) => x.score > 0)
          .sort((x, y) => y.score - x.score)
          .slice(0, 3);
        if (scored.length === 0) return null;
        return (
          <Card style={{ padding: "18px 20px", borderLeft: `3px solid ${BRAND}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <Body1 style={{ fontWeight: 800, fontSize: 15 }}>À travailler en priorité</Body1>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>comptes chauds avec des décideurs joignables</Caption1>
            </div>
            {scored.map(({ a }) => {
              const hm = heatMeta(a.heat || 0);
              const fresh = daysAgo(a.last_news_date);
              const rc = a.reachable_contacts || 0;
              return (
                <div key={a.id} onClick={() => router.push(`/accounts/${a.id}`)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--colorNeutralStroke2)", cursor: "pointer" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: hm.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Body1 style={{ fontWeight: 600 }}>{a.name}</Body1>
                    <Caption1 style={{ color: "var(--colorNeutralForeground3)", display: "block" }}>
                      {hm.label}{a.news_count ? ` · ${a.news_count} actu${a.news_count > 1 ? "s" : ""}${fresh ? ` (${fresh})` : ""}` : ""} · {rc} décideur{rc > 1 ? "s" : ""} joignable{rc > 1 ? "s" : ""}
                    </Caption1>
                  </div>
                  <ChevronRight24Regular style={{ flexShrink: 0, color: "var(--colorNeutralForeground3)", fontSize: 18 }} />
                </div>
              );
            })}
          </Card>
        );
      })()}

      {/* ── Liste ── */}
      {accounts === null ? (
        <Card style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonAccountCards count={6} />
        </Card>
      ) : accounts.length === 0 ? (
        <Card style={{ padding: "40px 24px", textAlign: "center" }}>
          <BuildingMultiple24Regular style={{ fontSize: 40, color: "var(--colorNeutralForeground3)", display: "block", margin: "0 auto 12px" }} />
          <Body1 style={{ color: "var(--colorNeutralForeground2)" }}>
            Aucun compte pour l'instant. Ajoute la première entreprise que tu veux prospecter.
          </Body1>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
            <Input
              placeholder="Filtrer par nom ou secteur…"
              value={q}
              onChange={(_, d) => setQ(d.value)}
              contentBefore={<Search24Regular />}
              style={{ flex: 1, maxWidth: 360 }}
            />
            <Caption1 style={{ color: "var(--colorNeutralForeground3)", marginLeft: "auto" }}>
              {filtered.length} / {accounts.length}
            </Caption1>
          </div>
          {filtered.map((a) => (
            <AccountRow key={a.id} account={a} onClick={() => router.push(`/accounts/${a.id}`)} />
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <Caption1 style={{ color: "var(--colorNeutralForeground3)" }}>Aucun compte ne correspond au filtre.</Caption1>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
