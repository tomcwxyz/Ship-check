// Domain allow-list is enforced by Vercel Sandbox at the VM egress boundary.
// Never use allow-all or a '*' catch-all for arbitrary targets.
// Vercel Sandbox currently accepts IPv4 CIDRs only. Passing IPv6 CIDRs
// causes its API to reject the entire sandbox creation request (HTTP 400).
const PRIVATE_CIDRS = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8",
  "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
  "192.0.0.0/24", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4"
];
export function scanEgressPolicy(source, vulnerabilityIntelligence = false) {
  const allowed = ["registry.npmjs.org"];
  if (source.kind === "github") {
    allowed.push("github.com");
  } else {
    throw new Error("Unknown playground source.");
  }
  if (vulnerabilityIntelligence) allowed.push("api.osv.dev", "nodejs.org", "raw.githubusercontent.com");
  return { allow: [...new Set(allowed)], subnets: { deny: PRIVATE_CIDRS } };
}
