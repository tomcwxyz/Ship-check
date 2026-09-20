export default function Home() {
  return (
    <main>
      <p className="eyebrow">Ship Check · Cloud R0</p>
      <h1>Your source stays where you run Ship Check.</h1>
      <p className="lede">
        Cloud R0 stores the source-free assurance metadata you explicitly sync:
        enough to see project history and change over time, without turning
        Ship Check into a hosted source scanner.
      </p>
      <section>
        <h2>Current boundary</h2>
        <dl>
          <div><dt>Source code</dt><dd>Local device or your CI runner</dd></div>
          <div><dt>Cloud storage</dt><dd>Assurance metadata only</dd></div>
          <div><dt>Automation</dt><dd>Scoped, expiring API tokens</dd></div>
          <div><dt>Retention</dt><dd>Explicit per connected project</dd></div>
        </dl>
      </section>
      <p className="note">
        This pilot surface is deliberately small. Project history UI and normal
        account sign-in come next; the API boundary is already live underneath.
      </p>
    </main>
  );
}
