import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cloudRuntime } from "../../lib/cloudRuntime";
import { verifiedIdentity, subjectHash } from "../../lib/neonAuth";
import Tokens from "./Tokens";
import SignOut from "./SignOut";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const headersList = await headers();
  const identity = await verifiedIdentity(headersList.get("cookie"));
  if (!identity) redirect("/auth");
  const principal = {
    schemaVersion: "0.1" as const,
    authSubjectHash: subjectHash(identity.id)
  };
  const runtime = cloudRuntime();
  await runtime.historyService.resolveAccount(principal);
  const list = await runtime.historyService.listProjects(principal, { schemaVersion: "0.1", limit: 100 });
  return <main className="cloud-shell">
    <header className="masthead">
      <a className="wordmark" href="/"><span className="wordmark-mark">✳</span><span>ship<span className="wordmark-slash">/</span>check</span></a>
      <nav><a href="/dashboard">Projects</a><SignOut /></nav>
    </header>
    <section className="dashboard-intro">
      <p className="eyebrow">CLOUD · ALPHA 12 · PRIVATE HISTORY</p>
      <h1>Your projects.</h1>
      <p>Welcome{identity.name ? ", " + identity.name : ""}. See what Ship Check has inspected, when it last ran and what it could not verify.</p>
    </section>
    {list.projects.length === 0 && <Tokens firstProject />}
    <section className="dashboard-panel" id="cloud-projects">
      <p className="section-index">{list.projects.length === 0 ? "02" : "01"} / PROJECT HISTORY</p>
      <h2>Connected projects <span className="count-chip">{list.projects.length}</span></h2>
      {list.projects.length ? <div className="project-grid">
        {list.projects.map(project => <a className="project-card" key={project.id} href={`/dashboard/projects/${project.id}`}>
          <span className="eyebrow">SOURCE-FREE HISTORY</span>
          <h3>{project.displayName || "Untitled project"}</h3>
          <p>{project.identityBasis === "primary-evidence" ? "Identified from scanned source" : "Caller-supplied identity"}</p>
          <small>Updated {new Date(project.updatedAt).toLocaleDateString("en-GB")} · Retained {project.retention}</small>
          <span className="project-link">View scan timeline →</span>
        </a>)}
      </div> : <div className="dashboard-empty">
        <h3>Your first project will appear here after you send a scan summary.</h3>
        <p>First create a <b>Desktop or CI sync token</b> in the connections section above. Then run Ship Check Desktop on your computer and choose <b>Send summary to Cloud</b> after reviewing the results. Only source-free metadata is uploaded, and nothing is sent automatically.</p>
        <p><b>Using the command line instead?</b> <code>npx --yes @good-ship/ship-check@0.0.0-alpha.12 scan .</code> runs a <em>local scan only</em>; it does not connect your account or upload a result. Follow the <a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_MONITORING.md">Cloud monitoring guide</a> for explicit CLI or scheduled CI syncing.</p>
        <p><a href="#cloud-connections">Go to Cloud connection tokens ↑</a></p>
      </div>}
      {list.nextCursor && <p>Showing the first 100 projects. API pagination is available.</p>}
    </section>
    {list.projects.length > 0 && <Tokens />}
    <footer className="cloud-footer">
      Ship Check Alpha 12 · No safety scores · <a href="https://github.com/tomcwxyz/Ship-check">Open source</a>
    </footer>
  </main>;
}
