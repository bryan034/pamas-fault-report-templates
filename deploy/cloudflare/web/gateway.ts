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
  try { await verify(request, env); }
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
          name.startsWith("oai-authenticated-") || name === "x-template-service-token") headers.delete(name);
    }
    try {
      return privateResponse(await env.TEMPLATE_API.fetch(new Request(request, { headers, redirect: "manual" })));
    } catch {
      return privateResponse(new Response("The PDF service is starting or unavailable. Please retry shortly.", { status: 503 }));
    }
  }
  return privateResponse(await frontend(request));
}
