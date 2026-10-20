import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";

export class LimitsUnavailable extends Error {}
export class RateLimited extends Error {}

function extractClientIp(request: NextRequest): string {
  // x-real-ip is set at the trusted Vercel proxy boundary. Do not trust caller-supplied
  // X-Forwarded-For as an identity; no IP => fail closed rather than sharing a quota.
  const ip = request.headers.get("x-real-ip")?.trim() ?? "";
  if (!isIP(ip)) throw new LimitsUnavailable("Visitor identity unavailable.");
  return ip;
}
async function redisCommand(url: string, token: string, args: Array<string | number>) {
  const response = await fetch(url, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), cache: "no-store", signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) throw new LimitsUnavailable("Rate limiting unavailable.");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("result" in body))
    throw new LimitsUnavailable("Invalid rate limiting response.");
  return (body as { result: unknown }).result;
}
export async function claimAnonymousScan(request: NextRequest): Promise<void> {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token || !/^https:\/\//.test(base))
    throw new LimitsUnavailable("Anonymous scanning is not configured.");
  // HMAC prevents offline reversal of the small IP-address search space.
  const key = "playground:v1:" + createHmac("sha256", token)
    .update(extractClientIp(request)).digest("hex");
  try {
    // Atomic initial quota key with TTL. Existing keys are incremented (no sliding expiry).
    const first = await redisCommand(base, token, ["SET", key, "1", "EX", 86400, "NX"]);
    if (first === "OK") return;
    if (first !== null) throw new LimitsUnavailable("Unexpected quota response.");
    const count = await redisCommand(base, token, ["INCR", key]);
    if (typeof count !== "number") throw new LimitsUnavailable("Unexpected quota response.");
    if (count > 3) throw new RateLimited("Daily allowance reached. Try again tomorrow.");
  } catch (error) {
    if (error instanceof RateLimited || error instanceof LimitsUnavailable) throw error;
    throw new LimitsUnavailable("Rate limiting temporarily unavailable.");
  }
}
