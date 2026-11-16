"use client";

import { useCallback, useEffect, useState, type FormEvent, type ChangeEvent } from "react";
import { importTechnologyInventory } from "./importTechnologyInventory";

type ComponentKind = "ai-model" | "wordpress-core" | "wordpress-plugin" | "wordpress-theme" | "drupal-package";
type Component = { kind: ComponentKind; id: string; version?: string; evidence: "source-declared" };
type Monitoring = {
  enabled: boolean;
  autoDiscovery: boolean;
  components: Component[];
  discoveredComponents: Component[];
  cmsConnectors: Array<{id:string;cms:string;lastSeenAt:string|null;components:number}>;
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
  const [pairingCode, setPairingCode] = useState("");
  async function revokeCmsConnector(connectorId:string) {
    if(!window.confirm("Disconnect this CMS connector and delete its inventory?")) return;
    setBusy(true);setError("");
    try {
      const response=await fetch(endpoint+"/cms-connectors/"+connectorId,{method:"DELETE"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??"Unable to disconnect.");
      await load();setInfo("CMS connector revoked and its inventory deleted.");
    } catch(e) {setError(e instanceof Error?e.message:"Unable to disconnect.");}
    finally {setBusy(false);}
  }
  async function createCmsPairing() {
    setBusy(true);setError("");setPairingCode("");
    try {
      const response=await fetch(endpoint+"/cms-pairing",{method:"POST"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error??"Could not generate pairing code.");
      setPairingCode(result.pairingCode);
    } catch(e) {setError(e instanceof Error?e.message:"Could not connect.");}
    finally {setBusy(false);}
  }

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
    if (file.size > 2_000_000) { setError("The JSON file exceeds the 2 MB limit."); return; }
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

  async function setDiscovery(enabled: boolean) {
    setBusy(true); setError(""); setInfo("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoDiscovery: enabled })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to update discovery.");
      await load();
      setInfo(enabled
        ? "Automatic discovery enabled. Add cloud-technology-sync: true to your Ship Check CI action, then scan."
        : "Automatic discovery disabled. Scan-derived components have been deleted.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update discovery."); }
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
    <p>Optional monitoring for things that change outside your code. Automatic discovery is recommended; manual entry remains available. Discovered source declarations do not prove what is actually deployed.</p>
    {error && <p role="alert" style={{ color: "#9c3328" }}>{error}</p>}
    {info && <p role="status">{info}</p>}
    {!data && !error && <p>Loading monitoring settings…</p>}
    {data && <>
      <p><strong>{data.enabled ? "Monitoring enabled" : "Monitoring off"}</strong> · Your project is only monitored after you save an inventory.</p>
      <div className="technology-notice">
        <h3>Connect your WordPress website</h3>
        <p>Install the read-only Ship Check Connector plugin in WordPress, then pair it here. It automatically sends installed plugins, themes and WordPress versions. No GitHub Actions required.</p>
        <button type="button" disabled={busy} onClick={() => void createCmsPairing()}>Generate WordPress pairing code</button>
        {pairingCode && <div>
          <p>Copy this code into WordPress → Tools → Ship Check within ten minutes. It can only be used once.</p>
          <code style={{overflowWrap:"anywhere"}}>{pairingCode}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(pairingCode)}>Copy code</button>
        </div>}
        {(data.cmsConnectors??[]).map(site=><p key={site.id}>
          <strong>{site.cms==="wordpress"?"WordPress":"Drupal"} connected</strong> · {site.components} components
          {site.lastSeenAt?" · Last synced "+new Date(site.lastSeenAt).toLocaleString("en-GB"):" · Waiting for first sync"}
          {" "}<button type="button" disabled={busy} onClick={() => void revokeCmsConnector(site.id)}>Disconnect</button>
        </p>)}
        <p><a href="https://github.com/tomcwxyz/Ship-check/tree/main/integrations/wordpress/ship-check-connector">Get the WordPress connector</a></p>
      </div>
      <div className="technology-notice">
        <h3>Automatically discover from your scans</h3>
        <p>Recommended: Ship Check finds declared AI models, WordPress components and Drupal packages during a local or CI scan. With your permission, it sends only their identifiers and versions to Cloud — never the source files or full report.</p>
        <p><strong>{data.autoDiscovery ? "Automatic discovery enabled" : "Automatic discovery off"}</strong></p>
        <button type="button" disabled={busy} onClick={() => void setDiscovery(!data.autoDiscovery)}>
          {data.autoDiscovery ? "Turn off automatic discovery" : "Enable automatic discovery"}
        </button>
        {data.autoDiscovery && <>
          <p>In the Ship Check GitHub Action, set <code>cloud-technology-sync: "true"</code> alongside your existing <code>cloud-url</code> and <code>cloud-token</code>. It will update this inventory after each successful complete scan. <a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_AUTO_DISCOVERY.md">Configuration guide</a>.</p>
          <h3>Discovered technologies <span className="count-chip">{data.discoveredComponents.length}</span></h3>
          {data.discoveredComponents.length === 0 && <p>No scan has synced technologies yet. A complete scan with no recognised models or CMS components also results in an empty list.</p>}
          {data.discoveredComponents.map(item => <div key={item.kind + item.id} className="technology-component">
            <span><strong>{item.id}</strong> <small>{item.kind}{item.version ? " · " + item.version : ""} · source declaration, not live verification</small></span>
          </div>)}
        </>}
      </div>
      <details>
        <summary>Prefer to add or import components manually?</summary>
        <p>Manual entries are kept separately from automatic discoveries.</p>
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
          <input value={id} onChange={event => setId(event.target.value)} placeholder={kind === "ai-model" ? "gpt-5" : kind === "drupal-package" ? "drupal/token" : kind === "wordpress-core" ? "wordpress" : "plugin-slug"} required maxLength={160} />
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
        <button type="button" disabled={busy || !components.length} onClick={save}>{busy ? "Saving…" : "Save manual components"}</button>
      </div>
      </details>
      {data.enabled && <div className="technology-actions"><button type="button" disabled={busy} onClick={disable}>Stop all monitoring and delete data</button></div>}
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
