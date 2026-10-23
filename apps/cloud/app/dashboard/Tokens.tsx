"use client";

import { useEffect, useState } from "react";

type StoredToken = {
  id: string;
  tokenPrefix: string;
  label?: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
};

export default function Tokens({ firstProject = false }: { firstProject?: boolean }) {
  const [tokens, setTokens] = useState<StoredToken[]>([]);
  const [latest, setLatest] = useState("");
  const [label, setLabel] = useState(firstProject ? "Windows Desktop" : "My coding agent");
  const [scope, setScope] = useState<"history:read" | "history:sync">(firstProject ? "history:sync" : "history:read");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/v1/tokens", { cache: "no-store", credentials: "same-origin" });
    if (response.ok) {
      const data = await response.json() as { tokens?: StoredToken[] };
      setTokens(data.tokens ?? []);
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function create() {
    setError(""); setLatest(""); setBusy(true);
    try {
      const response = await fetch("/api/v1/tokens", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "0.1",
          label,
          scopes: [scope],
          expiresInDays: 90
        })
      });
      const data = await response.json() as { token?: string; message?: string };
      if (!response.ok || !data.token) throw new Error(data.message || "Could not issue token");
      setLatest(data.token);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token request failed");
    } finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE", credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Token could not be revoked.");
      await refresh();
      setLatest("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Token revocation failed");
    } finally { setBusy(false); }
  }

  return <section className="dashboard-panel" id="cloud-connections">
    <p className="section-index">{firstProject ? "01" : "02"} / CONNECTIONS</p>
    <h2>{firstProject ? "Connect your desktop." : "Connect your tools."}</h2>
    <p>{firstProject ? "Create a Desktop or CI sync token below. Copy it into Ship Check Desktop, run a local scan, then choose Send summary to Cloud. Nothing is uploaded automatically." : "Choose an upload token for Desktop or CI, or a separate read-only token for an MCP/AI agent. Tokens expire after 90 days and can be revoked here."}</p>
    <div className="token-controls">
      <label>Label <input maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} /></label>
      <label>Permission <select value={scope} onChange={e=>setScope(e.target.value as typeof scope)}>
        <option value="history:sync">Upload scan summaries — Desktop or CI</option>
        <option value="history:read">Read project history — MCP / agent</option>
      </select></label>
      <button type="button" onClick={create} disabled={busy || !label.trim()}>Create token</button>
    </div>
    {latest && <div className="token-secret" role="status">
      <b>Save this token now — it will not be shown again.</b>
      <code>{latest}</code>
      <button type="button" onClick={() => void navigator.clipboard.writeText(latest)}>Copy token</button>
      {scope === "history:sync" ? <p><b>Next:</b> Open Ship Check Desktop, find <b>Keep a record, if you choose</b>, paste this token in <b>Cloud sync token</b>, then run a scan and choose <b>Send summary to Cloud</b>. You can also use it as a CI secret for scheduled metadata syncs. This token does not grant read-only MCP access.</p> : <p><b>Read-only MCP:</b> Configure <code>https://cloud-check.good-ship.co.uk/mcp</code> with this bearer token in your agent. This token cannot upload scans.</p>}
    </div>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {tokens.length > 0 && <ul className="token-list">{tokens.map(t=><li key={t.id}>
      <div><b>{t.label || t.tokenPrefix}</b><small>{t.tokenPrefix} · {t.scopes.join(", ")} · expires {new Date(t.expiresAt).toLocaleDateString("en-GB")}{t.revokedAt ? " · Revoked" : ""}</small></div>
      {!t.revokedAt && <button type="button" disabled={busy} onClick={()=>void revoke(t.id)}>Revoke</button>}
    </li>)}</ul>}
  </section>;
}
