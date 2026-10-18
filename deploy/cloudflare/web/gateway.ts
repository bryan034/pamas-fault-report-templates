import { accessIssuer, verifyAccess, type AccessConfig } from "./access.ts";

type Service = { fetch(request: Request): Promise<Response> };
export type WebEnv = AccessConfig & { TEMPLATE_API: Service; ASSETS: Service };
type Verify = typeof verifyAccess;

export function privateResponse(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "same-origin");
  result.headers.set("X-Frame-Options", "DENY");
  return result;
}

export async function handleWebRequest(
  request: Request,
  env: WebEnv,
  frontend: (request: Request) => Promise<Response>,
  verify: Verify = verifyAccess,
): Promise<Response> {
  try { accessIssuer(env); }
  catch { return privateResponse(new Response("Cloudflare Access is not configured.", { status: 503 })); }
  let identity;
  try { identity = await verify(request, env); }
  catch { return privateResponse(new Response("Sign in with an approved team email to continue.", { status: 401 })); }

  // Access uses cookies. Reject cross-site writes even when a browser sends them.
  const url = new URL(request.url);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site")
      return privateResponse(new Response("Cross-site writes are not allowed.", { status: 403 }));
  }

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    // No browser cookies, Access tokens, or forged identity headers go to Python.
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (name === "cookie" || name === "authorization" || name.startsWith("cf-access-") ||
          name.startsWith("oai-authenticated-") || name === "x-template-service-token" || name === "x-template-user-email") headers.delete(name);
    }
    headers.set("X-Template-User-Email", identity.email as string);
    try {
      return privateResponse(await env.TEMPLATE_API.fetch(new Request(request, { headers, redirect: "manual" })));
    } catch {
      return privateResponse(new Response("The PDF service is starting or unavailable. Please retry shortly.", { status: 503 }));
    }
  }
  // Access proves identity, not application membership. The owner-controlled
  // database allow-list must also protect page/asset rendering. Do not cache
  // grants here: a revoked account must fail its next request.
  try {
    const membership = await env.TEMPLATE_API.fetch(new Request(
      new URL("/api/access/me", request.url),
      { headers: { "X-Template-User-Email": identity.email as string }, redirect: "manual" },
    ));
    if (membership.status === 401 || membership.status === 403)
      return privateResponse(new Response("This account has not been granted application access. Ask the administrator to approve your Google account email.", {status: 403}));
    if (!membership.ok) throw new Error("Membership service unavailable");
    const user = await membership.json() as {email?: string; role?: string; mode?: string};
    if (user.mode !== "cloudflare" || user.email !== (identity.email as string).trim().toLowerCase() ||
        !["owner", "editor", "viewer"].includes(user.role || ""))
      throw new Error("Invalid membership response");
  } catch {
    return privateResponse(new Response("Access verification is temporarily unavailable. Please retry shortly.", {status: 503}));
  }
  return privateResponse(await frontend(request));
}
