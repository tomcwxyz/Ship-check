// Local-first desktop Cloud connection. The scan report never leaves the webview
// except through the native, explicit publish command, which converts it into
// the canonical source-free metadata envelope before any network request.
const CLOUD_DASHBOARD = "https://cloud-check.good-ship.co.uk/dashboard";

export function initCloudConnection(bridge, doc) {
  const root = doc.querySelector("#cloud-connection");
  if (!root) return { onScanCompleted() {}, resetScan() {} };
  const status = root.querySelector("#cloud-status");
  const input = root.querySelector("#cloud-token");
  const connect = root.querySelector("#cloud-connect");
  const forget = root.querySelector("#cloud-forget");
  const send = root.querySelector("#cloud-send");
  const projectName = root.querySelector("#cloud-project-name");
  const receipt = root.querySelector("#cloud-receipt");
  const historyLink = root.querySelector("#cloud-history-link");
  const busyState = { value: false };
  let connected = false;
  let report = null;

  function setStatus(message, failed = false) {
    status.textContent = message;
    status.dataset.state = failed ? "error" : "neutral";
  }
  function render() {
    connect.disabled = busyState.value || input.value.trim().length === 0;
    forget.disabled = busyState.value || !connected;
    forget.hidden = !connected;
    send.disabled = busyState.value || !connected || !report || !projectName.value.trim();
  }
  function work(value) {
    busyState.value = value;
    render();
  }
  async function check() {
    try {
      const result = await bridge.cloudConnectionStatus();
      connected = result.saved === true;
      setStatus(result.message || (connected ? "Token saved." : "Not connected."));
    } catch {
      connected = false;
      setStatus("Your system credential store is unavailable. Local scans still work.", true);
    }
    render();
  }

  input.addEventListener("input", render);
  projectName.addEventListener("input", render);
  connect.addEventListener("click", async () => {
    const token = input.value.trim();
    input.value = ""; // Never persist, log or echo the submitted token in the DOM.
    if (!token || busyState.value) return;
    work(true);
    try {
      const result = await bridge.cloudConnectToken(token);
      connected = result.saved === true;
      setStatus(result.message || "Sync token saved. It will be checked on first use.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save token.", true);
    } finally { work(false); }
  });

  forget.addEventListener("click", async () => {
    if (busyState.value) return;
    work(true);
    try {
      const result = await bridge.cloudForgetToken();
      connected = false;
      historyLink.hidden = true;
      receipt.textContent = "";
      setStatus(result.message || "Local token forgotten. Revoke the token in the Cloud dashboard.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not forget token.", true);
    } finally { work(false); }
  });

  send.addEventListener("click", async () => {
    if (!connected || !report || busyState.value) return;
    const name = projectName.value.trim();
    if (!name || name.length > 120) {
      setStatus("Choose a project name of no more than 120 characters.", true);
      return;
    }
    work(true);
    receipt.textContent = "Sending source-free metadata summary…";
    historyLink.hidden = true;
    try {
      const result = await bridge.cloudPublishSummary(report, name);
      receipt.textContent = result.status === "duplicate"
        ? "This exact scan already exists in Cloud."
        : "Scan summary received by Cloud. Your source and full report stayed on this device.";
      historyLink.href = result.timelineUrl;
      historyLink.hidden = false;
      setStatus("Last sync: " + new Date(result.ingestedAt).toLocaleString("en-GB"));
    } catch (err) {
      receipt.textContent = "";
      setStatus(err instanceof Error ? err.message : "Could not sync. Your local result is intact.", true);
    } finally { work(false); }
  });

  function resetScan() {
    report = null;
    historyLink.hidden = true;
    receipt.textContent = "";
    render();
  }

  void check();
  return {
    resetScan,
    onScanCompleted(newReport, sourceName) {
      report = newReport;
      projectName.value = String(sourceName || "My project").slice(0, 120);
      receipt.textContent = "Ready to send a summary. Nothing is shared until you choose Send.";
      render();
    }
  };
}

export const SHIP_CHECK_CLOUD_DASHBOARD = CLOUD_DASHBOARD;
