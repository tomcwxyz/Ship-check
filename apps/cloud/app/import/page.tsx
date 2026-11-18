"use client";

import {useEffect,useState} from "react";

const KEY="ship-check-pending-monitoring-handoff";
type Handoff={
  schemaVersion:"ship-check-monitoring-handoff/0.1";
  metadata:unknown;
  inventory:{schemaVersion:"ship-check-technology-inventory/0.1";components:unknown[];sourceInventory:string;siteHints?:unknown[]};
};

function decodeHandoff(encoded:string):Handoff {
  if(!/^[A-Za-z0-9_-]{1,24000}$/.test(encoded)) throw new Error("This scan handoff is too large or invalid.");
  const input=encoded.replace(/-/g,"+").replace(/_/g,"/");
  const text=new TextDecoder().decode(Uint8Array.from(atob(input),char=>char.charCodeAt(0)));
  const value:unknown=JSON.parse(text);
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("Unrecognised scan handoff.");
  const data=value as Record<string,unknown>;
  if(data.schemaVersion!=="ship-check-monitoring-handoff/0.1"||
    !data.inventory||typeof data.inventory!=="object"||Array.isArray(data.inventory)||
    !Array.isArray((data.inventory as Record<string,unknown>).components))
    throw new Error("Unrecognised scan handoff.");
  return data as Handoff;
}

export default function ImportScanPage() {
  const [handoff,setHandoff]=useState<Handoff|null>(null);
  const [name,setName]=useState("My monitored project");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<string|null>(null);
  useEffect(()=>{
    try {
      const encoded=window.location.hash.slice(1);
      const saved=encoded||window.sessionStorage.getItem(KEY)||"";
      if(!saved) return;
      const parsed=decodeHandoff(saved);
      setHandoff(parsed);
      window.sessionStorage.setItem(KEY,saved);
      if(encoded) window.history.replaceState(null,"","/import");
    } catch {
      window.sessionStorage.removeItem(KEY);
      setError("This scan handoff is invalid. Run a fresh scan in Playground.");
    }
  },[]);
  async function save(){
    if(!handoff||busy||!name.trim())return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/monitoring/import",{
        method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
        body:JSON.stringify({handoff,displayName:name.trim()})
      });
      if(response.status===401){
        // Browser session storage holds source-free data only, temporarily,
        // so sign-in never needs a report, code path or token in its URL.
        window.location.assign("/auth?next=/import");
        return;
      }
      const body:unknown=await response.json();
      if(!response.ok||!body||typeof body!=="object") throw new Error("Cloud could not accept this scan.");
      const receipt=body as {projectId?:unknown;error?:unknown};
      if(typeof receipt.projectId!=="string") throw new Error(typeof receipt.error==="string"?receipt.error:"Cloud could not accept this scan.");
      window.sessionStorage.removeItem(KEY);
      setResult(receipt.projectId);
      setHandoff(null);
    } catch(e) {
      setError(e instanceof Error?e.message:"Cloud could not accept this scan. Please retry.");
    } finally {setBusy(false);}
  }
  return <main className="cloud-shell">
    <header className="masthead"><a className="wordmark" href="/dashboard"><span className="wordmark-mark">✳</span>ship/check</a>
      <nav><a href="/dashboard">Your projects</a></nav>
    </header>
    <section className="dashboard-intro">
      <p className="eyebrow">SCAN → CLOUD</p>
      <h1>Keep this monitored.</h1>
      <p>Continue from the Playground into your own Cloud account. Only a source-free scan summary, identified AI models and CMS components, and public website hints are shared. We never transfer the full report or source files.</p>
    </section>
    <section className="dashboard-panel">
      {result ? <>
        <h2>Monitoring enabled.</h2>
        <p>Your project is in Cloud. You'll see new notices independently of future scans. Re-run and share a scan to update its discovered inventory.</p>
        <p><a className="cloud-cta" href={"/dashboard/projects/"+result}>View monitored project</a></p>
      </> : handoff ? <>
        <h2>Save this project</h2>
        <p>{handoff.inventory.components.length} source-declared technologies · {(handoff.inventory.siteHints??[]).length} website fingerprints. Empty inventories are still valid: a scan may find nothing that can be monitored.</p>
        <label style={{display:"grid",gap:8,maxWidth:450}}>Project name
          <input style={{padding:12,borderRadius:7,border:"1px solid #aab9ad",font:"inherit"}} value={name} maxLength={120} onChange={e=>setName(e.target.value)} />
        </label>
        <p>Monitoring is optional. Selecting the button below gives Cloud permission to retain this minimal inventory and compare it with provider notices. Public CMS recognition does not verify plugin versions.</p>
        <button className="auth-primary" type="button" onClick={()=>void save()} disabled={busy||!name.trim()}>{busy?"Connecting…":"Keep this project monitored"}</button>
        <p className="auth-help">You'll be asked to sign in if necessary. No GitHub Actions or repository access is required.</p>
      </> : <>
        <h2>No scan ready to connect</h2>
        <p>Run a scan in the <a href="https://check.good-ship.co.uk">Playground</a>, then choose <strong>Keep monitored</strong> in the results.</p>
      </>}
      {error&&<p role="alert" className="auth-error">{error}</p>}
    </section>
  </main>;
}
