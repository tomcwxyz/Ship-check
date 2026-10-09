import {
  findingKey, checkKey, reviewForFinding, saveReview, clearReview, reviewsForProject,
  reviewLabels, verificationLabels,
} from "./finding-reviews.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

export function renderFindingReviewControls(finding, checkVersion, projectId, storage, onChange = () => {}) {
  const panel = el("section", "finding-review");
  panel.setAttribute("aria-label", "Review decision for this finding");
  const heading = el("div", "finding-review-heading");
  heading.append(el("strong", "", "Your assessment"), el("span", "finding-review-status", "Loading local review…"));
  const status = heading.lastChild;
  const help = el("p", "finding-review-help",
    "Record your judgement without altering the scan. Marking fixed or accepted never hides this finding.");
  const form = el("div", "finding-review-form");
  const selectLabel = el("label", "finding-review-label", "Decision");
  const select = el("select", "finding-review-select");
  select.append(new Option("Not reviewed", ""));
  for (const [value, label] of Object.entries(reviewLabels)) select.append(new Option(label, value));
  selectLabel.append(select);

  const reasonLabel = el("label", "finding-review-label finding-review-reason", "Why is the risk accepted?");
  const reason = el("textarea", "finding-review-reason-input");
  reason.rows = 2;
  reason.maxLength = 500;
  reason.placeholder = "Record the specific reason and any monitoring in place. Do not paste keys or personal data.";
  reasonLabel.append(reason);
  reasonLabel.hidden = true;

  const buttons = el("div", "finding-review-actions");
  const save = el("button", "button button-secondary", "Save decision");
  save.type = "button";
  const clear = el("button", "button button-quiet", "Clear decision");
  clear.type = "button";
  clear.hidden = true;
  const message = el("p", "finding-review-message");
  message.setAttribute("role", "status");
  buttons.append(save, clear);
  form.append(selectLabel, reasonLabel, buttons);
  panel.append(heading, help, form, message);

  select.disabled = true;
  save.disabled = true;
  select.addEventListener("change", () => {
    reasonLabel.hidden = select.value !== "accepted";
  });

  void (async () => {
    const [id, ruleKey] = await Promise.all([findingKey(finding, checkVersion), checkKey(finding.checkId, checkVersion)]);
    if (!id || !ruleKey || !projectId) {
      status.textContent = "Local review unavailable";
      message.textContent = "A secure local identity could not be created; no decision was saved.";
      return;
    }
    select.disabled = false;
    save.disabled = false;
    let current = reviewForFinding(storage, projectId, id);

    function update() {
      current = reviewForFinding(storage, projectId, id);
      select.value = current?.decision ?? "";
      reason.value = current?.note ?? "";
      reasonLabel.hidden = select.value !== "accepted";
      clear.hidden = !current;
      status.textContent = current
        ? reviewLabels[current.decision] + " · " + (verificationLabels[current.verification] ?? verificationLabels.pending)
        : "Not reviewed";
      status.dataset.decision = current?.decision ?? "";
    }
    update();

    save.addEventListener("click", () => {
      if (!select.value) {
        message.textContent = "Choose a decision, or use Clear decision.";
        return;
      }
      try {
        saveReview(storage, {
          projectKey: projectId, findingKey: id,
          checkKey: ruleKey,
          ruleId: finding.checkId, decision: select.value, note: reason.value,
        });
        update();
        message.textContent = "Decision saved locally; the scan finding is unchanged.";
        onChange();
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    clear.addEventListener("click", () => {
      if (!clearReview(storage, projectId, id)) {
        message.textContent = "Could not clear the saved decision.";
        return;
      }
      update();
      message.textContent = "Local review cleared; scan evidence is unchanged.";
      onChange();
    });
  })();
  return panel;
}

export function renderProjectReviewHistory(container, projectId, storage) {
  container.replaceChildren();
  const records = projectId ? reviewsForProject(storage, projectId) : [];
  if (!records.length) {
    container.append(el("p", "finding-review-help", "No local review decisions for this project yet."));
    return;
  }
  container.append(el("p", "finding-review-help",
    "Saved on this device. Past decisions remain visible when a finding disappears, but this history is not proof of a fix."));
  for (const record of [...records].reverse()) {
    const row = el("div", "finding-review-history-row");
    const info = el("div", "");
    info.append(
      el("strong", "", record.ruleId + " · " + record.findingKey.slice(0, 8)),
      el("span", "", reviewLabels[record.decision] + " · " + verificationLabels[record.verification]),
    );
    const date = new Date(record.updatedAt);
    if (!Number.isNaN(date.getTime())) info.append(el("small", "", "Reviewed " + date.toLocaleDateString("en-GB")));
    const clear = el("button", "button button-quiet", "Remove");
    clear.type = "button";
    clear.setAttribute("aria-label", "Remove review decision for " + record.ruleId);
    clear.addEventListener("click", () => {
      if (clearReview(storage, projectId, record.findingKey)) {
        renderProjectReviewHistory(container, projectId, storage);
      }
    });
    row.append(info, clear);
    container.append(row);
  }
}
