import type {
  RuntimeCheckDefinition,
  RuntimeContext
} from "@ship-check/core/runtime";
import type { Finding, Observation } from "@ship-check/schemas";

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function runtimeEvidence(detail: string) {
  return [{ kind: "configuration" as const, detail }];
}

function verifiedObservation(
  checkId: string,
  pack: "secure-build" | "production-ready",
  title: string,
  summary: string,
  detail: string
): Observation {
  return {
    id: `${checkId}:verified`,
    checkId,
    pack,
    area: "runtime",
    kind: "verified-control",
    title,
    summary,
    evidence: runtimeEvidence(detail)
  };
}

export const transportSecurityCheck: RuntimeCheckDefinition = {
  id: "runtime.transport-security",
  version: "1",
  pack: "secure-build",
  title: "Runtime transport security",
  description: "Checks whether the requested deployment resolves to HTTPS, following a bounded redirect chain.",
  principles: ["practice.preserve-safety"],
  requiresEvidence: ["runtime-http"],
  coverage: [{ area: "runtime", status: "assessed" }],
  async run(context: RuntimeContext) {
    const finalUrl = new URL(context.http.finalUrl);
    const loopback = isLoopback(finalUrl.hostname);
    const observations: Observation[] = [];
    const findings: Finding[] = [];

    if (finalUrl.protocol === "https:") {
      observations.push(verifiedObservation(
        "runtime.transport-security",
        "secure-build",
        "Deployment resolved over HTTPS",
        "The bounded runtime probe finished on an HTTPS URL.",
        context.http.redirects.length > 0
          ? `The target reached HTTPS after ${context.http.redirects.length} redirect${context.http.redirects.length === 1 ? "" : "s"}.`
          : "The target was served directly over HTTPS."
      ));
    } else if (loopback) {
      observations.push(verifiedObservation(
        "runtime.transport-security",
        "secure-build",
        "Local HTTP target observed",
        "The target is a loopback development address, where HTTP can be an intentional local-only boundary.",
        "The final runtime target uses HTTP on a loopback hostname."
      ));
    } else {
      findings.push({
        id: "runtime.transport-security:http-only",
        checkId: "runtime.transport-security",
        pack: "secure-build",
        title: "Deployment remains available over HTTP",
        summary: "The runtime probe finished on an unencrypted HTTP URL rather than HTTPS.",
        severity: "high",
        confidence: "high",
        evidence: runtimeEvidence("The final runtime target used HTTP after following the bounded redirect chain."),
        remediation: {
          why: "HTTP does not protect traffic from interception or modification in transit.",
          fix: "Serve the public deployment over HTTPS and redirect HTTP requests to HTTPS at the hosting or edge layer.",
          verify: "Run Ship Check against the public URL again and confirm the final target is HTTPS.",
          agentPrompt: "Configure the deployment so public HTTP requests redirect to HTTPS and verify the final response is served securely."
        }
      });
    }

    return { findings, observations };
  }
};

export const responseSecurityHeadersCheck: RuntimeCheckDefinition = {
  id: "runtime.response-security-headers",
  version: "1",
  pack: "production-ready",
  title: "Runtime browser security headers",
  description: "Checks a small bounded set of browser-facing response headers on the deployed target.",
  principles: ["practice.preserve-safety"],
  requiresEvidence: ["runtime-http"],
  coverage: [{ area: "runtime", status: "assessed" }, { area: "configuration", status: "partial" }],
  async run(context: RuntimeContext) {
    const finalUrl = new URL(context.http.finalUrl);
    const headers = context.http.headers;
    const expected: Array<[string, boolean]> = [
      ["Content-Security-Policy", Boolean(headers.contentSecurityPolicy)],
      ["X-Content-Type-Options", Boolean(headers.xContentTypeOptions)],
      ["Referrer-Policy", Boolean(headers.referrerPolicy)]
    ];
    if (finalUrl.protocol === "https:" && !isLoopback(finalUrl.hostname)) {
      expected.push(["Strict-Transport-Security", Boolean(headers.strictTransportSecurity)]);
    }

    const missing = expected.filter(([, present]) => !present).map(([name]) => name);
    if (missing.length === 0) {
      return {
        observations: [verifiedObservation(
          "runtime.response-security-headers",
          "production-ready",
          "Baseline browser security headers observed",
          "The deployed response included the bounded browser security header set checked by Ship Check.",
          "CSP, X-Content-Type-Options, Referrer-Policy and applicable HSTS evidence were present."
        )]
      };
    }

    return {
      findings: [{
        id: "runtime.response-security-headers:incomplete",
        checkId: "runtime.response-security-headers",
        pack: "production-ready",
        title: "Browser security header baseline is incomplete",
        summary: `The deployed response did not include ${missing.join(", ")}.`,
        severity: "low",
        confidence: "high",
        evidence: runtimeEvidence(`Missing response header names: ${missing.join(", ")}. No response header values were retained in the finding.`),
        remediation: {
          why: "These headers provide defence-in-depth for common browser-side risks and make deployment behaviour more explicit.",
          fix: "Set the missing headers at the application, hosting or edge layer, choosing policies that fit the application rather than copying an overly broad template.",
          verify: "Re-run the runtime check and confirm the intended headers are present on the representative response.",
          agentPrompt: `Review the deployed application's response headers and add appropriate policies for: ${missing.join(", ")}. Keep the policies compatible with the application's actual assets and integrations.`
        }
      }]
    };
  }
};

export const cookieCorsBoundaryCheck: RuntimeCheckDefinition = {
  id: "runtime.cookie-cors-boundaries",
  version: "1",
  pack: "secure-build",
  title: "Runtime cookie and CORS boundaries",
  description: "Checks visible cookie transport flags and whether a synthetic external Origin is reflected by the target response.",
  principles: ["practice.preserve-safety"],
  requiresEvidence: ["runtime-http"],
  coverage: [{ area: "runtime", status: "partial" }, { area: "access-control", status: "partial" }],
  async run(context: RuntimeContext) {
    const finalUrl = new URL(context.http.finalUrl);
    const findings: Finding[] = [];
    const observations: Observation[] = [];

    if (finalUrl.protocol === "https:") {
      const insecureCookieCount = context.http.cookies.filter((cookie) => !cookie.secure).length;
      if (insecureCookieCount > 0) {
        findings.push({
          id: "runtime.cookie-cors-boundaries:cookie-without-secure",
          checkId: "runtime.cookie-cors-boundaries",
          pack: "secure-build",
          title: "HTTPS response sets cookies without Secure",
          summary: `${insecureCookieCount} cookie${insecureCookieCount === 1 ? " was" : "s were"} observed without the Secure attribute on an HTTPS response.`,
          severity: "medium",
          confidence: "high",
          evidence: runtimeEvidence(`${insecureCookieCount} Set-Cookie header${insecureCookieCount === 1 ? "" : "s"} lacked Secure. Cookie values were discarded during evidence acquisition.`),
          remediation: {
            why: "Cookies without Secure may be sent over plaintext HTTP if an HTTP route remains reachable or a client is redirected unexpectedly.",
            fix: "Mark security-sensitive cookies Secure and confirm HTTP traffic is redirected to HTTPS. Review framework and hosting cookie defaults.",
            verify: "Re-run the runtime check and confirm cookies set by the representative response use Secure where appropriate.",
            agentPrompt: "Review cookies set by this deployment. Add the Secure attribute to security-sensitive cookies and ensure the deployment redirects public HTTP traffic to HTTPS."
          }
        });
      } else if (context.http.cookies.length > 0) {
        observations.push(verifiedObservation(
          "runtime.cookie-cors-boundaries",
          "secure-build",
          "Observed cookies use Secure",
          "Every cookie visible on the representative HTTPS response used the Secure attribute.",
          `${context.http.cookies.length} cookie${context.http.cookies.length === 1 ? " was" : "s were"} inspected without retaining cookie values.`
        ));
      }
    }

    const allowedOrigin = context.http.headers.accessControlAllowOrigin;
    const allowsCredentials = context.http.headers.accessControlAllowCredentials?.toLowerCase() === "true";
    if (allowedOrigin === context.http.requestOrigin) {
      findings.push({
        id: "runtime.cookie-cors-boundaries:reflected-origin",
        checkId: "runtime.cookie-cors-boundaries",
        pack: "secure-build",
        title: "Deployment reflected an arbitrary external Origin",
        summary: allowsCredentials
          ? "The representative response reflected Ship Check's synthetic external Origin and also allowed credentials."
          : "The representative response reflected Ship Check's synthetic external Origin in Access-Control-Allow-Origin.",
        severity: allowsCredentials ? "high" : "medium",
        confidence: "medium",
        evidence: runtimeEvidence(`The response allowed the synthetic Origin ${context.http.requestOrigin}${allowsCredentials ? " with credentials enabled" : ""}.`),
        remediation: {
          why: "Reflecting arbitrary origins can expose browser-readable responses to sites that should not be trusted, particularly when credentials are involved.",
          fix: "Use an explicit allow-list for origins that genuinely need browser access and apply CORS at the narrowest API boundary rather than globally.",
          verify: "Re-run the check and confirm an untrusted synthetic Origin is not reflected unless that behaviour is intentionally public.",
          agentPrompt: "Review the deployment's CORS configuration. Replace arbitrary Origin reflection with an explicit allow-list at the relevant API boundary and verify credentialed requests are restricted."
        }
      });
    } else {
      observations.push(verifiedObservation(
        "runtime.cookie-cors-boundaries",
        "secure-build",
        "Synthetic external Origin was not reflected",
        allowedOrigin === "*"
          ? "The response used wildcard CORS rather than reflecting the synthetic Origin; whether that is appropriate depends on the endpoint's intended public boundary."
          : "The representative response did not reflect Ship Check's synthetic external Origin.",
        allowedOrigin === "*" ? "Access-Control-Allow-Origin was wildcard." : "No arbitrary Origin reflection was observed on the representative response."
      ));
    }

    return { findings, observations };
  }
};

export const runtimeHttpChecks: RuntimeCheckDefinition[] = [
  transportSecurityCheck,
  responseSecurityHeadersCheck,
  cookieCorsBoundaryCheck
];
