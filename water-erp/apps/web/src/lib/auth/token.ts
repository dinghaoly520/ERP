import type { AuthRole } from "@/lib/api/auth";

const VALID_ROLES: ReadonlySet<string> = new Set<AuthRole>([
  "admin",
  "procurement_staff",
  "bid_host",
  "bid_expert",
  "supplier",
  "mall",
]);

type AuthenticatedUser = {
  sub: string;
  username: string;
  role: AuthRole;
};

export function decodeAuthToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Partial<AuthenticatedUser>;

    if (
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      typeof payload.role !== "string" ||
      !VALID_ROLES.has(payload.role)
    ) {
      return null;
    }

    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
    } satisfies AuthenticatedUser;
  } catch {
    return null;
  }
}
