const guidance = {
  "secure.tracked-env-file": {
    title: "Remove a private configuration file from the project history",
    summary: "A configuration file that commonly contains passwords or service keys is part of the scanned source set.",
    why: "These files often contain credentials that can unlock production services or data. Removing the file alone does not make an exposed credential safe again.",
    next: "Ask your developer to move secrets into the deployment secret store, stop tracking the file and rotate any credentials that may have been exposed. Keep only a safe example file in the project.",
  },
  "secure.secret-pattern": {
    title: "Check a possible exposed access key",
    summary: "A value in the code looks like an access key. Its purpose and permissions need checking.",
    why: "If this is a private key, someone could use it to access a service or run up costs. Some browser keys are intentionally public.",
    next: "Ask your developer to identify the key type without sharing its value. Replace private credentials if exposed; check permissions for public keys.",
  },
  "secure.paid-endpoint-abuse-control": {
    title: "Check whether visitors could run up service costs",
    summary: "We found paid-service code without a recognised protection against unwanted requests.",
    why: "This code can use a paid service. We could not find a recognised protection against unwanted or repeated requests.",
    next: "Ask your developer to confirm that protection runs before paid work starts, and test requests from someone without an account.",
  },
  "secure.wildcard-cors": {
    title: "Limit which websites can call this browser-facing service",
    summary: "The project explicitly allows browser requests from any website origin.",
    why: "Allowing every website to make browser requests can widen the ways an API is used or abused, particularly around signed-in or sensitive actions.",
    next: "Ask your developer to replace the wildcard with the smallest list of websites that genuinely need access and test that an unrecognised origin is rejected.",
  },
  "secure.public-secret-env-name": {
    title: "Move a secret-looking setting out of the browser",
    summary: "A setting with a secret-like name is marked for inclusion in public browser code.",
    why: "Browser-visible settings can be read by anyone using the app. Private service credentials and database connection details should stay on the server.",
    next: "Ask your developer to move the value behind a server-only boundary and confirm it no longer appears in the built browser files.",
  },
  "secure.dangerous-server-execution": {
    title: "Replace a high-risk server execution pattern",
    summary: "A server request path contains a code, shell or database execution pattern that can be dangerous when input is not tightly controlled.",
    why: "These primitives bypass normal safeguards and can turn an input-handling mistake into code execution, command execution or database injection.",
    next: "Ask your developer to replace the risky primitive with a constrained, parameterised alternative and add a test using deliberately hostile input.",
  },
  "production.package-lock-discipline": {
    title: "Make installations use a consistent set of software packages",
    summary: "There is no single clear record of which package versions a build should install.",
    why: "The project does not have one clear record of the package versions to install. A later build could behave differently.",
    next: "Ask your developer to use one package manager, keep its version record in the project, and make automated builds follow it.",
  },
  "production.osv-vulnerabilities": {
    title: "Update a package with a known security problem",
    summary: "The optional dependency check matched an installed package version to a published vulnerability record.",
    why: "Known vulnerable packages can expose an app even when the surrounding application code looks correct.",
    next: "Ask your developer to read the cited advisory, move to the narrowest compatible fixed version, run the relevant tests and avoid unrelated dependency upgrades.",
  },
  "production.github-actions-supply-chain": {
    title: "Tighten an automated build or release workflow",
    summary: "A GitHub Actions workflow has a repository-visible supply-chain boundary that is broader or less reproducible than it needs to be.",
    why: "Build and release workflows execute code with repository permissions. Broad write access or moving external references increase the impact of an unexpected workflow change.",
    next: "Ask your developer to use the smallest required workflow permissions and immutable reviewed action versions where the finding identifies them.",
  },
  "cost.vercel-cron-frequency": {
    title: "Check whether scheduled work is running more often than it needs to",
    summary: "A scheduled job runs frequently, and Ship Check has looked at the kind of work it reaches before raising this concern.",
    why: "Frequent background work can create continuous compute, database or paid-service usage even when nobody is actively using the product.",
    next: "Ask your developer to confirm the required freshness, then use the lowest useful schedule or an event-driven approach. Measure invocation and downstream usage rather than optimising by guesswork.",
  },
  "cost.frequent-network-polling": {
    title: "Check whether the app is asking for updates too often",
    summary: "Code that makes network requests also appears to repeat them on a short interval.",
    why: "Frequent polling can keep servers, databases and paid services busy all day while providing little extra value to users.",
    next: "Ask your developer whether updates can happen on demand, through events, or less frequently, then measure request volume after the change.",
  },
  "secure.semgrep-local-rules": {
    title: "Review a risky code pattern found by deeper local analysis",
    summary: "The optional local code analyser matched one of Ship Check's deliberately small high-confidence rules.",
    why: "The matched pattern weakens a security control in a way that is difficult to justify accidentally. The technical section names the exact rule and location.",
    next: "Ask your developer to remove the matched bypass rather than suppressing the warning, preserve the intended behaviour and add a regression test for the security boundary.",
  },
};

export function reviewFinding(finding) {
  const copy = guidance[finding.checkId];
  return {
    title: copy?.title ?? finding.title,
    summary: copy?.summary ?? finding.summary,
    why: copy?.why ?? finding.remediation.why,
    next: copy?.next ?? finding.remediation.fix,
    verification: finding.remediation.verify,
    repairInstructions: [
      finding.title, finding.summary,
      `Rule: ${finding.checkId}`, `Finding: ${finding.id}`,
      ...finding.evidence.map(item => `${item.path ?? "Project"}${item.line ? `:${item.line}` : ""}: ${item.detail}`),
      `Why: ${finding.remediation.why}`, `Fix: ${finding.remediation.fix}`,
      `Verify: ${finding.remediation.verify}`, finding.remediation.agentPrompt,
      "Preserve intended behaviour. Do not print access keys or personal data. Explain any remaining uncertainty.",
    ].join("\n\n"),
  };
}

export function reviewSummary(report) {
  const issues = report.summary.total;
  const questions = report.gaps?.length ?? 0;
  const errors = report.checks.filter(check => check.status === "error").length;
  let title;
  if (errors) title = "Some checks could not finish";
  else if (issues > 0) title = `${issues} ${issues === 1 ? "thing" : "things"} to look at before shipping${questions ? ` · ${questions} ${questions === 1 ? "question" : "questions"} still to check` : ""}`;
  else if (questions > 0) title = `No confirmed issues here · ${questions} ${questions === 1 ? "question still needs" : "questions still need"} checking`;
  else title = "No confirmed issues in the areas checked";

  return {
    title,
    detail: "This is a bounded source-code review. It shows what Ship Check found, what the code could not answer and what was not assessed; it does not prove the live app or database is safe.",
    optional: [
      ...(!report.checks.some(check => check.checkId === "production.osv-vulnerabilities") ? ["Known package vulnerabilities were not checked."] : []),
      ...(!report.checks.some(check => check.checkId?.includes("semgrep")) ? ["Optional deeper code analysis was not run."] : []),
    ].join(" "),
  };
}
