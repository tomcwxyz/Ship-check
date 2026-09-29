function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function labelledValue(label, value) {
  const wrapper = element("div", "focus-value");
  wrapper.append(element("span", "focus-value-label", label));
  wrapper.append(element("p", "focus-value-copy", value));
  return wrapper;
}

export function assertFocusedReview(review) {
  const base =
    review &&
    typeof review === "object" &&
    typeof review.type === "string" &&
    typeof review.action === "string" &&
    typeof review.summary === "string";

  const valid =
    base &&
    ((review.type === "none" && review.action === "none") ||
      (review.type === "finding" &&
        review.action === "fix" &&
        typeof review.id === "string" &&
        typeof review.checkId === "string" &&
        typeof review.checkVersion === "string" &&
        typeof review.severity === "string" &&
        typeof review.title === "string" &&
        typeof review.fix === "string" &&
        typeof review.verify === "string" &&
        typeof review.agentPrompt === "string" &&
        Array.isArray(review.evidence)) ||
      (review.type === "unverified" &&
        review.action === "verify" &&
        typeof review.id === "string" &&
        typeof review.checkId === "string" &&
        typeof review.checkVersion === "string" &&
        typeof review.title === "string" &&
        typeof review.verify === "string" &&
        Array.isArray(review.evidence)));

  if (!valid) {
    throw new Error(
      "The local engine returned an unexpected focused review. Update the desktop app and engine together.",
    );
  }
  return review;
}

export function focusedReviewCopy(review) {
  assertFocusedReview(review);
  if (review.type === "finding") {
    return [
      "Ship Check focused repair",
      "",
      "Action: FIX",
      `Finding: ${review.id}`,
      `Rule: ${review.checkId}@${review.checkVersion}`,
      `Severity: ${review.severity}`,
      "",
      review.agentPrompt,
      "",
      `Fix: ${review.fix}`,
      `Verify: ${review.verify}`,
      "",
      "Make the smallest change that addresses this evidence, run the relevant project tests, then rerun Ship Check. Do not share access keys, passwords or personal data.",
    ].join("\n");
  }
  if (review.type === "unverified") {
    return [
      "Ship Check focused verification",
      "",
      "Action: VERIFY",
      `Question: ${review.id}`,
      `Rule: ${review.checkId}@${review.checkVersion}`,
      "",
      review.summary,
      "",
      `Verify: ${review.verify}`,
      "",
      "This is an unanswered question, not a confirmed defect. Establish the behaviour before changing code. Do not share access keys, passwords or personal data.",
    ].join("\n");
  }
  return [
    "Ship Check focused review",
    "",
    "Action: NONE",
    review.summary,
    "",
    "A quiet focused queue is not a clean bill of health. Review coverage and unassessed areas.",
  ].join("\n");
}

async function copyReview(button, review) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(focusedReviewCopy(review));
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  window.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

export function renderFocusedReview(panel, review) {
  assertFocusedReview(review);
  panel.replaceChildren();
  panel.hidden = false;

  const heading = element("div", "focus-heading");
  const copy = element("div", "focus-heading-copy");
  const kicker =
    review.type === "finding"
      ? "Next action · Fix"
      : review.type === "unverified"
        ? "Next action · Verify"
        : "Next action";
  copy.append(element("p", "section-kicker", kicker));

  if (review.type === "none") {
    copy.append(
      element("h3", "", "No active item in the focused queue"),
      element("p", "focus-summary", review.summary),
      element(
        "p",
        "focus-caveat",
        "This does not mean the project is clean. Review coverage, accepted exceptions and areas that were not assessed.",
      ),
    );
    heading.append(copy);
    panel.append(heading);
    return;
  }

  copy.append(element("h3", "", review.title), element("p", "focus-summary", review.summary));
  const badges = element("div", "finding-badges");
  badges.append(
    element(
      "span",
      review.type === "finding" ? "focus-action-badge focus-fix" : "focus-action-badge focus-verify",
      review.type === "finding" ? "Fix next" : "Verify next",
    ),
  );
  if (review.type === "finding") {
    badges.append(element("span", `severity-badge severity-${review.severity}`, review.severity));
  }
  badges.append(element("span", "rule-badge", `${review.checkId}@${review.checkVersion}`));
  heading.append(copy, badges);
  panel.append(heading);

  const details = element("div", "focus-grid");
  if (review.type === "finding") {
    details.append(
      labelledValue("What to change", review.fix),
      labelledValue("How to verify it", review.verify),
    );
  } else {
    details.append(
      labelledValue(
        "What to establish",
        "Treat this as a question. Check the behaviour or control before deciding whether any code change is needed.",
      ),
      labelledValue("How to check", review.verify),
    );
  }
  panel.append(details);

  const footer = element("div", "focus-footer");
  footer.append(
    element(
      "code",
      "finding-id",
      `${review.type === "finding" ? "Finding" : "Question"} · ${review.id}`,
    ),
  );
  const button = element(
    "button",
    "button button-quiet",
    review.type === "finding" ? "Copy focused repair" : "Copy verification steps",
  );
  button.type = "button";
  button.addEventListener("click", () => copyReview(button, review));
  footer.append(button);
  panel.append(footer);
}

export function renderFocusedReviewError(panel, error) {
  panel.replaceChildren(
    element("p", "section-kicker", "Focused review unavailable"),
    element("h3", "", "The full scan completed"),
    element(
      "p",
      "focus-summary",
      `Ship Check could not select the next focused item: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
  panel.hidden = false;
}
