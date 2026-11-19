"use client";

import { useState } from "react";

// Formulaire de connexion classique : champs username/password avec les
// attributs autocomplete standard, pour que Bitwarden et les autres
// gestionnaires de mots de passe proposent le remplissage automatique.
export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) {
        setError(d.error || `Erreur ${res.status}.`);
        setBusy(false);
        return;
      }
      // Retour à la page demandée avant la redirection login (?next=…).
      // Garde anti open-redirect : uniquement un chemin interne ("/…", pas "//…").
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: "8vh auto 0" }}>
      {/* h1 textuel (l'emoji seul faisait lire « renard » comme titre de page
          aux lecteurs d'écran) ; l'emoji reste décoratif. */}
      <div aria-hidden="true" style={{ textAlign: "center", fontSize: 32 }}>🦊</div>
      <h1 style={{ textAlign: "center", fontSize: 22 }}>Connexion à Fox Prospect</h1>

      {error && <div className="alert alert-err">{error}</div>}

      <form onSubmit={submit} method="post" action="/api/login">
        <label htmlFor="username">Identifiant</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn-fox" type="submit" disabled={busy} style={{ flex: 1 }}>
            {busy && <span className="spin" />}
            {busy ? "Connexion…" : "Se connecter"}
          </button>
        </div>
      </form>
      <p className="sub small" style={{ marginTop: 14, textAlign: "center" }}>
        Session mémorisée 1 an sur cet appareil.
      </p>
    </div>
  );
}
