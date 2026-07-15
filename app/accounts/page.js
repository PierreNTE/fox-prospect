"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const BRAND = "#5B53E6";
const GREEN = "#107C10";

// Carte compte : une seule question — « où en suis-je sur ce compte ? »
function AccountRow({ account, onClick }) {
  const analyzed = !!account.last_refreshed_at;
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
      <span style={{
        flexShrink: 0, fontSize: 11, fontWeight: 600,
        color: analyzed ? GREEN : "var(--colorNeutralForeground3)",
        display: "inline-flex", alignItems: "center", gap: 5,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: analyzed ? GREEN : "var(--colorNeutralForeground4)" }} />
        {analyzed ? "Analysé" : "À analyser"}
      </span>
      <ChevronRight24Regular style={{ flexShrink: 0, color: "var(--colorNeutralForeground3)", fontSize: 18 }} />
    </div>
  );
}

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/accounts");
    const d = await res.json();
    if (d.error) setError(d.error);
    else setAccounts(d.accounts);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true); setError("");
    const res = await fetch("/api/accounts", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || d.error) { setError(d.error || `Erreur ${res.status}.`); return; }
    router.push(`/accounts/${d.account.id}`);
  };

  const filtered = (accounts || []).filter((a) =>
    a.name.toLowerCase().includes(q.toLowerCase()) || (a.sector || "").toLowerCase().includes(q.toLowerCase())
  );

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
