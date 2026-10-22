/** Routes reachable only from container egress; never exposed by the web gateway. */
export const CONVERTER_HOST = "onlyoffice.internal";
export const SOURCE_HOST = "templates.internal";

export function conversionRoute(request: Request): "converter" | "source" | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || url.port || /%|\\|\.\./.test(url.pathname)) return null;
  if (url.hostname === CONVERTER_HOST && (
    (request.method === "POST" && url.pathname === "/converter" && !url.search) ||
    (request.method === "GET" && url.pathname.startsWith("/cache/files/"))
  )) return "converter";
  if (url.hostname === SOURCE_HOST && request.method === "GET" &&
      /^\/api\/word-conversion\/[a-f0-9-]{36}\/source$/.test(url.pathname) &&
      url.searchParams.has("token")) return "source";
  return null;
}

/** Wait for document services, not just nginx's listening port, after a cold start. */
export async function waitForConverter(
  converter: { fetch(request: Request): Promise<Response> },
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1000)),
): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (let attempt = 0; attempt < 120 && Date.now() < deadline; attempt++) {
    try {
      const response = await converter.fetch(new Request(`http://${CONVERTER_HOST}/healthcheck`, { signal: AbortSignal.timeout(3000) }));
      const body = await response.text();
      const healthy = response.ok && body.trim() === "true";
      if (healthy) return;
    } catch { /* Startup can temporarily refuse connections. */ }
    await pause();
  }
  throw new Error("Word converter is starting or unavailable; retry shortly");
}
