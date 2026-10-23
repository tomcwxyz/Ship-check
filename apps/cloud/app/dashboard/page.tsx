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
    <section className="dashboard-panel">
      <p className="section-index">01 / PROJECT HISTORY</p>
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
        <h3>No projects connected yet</h3>
        <p>Run Ship Check in your repository or CI, then explicitly sync the metadata using a <b>CI metadata sync</b> token below. Cloud does not scan your private repositories by itself.</p>
        <code>npx --yes @good-ship/ship-check@0.0.0-alpha.12 scan .</code>
        <p>Read the <a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_MONITORING.md">Cloud monitoring guide</a> for a scheduled GitHub Action workflow.</p>
      </div>}
      {list.nextCursor && <p>Showing the first 100 projects. API pagination is available.</p>}
    </section>
    <Tokens />
    <footer className="cloud-footer">
      Ship Check Alpha 12 · No safety scores · <a href="https://github.com/tomcwxyz/Ship-check">Open source</a>
    </footer>
  </main>;
}
