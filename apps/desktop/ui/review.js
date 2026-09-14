const guidance = {
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
  "production.package-lock-discipline": {
    title: "Make installations use a consistent set of software packages",
    summary: "There is no single clear record of which package versions a build should install.",
    why: "The project does not have one clear record of the package versions to install. A later build could behave differently.",
    next: "Ask your developer to use one package manager, keep its version record in the project, and make automated builds follow it.",
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
  return {
    title: errors ? "This scan could not finish every check" : `${issues} potential ${issues === 1 ? "issue" : "issues"} to review · ${questions} ${questions === 1 ? "question" : "questions"} to check`,
    detail: "These results cover selected source-code checks. They do not establish that the live app or its database is safe.",
    optional: [
      ...(!report.checks.some(check => check.checkId === "production.osv-vulnerabilities") ? ["Known package vulnerabilities were not checked."] : []),
      ...(!report.checks.some(check => check.checkId?.includes("semgrep")) ? ["Optional deeper code analysis was not run."] : []),
    ].join(" "),
  };
}
