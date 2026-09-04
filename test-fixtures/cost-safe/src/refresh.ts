export async function refreshNow() {
  return fetch("/api/refresh");
}
