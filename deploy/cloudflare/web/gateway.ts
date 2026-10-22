/** Same-origin transport only. Python owns Google login, sessions and grants. */
type Service = { fetch(request: Request): Promise<Response> };
export type WebEnv = { TEMPLATE_API: Service; ASSETS: Service };

export function privateResponse(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Frame-Options", "DENY");
  return result;
}

export async function handleWebRequest(
  request: Request, env: WebEnv,
  frontend: (request: Request) => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    for (const name of [...headers.keys()]) {
      if (name === "authorization" || name.startsWith("cf-access-") ||
          name.startsWith("oai-authenticated-") || name === "x-template-service-token" ||
          name === "x-template-user-email") headers.delete(name);
    }
    try {
      return privateResponse(await env.TEMPLATE_API.fetch(new Request(request, { headers, redirect: "manual" })));
    } catch {
      return privateResponse(new Response("The PDF service is starting or unavailable. Please retry shortly.", { status: 503 }));
    }
  }
  // Public application shell contains no reports; every data route is checked by Python.
  return privateResponse(await frontend(request));
}
