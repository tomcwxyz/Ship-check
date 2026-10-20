// Domain allow-list is enforced by Vercel Sandbox at the VM egress boundary.
// Never use allow-all or a '*' catch-all for arbitrary targets.
const PRIVATE_CIDRS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
  "192.0.0.0/24", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
  "::1/128", "fc00::/7", "fe80::/10"
];
export function scanEgressPolicy(source) {
  const allowed = ["registry.npmjs.org"];
  if (source.kind === "github") {
    allowed.push("github.com");
  } else if (source.kind === "site") {
    const host = new URL(source.target).hostname;
    allowed.push(host);
    // Many public websites redirect between the apex and www hostname.
    // This deliberately does not authorise unrelated redirect destinations.
    allowed.push(host.startsWith("www.") ? host.slice(4) : `www.${host}`);
  } else {
    throw new Error("Unknown playground source.");
  }
  return { allow: [...new Set(allowed)], subnets: { deny: PRIVATE_CIDRS } };
}
