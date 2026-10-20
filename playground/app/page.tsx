"use client";

import { useMemo, useState } from "react";
import type { Coverage, Finding, ScanReport } from "../lib/types";

type Mode = "github" | "site";
type Panel = "findings" | "verify" | "coverage";
const demo: ScanReport = {
  schemaVersion: "0.1", tool: { name: "ship-check", version: "demo" },
  project: { path: "example/illustrative-next-app", fileCount: 28 },
  generatedAt: "2026-10-20T12:00:00.000Z",
  checks: Array.from({ length: 18 }, (_, i) => ({ status: i < 12 ? "passed" : i < 16 ? "unverified" : "not-assessed" })),
  summary: { total: 2, critical: 0, high: 1, medium: 1, low: 0, info: 0 },
  findings: [
    { id: "demo-auth", checkId: "example.auth", title: "Check access to a server endpoint",
      summary: "This illustrative project exposes a server action that could trigger paid work without showing an authentication check.",
      severity: "high", confidence: "medium", evidence: [{ path: "app/api/generate/route.ts", line: 18, detail: "An expensive server action is reachable." }],
      remediation: { why: "Unauthorised requests may trigger paid API usage.", fix: "Require server-side authorisation before the action.", verify: "Try the endpoint without a session and confirm it is rejected.", agentPrompt: "Inspect app/api/generate/route.ts. Add a server-side authorisation check before any paid request and test unauthenticated requests." }
    },
    { id: "demo-header", checkId: "example.headers", title: "Content Security Policy needs review",
      summary: "An example deployment lacks a defined content security policy.",
      severity: "medium", confidence: "medium", evidence: [{ detail: "No Content-Security-Policy header was observed." }],
      remediation: { why: "Browser-side defence in depth is reduced.", fix: "Create a suitable CSP and test it with the app.", verify: "Inspect production response headers and check for unintended blocked resources.", agentPrompt: "Implement a suitable Content-Security-Policy for the deployment and verify that application resources still load." }
    }
  ],
  gaps: [
    { id: "demo-rls", title: "Database permissions not verified", summary: "Source evidence alone cannot establish the live database's permissions.", area: "database", verify: "Use a read-only metadata inspection to confirm grants and row-level security settings." },
    { id: "demo-cron", title: "Background job authentication unverified", summary: "A scheduled endpoint may depend on a secret set at the host.", area: "access-control", verify: "Verify that the deployed cron route rejects requests without its expected credential." }
  ],
  coverage: [
    { area: "code-security", status: "assessed", detail: "Selected source checks completed." },
    { area: "configuration", status: "partial", detail: "Repository configuration was assessed; hosting controls were not." },
    { area: "database", status: "not-assessed", detail: "No authorised database evidence was provided." },
    { area: "runtime", status: "not-assessed", detail: "No deployment URL was provided." }
  ]
};

function severityClass(value: string) {
  return ["critical", "high", "medium", "low"].includes(value) ? value : "neutral";
}
function downloadable(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 200);
}
function markdown(report: ScanReport, example: boolean) {
  return [
    "# Ship Check review", example ? "**Illustrative demonstration — not a real scan.**" : "",
    `Project: ${report.project.path}`,
    `Checks: ${report.checks.length}; findings: ${report.findings.length}; unanswered: ${report.gaps.length}`,
    "## Findings",
    ...report.findings.map(f => `### [${f.severity.toUpperCase()}] ${f.title}\n${f.summary}\n\nFix: ${f.remediation.fix}\nVerify: ${f.remediation.verify}\n\nAgent prompt: ${f.remediation.agentPrompt}`),
    "## Needs verification", ...report.gaps.map(g => `### ${g.title}\n${g.summary}\nVerify: ${g.verify}`),
    "## Coverage", ...report.coverage.map(c => `- ${c.area}: ${c.status}. ${c.detail}`),
    "\nThis is bounded evidence, not proof that a project is safe to deploy."
  ].join("\n\n");
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    scan: <><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><path d="m9 12 2 2 4-4"/></>,
    github: <><path d="M9 19c-4 1-5-2-6-2"/><path d="M15 22v-3.5a3.5 3.5 0 0 0-1-2.5c3-.3 6-1.5 6-6.5a5 5 0 0 0-1.3-3.4 4.7 4.7 0 0 0-.1-3.4s-1.3-.4-3.6 1.5a13 13 0 0 0-6 0C6.7 2.3 5.4 2.7 5.4 2.7a4.7 4.7 0 0 0-.1 3.4A5 5 0 0 0 4 9.5C4 14.5 7 15.7 10 16a3.5 3.5 0 0 0-1 2.5V22"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 6 6 12 0 18M12 3c-6 6-6 12 0 18"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3"/></>,
    tick: <><path d="m5 12 4 4L19 6"/></>,
    alert: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/></>,
    question: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4h.01"/></>
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.scan}</svg>;
}
function FindingRow({ item }: { item: Finding }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return <article className="finding">
    <button className="finding-title" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className={`severity ${severityClass(item.severity)}`}>{item.severity}</span>
      <span className="finding-main"><strong>{item.title}</strong><small>{item.summary}</small></span>
      <span className="expand">{open ? "−" : "+"}</span>
    </button>
    {open && <div className="finding-detail">
      <p><b>Why it matters</b><br/>{item.remediation.why}</p>
      <p><b>Suggested fix</b><br/>{item.remediation.fix}</p>
      <p><b>How to verify</b><br/>{item.remediation.verify}</p>
      {item.evidence[0] && <p className="evidence"><b>Evidence</b> · {item.evidence[0].path ?? "Runtime/configuration"}{item.evidence[0].line ? `:${item.evidence[0].line}` : ""} — {item.evidence[0].detail}</p>}
      <button className="copy-btn" onClick={async () => { await navigator.clipboard.writeText(item.remediation.agentPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000); }}><Icon name={copied ? "tick" : "copy"}/>{copied ? "Copied" : "Copy instructions for my coding agent"}</button>
    </div>}
  </article>;
}
function Results({ report, example, onReset }: { report: ScanReport; example: boolean; onReset: () => void }) {
  const [panel, setPanel] = useState<Panel>("findings");
  const notAssessed = useMemo(() => report.coverage.filter(c => c.status === "not-assessed").length, [report]);
  return <section className="results" aria-live="polite">
    <div className="results-head">
      <div><div className="eyebrow">{example ? "ILLUSTRATIVE DEMONSTRATION · NOT A REAL SCAN" : "SCAN COMPLETED"}</div>
        <h2>{example ? "Here's what the results look like." : "Your project review"}</h2>
        <p className="subtle">{report.project.path} · {report.checks.length} checks · {example ? "Example findings only" : "Ship-check " + report.tool.version}</p>
      </div><button className="quiet" onClick={onReset}>↶ New scan</button>
    </div>
    <div className="stats">
      <div><b>{report.findings.length}</b><span>Findings</span></div>
      <div><b>{report.gaps.length}</b><span>To verify</span></div>
      <div><b>{notAssessed}</b><span>Areas not assessed</span></div>
    </div>
    <p className="disclaimer"><Icon name="alert"/> No findings does not mean safe to ship. These checks assess only the evidence available.</p>
    <div className="tabs" role="tablist" aria-label="Scan results">
      {([["findings", "What needs fixing"], ["verify", "What needs checking"], ["coverage", "What we inspected"]] as const).map(([id, label]) =>
        <button key={id} type="button" role="tab" aria-selected={panel === id} className={panel === id ? "selected" : ""} onClick={() => setPanel(id)}>{label}</button>)}
    </div>
    <div className="tab-panel" role="tabpanel">
      {panel === "findings" && (report.findings.length ? [...report.findings].sort((a,b) => ["critical","high","medium","low","info"].indexOf(a.severity) - ["critical","high","medium","low","info"].indexOf(b.severity)).map(f => <FindingRow key={f.id} item={f}/>) : <div className="empty">No confirmed findings in the assessed areas. Check the coverage before deciding what to do next.</div>)}
      {panel === "verify" && (report.gaps.length ? report.gaps.map(g => <article key={g.id} className="gap"><span className="gap-icon"><Icon name="question"/></span><div><h3>{g.title}</h3><p>{g.summary}</p><div className="verify"><b>How to check:</b> {g.verify}</div></div></article>) : <div className="empty">No explicit unanswered controls surfaced. This is not full coverage.</div>)}
      {panel === "coverage" && report.coverage.map((c: Coverage) => <div key={c.area} className="coverage"><span className={`coverage-dot ${c.status}`}/><div><b>{c.area.replaceAll("-", " ")}</b><p>{c.detail}</p></div><span className="coverage-status">{c.status.replace("-", " ")}</span></div>)}
    </div>
    <div className="results-footer">
      <span className="subtle">Keep the report to share with a developer or agent.</span>
      <div className="actions">
        <button className="secondary" onClick={() => downloadable("ship-check-review.md", markdown(report, example), "text/markdown")}><Icon name="download"/> Markdown</button>
        <button className="secondary" onClick={() => downloadable("ship-check-report.json", JSON.stringify({ ...report, ...(example ? { _illustrative: true } : {}) }, null, 2), "application/json")}><Icon name="download"/> JSON</button>
      </div>
    </div>
  </section>;
}
export default function Page() {
  const [mode, setMode] = useState<Mode>("github");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ScanReport | null>(null);
  const [example, setExample] = useState(false);
  async function scan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(""); setBusy(true); setReport(null);
    try {
      const response = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: mode, url }), cache: "no-store" });
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("An unexpected response was received.");
      const payload = data as { report?: ScanReport; error?: string };
      if (!response.ok || !payload.report) throw new Error(payload.error || "Scan could not complete.");
      setExample(false); setReport(payload.report);
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Scan failed."); }
    finally { setBusy(false); }
  }
  function showExample() { setError(""); setExample(true); setReport(demo); }
  function reset() { setReport(null); setExample(false); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <main>
    <header className="masthead">
      <a className="wordmark" href="/" aria-label="Ship Check home"><span className="mark">✳</span><span>ship<span className="muted-mark">/</span>check</span></a>
      <nav><a href="https://github.com/tomcwxyz/Ship-check" target="_blank" rel="noreferrer">Open source ↗</a><a href="https://github.com/tomcwxyz/Ship-check#project-evidence-sources" target="_blank" rel="noreferrer">Full version ↗</a></nav>
    </header>
    <section className="hero">
      <div className="hero-content">
        <div className="eyebrow"><span className="live-dot"/> PUBLIC PLAYGROUND <span className="middot">·</span> NO LOGIN</div>
        <h1>Before you ship,<br/><em>check.</em></h1>
        <p className="hero-lede">Built something with AI? Let's find out what might need fixing, what still needs checking, and what you can do next.</p>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-symbol">✓</div><div className="orbit-note orbit-note-top">Understand</div><div className="orbit-note orbit-note-bottom">Improve</div></div>
    </section>
    <section className="scan-section" aria-labelledby="scan-title">
      <div className="section-index">01 / START HERE</div>
      <div className="scan-grid">
        <div className="scan-intro"><h2 id="scan-title">A second pair<br/>of eyes.</h2><p>No installation. No sign-up. Just an evidence-led review of your public project.</p><p className="micro">You get 3 scans per day. We don't keep your source code or scan history.</p></div>
        <form className="scan-card" onSubmit={scan}>
          <div className="mode-switch" role="group" aria-label="What to scan">
            <button type="button" aria-pressed={mode === "github"} className={mode === "github" ? "active" : ""} onClick={() => { setMode("github"); setUrl(""); setError(""); }}><Icon name="github"/> GitHub repo</button>
            <button type="button" aria-pressed={mode === "site"} className={mode === "site" ? "active" : ""} onClick={() => { setMode("site"); setUrl(""); setError(""); }}><Icon name="globe"/> Live website</button>
          </div>
          <label htmlFor="project-url">{mode === "github" ? "Public GitHub repository" : "Public website URL"}</label>
          <input id="project-url" type="text" autoComplete="off" spellCheck={false} maxLength={500} required value={url} onChange={e => setUrl(e.target.value)} placeholder={mode === "github" ? "https://github.com/owner/repository" : "https://your-app.example"} />
          <p className="hint">{mode === "github" ? "Selected source and configuration checks. Private repositories aren't supported yet." : "Checks visible HTTPS, headers and other bounded runtime evidence. Not a code scan."}</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button type="submit" className="primary" disabled={busy || !url.trim()}><Icon name="scan"/>{busy ? "Running bounded checks…" : "Check my project"}<Icon name="arrow"/></button>
          {busy && <p className="hint" role="status">An isolated, temporary scan is running. This may take a little time; keep this tab open.</p>}
          <div className="form-foot"><span><Icon name="tick"/> No account</span><span><Icon name="tick"/> No permanent storage</span></div>
        </form>
      </div>
    </section>
    <section className="example-section">
      <div><div className="eyebrow">JUST LOOKING?</div><h2>See what you'd get.</h2><p>Explore a clearly labelled, illustrative report first. No scan allowance used.</p></div>
      <button className="example-link" type="button" onClick={showExample}>Explore example results <Icon name="arrow"/></button>
    </section>
    {report && <div id="results"><Results key={example ? "demo" : report.generatedAt} report={report} example={example} onReset={reset}/></div>}
    <section className="principles">
      <div className="section-index">02 / OUR APPROACH</div>
      <h2>Clarity, not false confidence.</h2>
      <div className="principle-grid">
        <div><span>01</span><h3>Findings</h3><p>Concrete concerns supported by the evidence we could inspect.</p></div>
        <div><span>02</span><h3>Unanswered questions</h3><p>Important things we can't establish, with guidance for verifying them.</p></div>
        <div><span>03</span><h3>Coverage</h3><p>What was actually checked, and what remains outside the scan.</p></div>
      </div>
    </section>
    <footer><div className="wordmark"><span className="mark">✳</span> ship/check</div><p>Built by <a href="https://good-ship.co.uk" target="_blank" rel="noreferrer">The Good Ship ↗</a>. Open-source code, transparent limits, practical next actions.</p><p className="small">Ship Check is an assurance aid, not a penetration test or certification. Public playground scans are temporary and subject to limits.</p></footer>
  </main>;
}
