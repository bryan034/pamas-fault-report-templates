import { createRemoteJWKSet, jwtVerify } from "jose";

export type AccessConfig = { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string };
type KeySet = ReturnType<typeof createRemoteJWKSet>;
const keySets = new Map<string, KeySet>();

export function accessIssuer(config: AccessConfig): string {
  // Restrict JWKS fetching to the configured Cloudflare Access team, never a URL
  // supplied by a request/JWT. Missing setup must fail closed.
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(config.ACCESS_TEAM_DOMAIN || "") ||
      !/^[a-f0-9]{64}$/.test(config.ACCESS_AUD || "")) {
    throw new Error("Configure the Cloudflare Access team domain and application AUD");
  }
  return `https://${config.ACCESS_TEAM_DOMAIN}`;
}

export async function verifyAccess(request: Request, config: AccessConfig) {
  const issuer = accessIssuer(config);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("Missing Access token");
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keySets.set(issuer, keys);
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: config.ACCESS_AUD,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"],
  });
  if (typeof payload.email !== "string" || !payload.email.trim())
    throw new Error("A team user identity is required");
  return payload;
}
