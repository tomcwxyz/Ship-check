export const SEMGREP_RULESET_VERSION = "1";
export const SEMGREP_TESTED_VERSION = "1.176.0";
export const SEMGREP_SUPPORTED_MAJOR_MINOR = "1.176";
export const SEMGREP_RULESET_SHA256 = "ac69dc01f67f4a2ed3f62c255d87415a8ea73541402e1e7679803a27d5cc557d";

/**
 * Ship Check-owned local Semgrep rules.
 *
 * This string is compiled into the standalone engine and written to a temporary
 * file only for an explicitly requested local Semgrep scan. It never references
 * Semgrep Registry rules and must be run with metrics/version checks disabled.
 */
export const SEMGREP_RULESET_YAML = `rules:
  - id: ship-check.node.tls-verification-disabled
    message: TLS certificate verification is explicitly disabled.
    languages: [javascript, typescript]
    severity: ERROR
    patterns:
      - pattern-either:
          - pattern: new $AGENT({..., rejectUnauthorized: false, ...})
          - pattern: $AGENT({..., rejectUnauthorized: false, ...})
          - pattern: process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
          - pattern: process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    metadata:
      ship_check_category: tls-verification

  - id: ship-check.node.jwt-expiry-verification-disabled
    message: JWT expiry verification is explicitly disabled.
    languages: [javascript, typescript]
    severity: ERROR
    pattern-either:
      - pattern: $JWT.verify($TOKEN, $KEY, {..., ignoreExpiration: true, ...}, ...)
      - pattern: $JWT.verify($TOKEN, $KEY, {..., ignoreExpiration: true, ...})
    metadata:
      ship_check_category: jwt-expiry
`;

export type SemgrepRuleGuidance = {
  title: string;
  why: string;
  fix: string;
  verify: string;
};

export const SEMGREP_RULE_GUIDANCE: Record<string, SemgrepRuleGuidance> = {
  "ship-check.node.tls-verification-disabled": {
    title: "TLS certificate verification is disabled",
    why: "Disabling certificate verification removes an important authenticity check and can make outbound HTTPS traffic vulnerable to interception or impersonation.",
    fix: "Remove the verification bypass. If a private/internal certificate authority is required, configure the trusted CA explicitly rather than accepting any certificate.",
    verify: "Exercise the affected outbound connection with the intended certificate chain and confirm invalid or untrusted certificates are rejected."
  },
  "ship-check.node.jwt-expiry-verification-disabled": {
    title: "JWT expiry verification is disabled",
    why: "Accepting expired JWTs can extend access beyond the lifetime intended by the issuer and weaken session/token revocation assumptions.",
    fix: "Remove ignoreExpiration and handle token expiry explicitly. If a grace period is genuinely required, implement a narrow documented renewal flow rather than disabling expiry verification globally.",
    verify: "Test with an expired token and confirm it is rejected, while valid tokens continue to follow the intended authentication flow."
  }
};
