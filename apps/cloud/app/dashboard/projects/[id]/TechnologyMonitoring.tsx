"use client";

import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import { importTechnologyInventory } from "./importTechnologyInventory";

type ComponentKind = "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
type Component = { kind: ComponentKind; id: string; version?: string; evidence: "source-declared" };
type Monitoring = {
  enabled: boolean;
  components: Component[];
  alerts: Array<{
    identity: string; provider: string; componentId: string; status: string; scope: string;
    summary: string; sourceUrl: string; effectiveDate: string | null; lastSeenAt: string;
  }>;
  feeds: Array<{ provider: string; checkedAt: string; successAt: string | null; errorCode: string | null }>;
};

const OPTIONS: Array<[ComponentKind, string]> = [
  ["ai-model", "AI model"],
  ["wordpress-core", "WordPress core"],
  ["wordpress-plugin", "WordPress plugin"],
  ["wordpress-theme", "WordPress theme"],
  ["drupal-package", "Drupal package"]
];

export default function TechnologyMonitoring({ projectId }: { projectId: string }) {
  const endpoint = "/api/intelligence/projects/" + projectId;
  const [data, setData] = useState<Monitoring | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [kind, setKind] = useState<ComponentKind>("ai-model");
  const [id, setId] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Cannot load monitoring.");
    setData(json);
    setComponents(json.components);
  }, [endpoint]);

  useEffect(() => {
    let live = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Cannot load monitoring.");
        if (live) {
          setData(json);
          setComponents(json.components);
        }
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Could not load monitoring."); });
    return () => { live = false; };
  }, [endpoint]);

  function addComponent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const cleanId = id.trim();
    const cleanVersion = version.trim();
    if (!/^[A-Za-z0-9._/-]{1,160}$/.test(cleanId) || (cleanVersion && !/^[A-Za-z0-9._+/-]{1,80}$/.test(cleanVersion))) {
      setError("Use a model or package identifier and optional plain version number.");
      return;
    }
    if (components.some(item => item.kind === kind && item.id === cleanId)) {
      setError("This component is already listed.");
      return;
    }
    if (components.length >= 50) { setError("Maximum 50 components per project."); return; }
    setComponents(items => [...items, { kind, id: cleanId, ...(cleanVersion ? { version: cleanVersion } : {}), evidence: "source-declared" }]);
    setId("");
    setVersion("");
    setInfo("Inventory changed. Save to enable or update monitoring.");
  }

  async function handleInventoryFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setInfo("");
    if (file.size > 512_000) { setError("The JSON file exceeds the 512 KB limit."); return; }
    try {
      const imported = importTechnologyInventory(await file.text());
      const merged = new Map<string, Component>();
      for (const item of [...components, ...imported]) merged.set(item.kind + ":" + item.id, item);
      if (merged.size > 50) throw new Error("This would exceed the 50-component limit. Reduce the inventory first.");
      setComponents([...merged.values()]);
      setInfo("Imported " + imported.length + " components locally. Review them below, then save to enable monitoring.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not import JSON."); }
  }

  async function save() {
    setBusy(true); setError(""); setInfo("");
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ components })
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to save inventory.");
      await load();
      setInfo("Monitoring enabled. Alerts will appear after a successful scheduled provider check.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save."); }
    finally { setBusy(false); }
  }

  async function disable() {
    if (!window.confirm("Stop monitoring and permanently delete this project's component list and alerts?")) return;
    setBusy(true); setError(""); setInfo("");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Unable to stop.");
      await load();
      setInfo("Monitoring disabled. Its inventory and alerts have been deleted.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to stop."); }
    finally { setBusy(false); }
  }

  return <section className="dashboard-panel" aria-labelledby="technology-heading">
    <p className="section-index">02 / TECHNOLOGY MONITORING</p>
    <h2 id="technology-heading">Keep an eye on your dependencies</h2>
    <p>Optional monitoring for things that may change outside your code. Enter a model ID or CMS component from your project. This is a <strong>source-declared inventory</strong> – it does not prove what is deployed. No source code is uploaded.</p>
    {error && <p role="alert" style={{ color: "#9c3328" }}>{error}</p>}
    {info && <p role="status">{info}</p>}
    {!data && !error && <p>Loading monitoring settings…</p>}
    {data && <>
      <p><strong>{data.enabled ? "Monitoring enabled" : "Monitoring off"}</strong> · Your project is only monitored after you save an inventory.</p>
      <details className="technology-import">
        <summary>Import a component list</summary>
        <p>Choose a Drupal <code>composer.lock</code>, a JSON file from <code>wp plugin list --format=json</code>, or a Ship Check inventory JSON. The file is read in your browser; only the recognised component IDs and versions are saved when you choose Save.</p>
        <input type="file" accept=".json,.lock,application/json" aria-label="Import technology inventory JSON" onChange={handleInventoryFile} disabled={busy} />
      </details>
      <form onSubmit={addComponent} className="technology-entry">
        <label>Technology
          <select value={kind} onChange={event => setKind(event.target.value as ComponentKind)}>
            {OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Model or component ID
          <input value={id} onChange={event => setId(event.target.value)} placeholder={kind === "ai-model" ? "gpt-5" : kind === "drupal-package" ? "drupal/token" : "plugin-slug"} required maxLength={160} />
        </label>
        <label>Version (CMS only, optional)
          <input value={version} onChange={event => setVersion(event.target.value)} placeholder="1.2.3" maxLength={80} />
        </label>
        <button type="submit" disabled={busy}>Add</button>
      </form>
      {components.length > 0 && <div className="technology-components">
        {components.map(item => <div className="technology-component" key={item.kind + item.id}>
          <span><strong>{item.id}</strong> <small>{item.kind}{item.version ? " · " + item.version : ""}</small></span>
          <button type="button" disabled={busy} onClick={() => { setComponents(items => items.filter(candidate => candidate !== item)); setInfo("Inventory changed. Save to apply."); }}>Remove</button>
        </div>)}
      </div>}
      <div className="technology-actions">
        <button type="button" disabled={busy || !components.length} onClick={save}>{busy ? "Saving…" : data.enabled ? "Save inventory" : "Enable monitoring"}</button>
        {data.enabled && <button type="button" disabled={busy} onClick={disable}>Stop monitoring and delete data</button>}
      </div>
      {data.enabled && <>
        <h3>Provider intelligence</h3>
        <p>OpenAI and Anthropic retirement notices are checked against provider information. Drupal security notices use official feeds; WordPress notices require a signed Wordfence Intelligence connection. A match does not establish which version is installed on a live site.</p>
        {data.feeds.length === 0 && <p>Provider checks have not run yet.</p>}
        {data.feeds.map(feed => <p key={feed.provider}><strong>{feed.provider}</strong> · {feed.errorCode ? "Unavailable: " + feed.errorCode : "Checked " + new Date(feed.checkedAt).toLocaleString("en-GB")} {feed.successAt && feed.errorCode ? " · Last successful check " + new Date(feed.successAt).toLocaleString("en-GB") : ""}</p>)}
        <h3>Relevant notices</h3>
        {data.alerts.length === 0 && <p>No matched notices are stored. This is not evidence that every dependency is safe.</p>}
        {data.alerts.map(alert => <article key={alert.identity} className="technology-notice">
          <p><strong>{alert.componentId}</strong> · {alert.status} · {alert.scope}</p>
          <p>{alert.summary}</p>
          <small>Last confirmed {new Date(alert.lastSeenAt).toLocaleString("en-GB")}{alert.effectiveDate ? " · Dated " + alert.effectiveDate : ""} · <a href={alert.sourceUrl} target="_blank" rel="noreferrer">Provider notice</a></small>
        </article>)}
      </>}
    </>}
  </section>;
}
