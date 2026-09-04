export function startPolling() {
  return setInterval(async () => {
    await fetch("/api/background-refresh");
  }, 30_000);
}
