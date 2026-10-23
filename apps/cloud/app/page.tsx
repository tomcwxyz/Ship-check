export default function Home() {
  return (
    <main className="cloud-shell">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Ship Check Cloud home">
          <span className="wordmark-mark" aria-hidden="true">✳</span>
          <span>ship<span className="wordmark-slash">/</span>check</span>
        </a>
        <nav aria-label="Other Ship Check surfaces">
          <a href="https://check.good-ship.co.uk/">Public playground ↗</a>
          <a href="https://github.com/tomcwxyz/Ship-check">Source code ↗</a>
        </nav>
      </header>
      <section className="cloud-hero" aria-labelledby="cloud-title">
        <div>
          <p className="eyebrow"><span className="live-dot" aria-hidden="true" />CLOUD PILOT · HISTORY FOUNDATION</p>
          <h1 id="cloud-title">Keep track of what <em>changed.</em></h1>
          <p className="cloud-lede">
            Ship Check starts with evidence where you build. The Cloud pilot is designed
            to help you follow a project over time — without collecting your source code.
          </p>
        </div>
        <div className="hero-instrument" aria-hidden="true">
          <span className="hero-symbol">✓</span>
          <span className="hero-note">Understand · Improve</span>
        </div>
      </section>
      <section className="cloud-boundary" aria-labelledby="boundary-heading">
        <p className="section-index">01 / WHAT IT KEEPS</p>
        <h2 id="boundary-heading">Useful history. Your source stays with you.</h2>
        <p>
          The initial Cloud boundary accepts only deliberately synced assurance metadata.
          It does not store application source, full findings, credentials or evidence excerpts.
        </p>
        <div className="boundary-grid">
          <div className="boundary-card">
            <span className="caption">01 · Execution</span>
            <h3>Checks stay in your environment</h3>
            <p>Run Ship Check locally or in your own CI runner. The public playground remains a separate, temporary scan service.</p>
          </div>
          <div className="boundary-card">
            <span className="caption">02 · Evidence</span>
            <h3>Only summary metadata is synced</h3>
            <p>Coverage, counts, ruleset provenance and changes. No raw source or full scan reports.</p>
          </div>
          <div className="boundary-card">
            <span className="caption">03 · Control</span>
            <h3>Opt in, with a retention choice</h3>
            <p>Connected projects specify their retention period; scoped API tokens can be expired or revoked.</p>
          </div>
          <div className="boundary-card">
            <span className="caption">04 · Next steps</span>
            <h3>A timeline rather than a safety score</h3>
            <p>The future project view will show what's new, what persists and what hasn't been checked — never pretend the whole app is safe.</p>
          </div>
        </div>
      </section>
      <section className="cloud-next" aria-labelledby="next-heading">
        <p className="section-index">02 / PILOT STATUS</p>
        <h2 id="next-heading">Built for ongoing understanding.</h2>
        <p>
          Cloud sign-in, a browsable project timeline and scheduled vulnerability alerts
          are not available through this pilot landing page yet.
          The metadata API and optional CI sync are foundations for those features.
        </p>
        <p className="cloud-note">
          Until the hosted database and authentication have been verified end-to-end,
          Cloud should not be treated as an active monitoring or alerting service.
        </p>
      </section>
      <footer className="cloud-footer">
        <span>Ship Check · Evidence-led, local-first assurance · </span>
        <a href="https://github.com/tomcwxyz/Ship-check/blob/main/docs/CLOUD_MONITORING.md">
          Cloud monitoring roadmap ↗
        </a>
      </footer>
    </main>
  );
}
