import { createNeonAuth } from "@neondatabase/auth/next/server";
import { hashCloudAuthSubject } from "@ship-check/adapters";
import type { CloudAuthenticatedPrincipal } from "@ship-check/schemas";

const DEFAULT_NEON_AUTH_BASE_URL =
  "https://ep-wispy-king-zabi7c6y.neonauth.c-2.eu-west-2.aws.neon.tech/ship_check/auth";

export const neonAuthBaseUrl =
  process.env.NEON_AUTH_BASE_URL?.trim() || DEFAULT_NEON_AUTH_BASE_URL;

function cookieSecret(): string {
  const value =
    process.env.NEON_AUTH_COOKIE_SECRET?.trim() ||
    process.env.SHIP_CHECK_PILOT_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error(
      "Cloud auth requires NEON_AUTH_COOKIE_SECRET (or the transitional pilot secret) with at least 32 characters."
    );
  }
  return value;
}

export const auth = createNeonAuth({
  baseUrl: neonAuthBaseUrl,
  cookies: {
    secret: cookieSecret(),
    sessionDataTtl: 300
  }
});

type SessionShape = {
  data?: { user?: { id?: string } | null } | null;
  user?: { id?: string } | null;
};

export async function cloudSessionPrincipal(): Promise<CloudAuthenticatedPrincipal | null> {
  const result = (await auth.getSession()) as SessionShape;
  const user = result.data?.user ?? result.user;
  if (!user?.id) return null;

  return {
    schemaVersion: "0.1",
    authSubjectHash: hashCloudAuthSubject(neonAuthBaseUrl, user.id)
  };
}
