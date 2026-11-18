"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { importTechnologyInventory } from "./importTechnologyInventory";
import {
  monitoringOverview,
  type ComponentKind,
  type MonitoredComponent,
  type MonitoringState
} from "./monitoringPresentation";

const KINDS: Array<[ComponentKind, string]> = [
  ["ai-model", "AI model"],
  ["wordpress-core", "WordPress core"],
  ["wordpress-plugin", "WordPress plugin"],
  ["wordpress-theme", "WordPress theme"],
  ["drupal-package", "Drupal package"]
];
const componentName = (kind: ComponentKind) => KINDS.find(item => item[0] === kind)?.[1] ?? kind;
type SetupMode = "scan" | "website" | null;

function SetupChoice({
  number, title, description, active, onClick
}: {number:string;title:string;description:string;active:boolean;onClick:()=>void}) {
  return <button className={"monitor-choice" + (active ? " is-selected" : "")}
    type="button" aria-expanded={active} onClick={onClick}>
    <span className="monitor-choice-number">{number}</span>
    <span className="monitor-choice-content"><strong>{title}</strong><span>{description}</span></span>
    <span className="monitor-choice-arrow" aria-hidden="true">{active ? "−" : "+"}</span>
  </button>;
}

function TechnologyRow({ item, origin }: { item: MonitoredComponent; origin:"scan"|"manual" }) {
  return <div className="monitor-item">
    <div className="monitor-item-name"><strong>{item.id}</strong><span>{componentName(item.kind)}{item.version ? " · " + item.version : ""}</span></div>
    <span className="monitor-item-source">{origin === "scan" ? "From scan" : "Added manually"}</span>
  </div>;
}

function Summary({ data }: {data: MonitoringState}) {
  const overview=monitoringOverview(data);
  return <div className="monitor-summary">
    <span className={"monitor-summary-dot" + (overview.hasInventory ? " is-active" : "")} aria-hidden="true"/>
    <div className="monitor-summary-copy">
      <span className="monitor-kicker">Current status</span>
      <h3>{overview.title}</h3>
      <p>{overview.description}</p>
    </div>
    {overview.hasInventory && <div className="monitor-summary-counts" aria-label="Items registered for monitoring">
      {overview.sourceCount>0 && <div><strong>{overview.sourceCount}</strong><span>From scans or manual entry</span></div>}
      {overview.installedCount>0 && <div><strong>{overview.installedCount}</strong><span>From connected websites</span></div>}
    </div>}
  </div>;
}

export default function TechnologyMonitoring({ projectId }: { projectId: string }) {
  const endpoint = "/api/intelligence/projects/" + projectId;
  const [data, setData] = useState<MonitoringState | null>(null);
  const [components, setComponents] = useState<MonitoredComponent[]>([]);
  const [kind, setKind] = useState<ComponentKind>("ai-model");
  const [id, setId] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [setup, setSetup] = useState<SetupMode>(null);
  const [cms, setCms] = useState<"wordpress" | "drupal">("wordpress");
  const [pairingCode, setPairingCode] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(endpoint, {cache:"no-store"});
    const json: MonitoringState & {error?:string} = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Could not load monitoring.");
    setData(json);
    setComponents(json.components);
  },[endpoint]);

  useEffect(() => {
    let cancelled=false;
    fetch(endpoint,{cache:"no-store"}).then(async response=>{
      const json:MonitoringState & {error?:string}=await response.json();
      if(!response.ok) throw new Error(json.error??"Could not load monitoring.");
      if(!cancelled){setData(json);setComponents(json.components);}
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not load monitoring.");});
    return ()=>{cancelled=true;};
  },[endpoint]);

  async function refresh(){
    setBusy(true);setError("");setInfo("");
    try{await load();setInfo("Monitoring status refreshed.");}
    catch(e){setError(e instanceof Error?e.message:"Could not refresh.");}
    finally{setBusy(false);}
  }

  async function createPairing(){
    setBusy(true);setError("");setInfo("");setPairingCode("");
    try{
      const response=await fetch(endpoint+"/cms-pairing",{method:"POST"});
      const result:{pairingCode?:string;error?:string}=await response.json();
      if(!response.ok||!result.pairingCode)throw new Error(result.error??"Could not create pairing code.");
      setPairingCode(result.pairingCode);
    }catch(e){setError(e instanceof Error?e.message:"Could not create pairing code.");}
    finally{setBusy(false);}
  }

  async function disconnect(connectorId:string){
    if(!window.confirm("Disconnect this website and remove its verified inventory?"))return;
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(endpoint+"/cms-connectors/"+encodeURIComponent(connectorId),{method:"DELETE"});
      const result:{error?:string}=await response.json();
      if(!response.ok)throw new Error(result.error??"Could not disconnect website.");
      await load();setInfo("Website disconnected. Its saved inventory was removed.");
    }catch(e){setError(e instanceof Error?e.message:"Could not disconnect website.");}
    finally{setBusy(false);}
  }

  function addComponent(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError("");setInfo("");
    const cleanId=id.trim(),cleanVersion=version.trim();
    if(!/^[A-Za-z0-9._/-]{1,160}$/.test(cleanId)||(cleanVersion&&!/^[A-Za-z0-9._+/-]{1,80}$/.test(cleanVersion))){
      setError("Enter a valid model or package ID and an optional plain version.");return;
    }
    if(components.some(x=>x.kind===kind&&x.id===cleanId)){setError("That component is already in your list.");return;}
    if(components.length>=50){setError("The manual list has a maximum of 50 components.");return;}
    setComponents(items=>[...items,{kind,id:cleanId,...(cleanVersion?{version:cleanVersion}:{}),evidence:"source-declared"}]);
    setId("");setVersion("");setInfo("Added locally. Save the manual list to update Cloud monitoring.");
  }

  async function importFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";
    if(!file)return;
    setError("");setInfo("");
    if(file.size>2_000_000){setError("The file must be smaller than 2 MB.");return;}
    try{
      const imported=importTechnologyInventory(await file.text());
      const combined=new Map<string,MonitoredComponent>();
      for(const item of [...components,...imported])combined.set(item.kind+":"+item.id,item);
      if(combined.size>50)throw new Error("The merged list exceeds the 50-component limit.");
      setComponents([...combined.values()]);
      setInfo("Imported "+imported.length+" items locally. Review and save your manual list.");
    }catch(e){setError(e instanceof Error?e.message:"Could not import file.");}
  }

  async function save(){
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(endpoint,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({components})});
      const result:{error?:string}=await response.json();
      if(!response.ok)throw new Error(result.error??"Could not save components.");
      await load();setInfo("Manual technologies saved to monitoring.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save components.");}
    finally{setBusy(false);}
  }

  async function enableScanSharing(){
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(endpoint,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({autoDiscovery:true})});
      const result:{error?:string}=await response.json();
      if(!response.ok)throw new Error(result.error??"Could not enable scan synchronisation.");
      await load();setInfo("Scan synchronisation enabled. You can now send recognised technologies to Cloud.");
    }catch(e){setError(e instanceof Error?e.message:"Could not enable scan synchronisation.");}
    finally{setBusy(false);}
  }

  async function stopMonitoring(){
    if(!window.confirm("Stop monitoring, disconnect websites and remove all tracked technologies and notices? Your scan history will remain."))return;
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(endpoint,{method:"DELETE"});
      const result:{error?:string}=await response.json();
      if(!response.ok)throw new Error(result.error??"Could not stop monitoring.");
      await load();setPairingCode("");setSetup(null);
      setInfo("Monitoring stopped and its inventories removed. Scan history remains.");
    }catch(e){setError(e instanceof Error?e.message:"Could not stop monitoring.");}
    finally{setBusy(false);}
  }

  const overview=data?monitoringOverview(data):null;
  const allItems=data?[
    ...data.discoveredComponents.map(item=>({item,origin:"scan" as const})),
    ...data.components.map(item=>({item,origin:"manual" as const}))
  ]:[];
  const visibleItems=showAll?allItems:allItems.slice(0,8);
  const failedFeeds=data?.feeds.filter(feed=>feed.errorCode)??[];
  const connectUrl=cms==="wordpress"
    ? "/connectors/ship-check-wordpress-connector.zip"
    : "/connectors/ship-check-drupal-connector.zip";

  return <section className="dashboard-panel monitor-panel" aria-labelledby="technology-heading">
    <header className="monitor-header">
      <p className="section-index">02 / MONITORING</p>
      <h2 id="technology-heading">Monitoring</h2>
      <p>Stay informed about AI model retirements and WordPress or Drupal security notices.</p>
    </header>
    {error&&<p className="monitor-feedback is-error" role="alert">{error}</p>}
    {info&&<p className="monitor-feedback" role="status">{info}</p>}
    {!data&&!error&&<p role="status">Loading monitoring…</p>}

    {data&&overview&&<>
      <Summary data={data}/>

      {(overview.hasInventory||data.cmsConnectors.length>0||data.siteHints.length>0)&&
        <section className="monitor-section" aria-labelledby="monitored-heading">
          <div className="monitor-section-heading">
            <div><h3 id="monitored-heading">Your technologies</h3><p>What Cloud knows about this project, and where that information came from.</p></div>
            <button type="button" className="monitor-text-btn" onClick={()=>void refresh()} disabled={busy}>Refresh status</button>
          </div>
          {allItems.length>0&&<div className="monitor-items">
            {visibleItems.map(({item,origin})=><TechnologyRow key={origin+":"+item.kind+":"+item.id} item={item} origin={origin}/>)}
            {allItems.length>8&&<button className="monitor-show-more" type="button" onClick={()=>setShowAll(!showAll)}>
              {showAll?"Show fewer":"Show all "+allItems.length+" source-declared entries"}
            </button>}
          </div>}
          {data.cmsConnectors.length>0&&<div className="monitor-items">
            {data.cmsConnectors.map(site=><div className="monitor-item" key={site.id}>
              <div className="monitor-item-name">
                <strong>{site.cms==="wordpress"?"WordPress website":"Drupal website"}</strong>
                <span>{site.lastSeenAt?site.components+" installed components · Last synced "+new Date(site.lastSeenAt).toLocaleString("en-GB"):"Connected · Waiting for first sync"}</span>
              </div>
              <button type="button" className="monitor-text-btn" onClick={()=>void disconnect(site.id)} disabled={busy}>Disconnect</button>
            </div>)}
          </div>}
          {data.siteHints.length>0&&<div className="monitor-hints">
            <strong>Suggested website technology</strong>
            {data.siteHints.map(hint=><p key={hint.cms}>
              {hint.confidence==="likely"?"Likely ":"Possibly "}{hint.cms==="wordpress"?"WordPress":"Drupal"} based on public-page signals.
              Installed extensions are not verified. Connect the website for an accurate inventory.
            </p>)}
          </div>}
        </section>}

      {overview.hasInventory&&<section className="monitor-section" aria-labelledby="notices-heading">
        <div className="monitor-section-heading"><div><h3 id="notices-heading">Notices</h3>
          <p>Relevant information from supported security and model providers.</p></div></div>
        {data.alerts.length>0?<div className="monitor-items">
          {data.alerts.map(alert=><article key={alert.identity} className="monitor-alert">
            <div className="monitor-alert-top"><strong>{alert.componentId}</strong><span>{alert.status}</span></div>
            <p>{alert.summary}</p>
            <small>{alert.effectiveDate?"Dated "+alert.effectiveDate+" · ":""}Last checked {new Date(alert.lastSeenAt).toLocaleDateString("en-GB")} · <a href={alert.sourceUrl} target="_blank" rel="noreferrer">Source notice</a></small>
          </article>)}
        </div>:<p className="monitor-notice-empty">No matching notices are recorded at present. This is not proof that everything is secure.</p>}
        {failedFeeds.length>0&&<p className="monitor-feed-warning" role="status">
          Some intelligence feeds have reported errors ({failedFeeds.map(feed=>feed.provider).join(", ")}). Check their status under Advanced settings below.
        </p>}
        {data.feeds.length===0&&<p className="monitor-feed-warning">Provider checks have not reported a result yet.</p>}
      </section>}

      <section className="monitor-section monitor-add-section" aria-labelledby="monitor-start-heading">
        <div className="monitor-section-heading"><div>
          <h3 id="monitor-start-heading">{overview.hasInventory?"Add more to monitoring":"Start monitoring"}</h3>
          <p>Choose how Ship Check should identify what to watch.</p>
        </div></div>
        <div className="monitor-choices">
          <SetupChoice number="01" title="From a scan" description="Identify AI models and CMS components in a project." active={setup==="scan"} onClick={()=>setSetup(setup==="scan"?null:"scan")}/>
          <SetupChoice number="02" title="Connect a website" description="Get the installed WordPress or Drupal inventory." active={setup==="website"} onClick={()=>setSetup(setup==="website"?null:"website")}/>
        </div>
        {setup==="scan"&&<div className="monitor-setup-panel">
          <h4>Monitor technologies found in a scan</h4>
          <p>Run Ship Check with CLI/npm or Desktop, then choose to share the recognised technologies with Cloud. Your source code and full report stay local.</p>
          <div className="monitor-action-row">
            <a className="monitor-btn monitor-btn-primary" href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_MONITORING.md" target="_blank" rel="noreferrer">Scan and connect instructions</a>
            <a className="monitor-btn monitor-btn-secondary" href="https://check.good-ship.co.uk" target="_blank" rel="noreferrer">Open Playground</a>
          </div>
          <p className="monitor-small">The direct scan-to-monitor flow requires a scanner release with Cloud monitoring support. Existing scans are still available without monitoring.</p>
        </div>}
        {setup==="website"&&<div className="monitor-setup-panel">
          <h4>Connect your website</h4>
          <p>Install a small connector on a website you administer. It sends an inventory of installed components to Cloud so notices can be matched more accurately.</p>
          <div className="monitor-cms-tabs" role="group" aria-label="Website platform">
            <button type="button" className={cms==="wordpress"?"is-selected":""} aria-pressed={cms==="wordpress"} onClick={()=>{setCms("wordpress");setPairingCode("");}}>WordPress</button>
            <button type="button" className={cms==="drupal"?"is-selected":""} aria-pressed={cms==="drupal"} onClick={()=>{setCms("drupal");setPairingCode("");}}>Drupal</button>
          </div>
          <ol className="monitor-steps">
            <li><strong>Install the connector.</strong>
              <p>Download the {cms==="wordpress"?"WordPress plugin ZIP, then use Plugins → Add Plugin → Upload Plugin.":"Drupal module ZIP, extract it into your site's custom modules directory, then enable the module."}</p>
              <a className="monitor-btn monitor-btn-primary" href={connectUrl} download>Download {cms==="wordpress"?"WordPress":"Drupal"} connector</a>
            </li>
            <li><strong>Pair with Cloud.</strong>
              <p>Generate a one-time code and enter it under {cms==="wordpress"?"Tools → Ship Check in WordPress.":"Configuration → System → Ship Check Connector in Drupal."} It expires after ten minutes.</p>
              <button className="monitor-btn monitor-btn-secondary" type="button" disabled={busy} onClick={()=>void createPairing()}>{busy?"Generating…":"Generate pairing code"}</button>
              {pairingCode&&<div className="monitor-pairing">
                <span>One-time pairing code</span>
                <code id="monitor-pairing-code">{pairingCode}</code>
                <button type="button" className="monitor-text-btn" onClick={()=>void navigator.clipboard.writeText(pairingCode).then(()=>setInfo("Pairing code copied.")).catch(()=>setError("Copy failed. Select the code to copy it manually."))}>Copy code</button>
              </div>}
            </li>
            <li><strong>Confirm the inventory.</strong>
              <p>After the first synchronisation, the connected website appears in Your technologies above.</p>
              <button className="monitor-text-btn" type="button" onClick={()=>void refresh()} disabled={busy}>Refresh connection status</button>
            </li>
          </ol>
          <p className="monitor-small"><a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CMS_CONNECTORS.md" target="_blank" rel="noreferrer">Full installation instructions</a> · These connectors are in alpha and have not yet completed live-site integration testing.</p>
        </div>}
      </section>

      <details className="monitor-advanced">
        <summary>Advanced settings and manual options <span aria-hidden="true">+</span></summary>
        <div className="monitor-advanced-body">
          <section aria-labelledby="manual-heading">
            <h3 id="manual-heading">Manual technologies</h3>
            <p>Add a model or CMS component directly, or import a JSON inventory. Manual entries are stored separately from scan discoveries.</p>
            <label className="monitor-file-label">Import an inventory file <input type="file" accept=".json,.lock,application/json" aria-label="Import technology inventory JSON" onChange={event=>void importFile(event)} disabled={busy}/></label>
            <form onSubmit={addComponent} className="technology-entry">
              <label>Technology
                <select value={kind} onChange={event=>setKind(event.target.value as ComponentKind)}>
                  {KINDS.map(([value,label])=><option value={value} key={value}>{label}</option>)}
                </select>
              </label>
              <label>Component ID
                <input value={id} onChange={event=>setId(event.target.value)} placeholder={kind==="ai-model"?"gpt-5":kind==="drupal-package"?"drupal/token":"plugin-slug"} required maxLength={160}/>
              </label>
              <label>Version (optional)
                <input value={version} onChange={event=>setVersion(event.target.value)} maxLength={80} placeholder="1.2.3"/>
              </label>
              <button type="submit" className="monitor-btn monitor-btn-secondary">Add</button>
            </form>
            {components.length>0&&<div className="monitor-items">
              {components.map(item=><div className="monitor-item" key={item.kind+":"+item.id}>
                <div className="monitor-item-name"><strong>{item.id}</strong><span>{componentName(item.kind)}{item.version?" · "+item.version:""}</span></div>
                <button type="button" className="monitor-text-btn" onClick={()=>{setComponents(list=>list.filter(x=>x!==item));setInfo("Manual list changed. Save to apply.");}}>Remove</button>
              </div>)}
            </div>}
            <button type="button" className="monitor-btn monitor-btn-primary" disabled={busy||!components.length} onClick={()=>void save()}>Save manual list</button>
            {components.length===0&&<p className="monitor-small">Add an item before saving. To clear all monitoring data, use Stop monitoring below.</p>}
          </section>
          <section aria-labelledby="ci-heading">
            <h3 id="ci-heading">Existing CI workflows</h3>
            <p>GitHub Actions are optional. If you already use the Ship Check Action, it can also share recognised technologies once this project permits scan synchronisation.</p>
            {data.autoDiscovery
              ? <p className="monitor-small">Scan synchronisation is permitted for this project.</p>
              : <button type="button" className="monitor-btn monitor-btn-secondary" disabled={busy} onClick={()=>void enableScanSharing()}>Enable scan synchronisation</button>}
            <p className="monitor-small"><a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_AUTO_DISCOVERY.md" target="_blank" rel="noreferrer">Advanced CI instructions</a></p>
          </section>
          <section aria-labelledby="feed-heading">
            <h3 id="feed-heading">Intelligence source health</h3>
            {data.feeds.length===0?<p>Provider checks have not run yet.</p>:
              <div className="monitor-feed-list">{data.feeds.map(feed=><p key={feed.provider}>
                <strong>{feed.provider}</strong><span>{feed.errorCode?"Unavailable: "+feed.errorCode:"Checked "+new Date(feed.checkedAt).toLocaleString("en-GB")}</span>
              </p>)}</div>}
            <p className="monitor-small">A missing notice does not guarantee safety. Model and CMS advisories can be incomplete or delayed.</p>
          </section>
          {data.enabled&&<section className="monitor-danger" aria-labelledby="stop-monitoring-heading">
            <h3 id="stop-monitoring-heading">Stop monitoring</h3>
            <p>Revoke website connections and remove saved inventories and notices. Your scan history stays available.</p>
            <button type="button" className="monitor-btn monitor-btn-danger" disabled={busy} onClick={()=>void stopMonitoring()}>Stop monitoring and remove data</button>
          </section>}
        </div>
      </details>
    </>}
  </section>;
}
