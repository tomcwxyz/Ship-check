import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cloudRuntime } from "../../../../lib/cloudRuntime";
import { verifiedIdentity, subjectHash } from "../../../../lib/neonAuth";

export const dynamic = "force-dynamic";

export default async function ProjectHistory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const h = await headers();
  const identity = await verifiedIdentity(h.get("cookie"));
  if (!identity) redirect("/auth");
  const principal = { schemaVersion: "0.1" as const, authSubjectHash: subjectHash(identity.id) };
  let project: Awaited<ReturnType<ReturnType<typeof cloudRuntime>["historyService"]["getProject"]>>;
  let timeline: Awaited<ReturnType<ReturnType<typeof cloudRuntime>["historyService"]["getTimeline"]>>;
  try {
    project = await cloudRuntime().historyService.getProject(principal,id);
    timeline = await cloudRuntime().historyService.getTimeline(principal,id);
  } catch {
    notFound();
  }
  const latest = timeline.latestAttention;
  const events = [...timeline.events].reverse().slice(0,50);
  return <main className="cloud-shell">
    <header className="masthead">
      <a className="wordmark" href="/dashboard"><span className="wordmark-mark">✳</span><span>ship<span className="wordmark-slash">/</span>check</span></a>
      <nav><a href="/dashboard">← All projects</a></nav>
    </header>
    <section className="dashboard-intro">
      <p className="eyebrow">PROJECT ASSURANCE HISTORY</p>
      <h1>{project.displayName || "Untitled project"}</h1>
      <p>Last scanned {new Date(timeline.latestAt).toLocaleString("en-GB")}. This is evidence from the last reported scan, not a guarantee about what is deployed now.</p>
      <div className="history-stats">
        <div><b>{latest.findings}</b><span>Findings</span></div>
        <div><b>{latest.unverified}</b><span>Still to verify</span></div>
        <div><b>{latest.checkErrors}</b><span>Check errors</span></div>
        <div><b>{latest.coverage.notAssessed}</b><span>Areas not assessed</span></div>
      </div>
    </section>
    <section className="dashboard-panel">
      <p className="section-index">01 / TREND</p>
      <h2>Scan history</h2>
      <p>Only summary assurance metadata is retained. Changed counts do not necessarily mean an issue was fixed; check rule and coverage continuity.</p>
      <div className="event-list">{events.map(({ event, continuity })=><article key={event.scan.identity.value} className="event-item">
        <div><b>{new Date(event.scan.generatedAt).toLocaleString("en-GB")}</b><span>Engine {event.scan.engineVersion} · {event.counts.findings} findings · {event.counts.unverified} unanswered</span></div>
        <small>{continuity ? (continuity.ruleset === "changed" ? "Ruleset changed · " : "") + (continuity.coverageChanged ? "Coverage changed" : "Comparable scan") : "Baseline scan"}</small>
      </article>)}</div>
      {timeline.eventCount > events.length && <p>Showing the latest {events.length} of {timeline.eventCount} scans.</p>}
    </section>
    <footer className="cloud-footer">Ship Check Cloud · <a href="/dashboard">Return to your projects</a></footer>
  </main>;
}
