export function middleware() {
  return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
}
