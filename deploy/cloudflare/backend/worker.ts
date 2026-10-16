import { Container } from "@cloudflare/containers";
import { containerEnvironment, type BackendSecrets } from "./environment";

type Env = BackendSecrets & { TEMPLATE_CONTAINER: DurableObjectNamespace<TemplateContainer> };

export class TemplateContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "15m";
  envVars = containerEnvironment(this.env);
}

// No public routes or workers.dev hostname. Only the frontend service binding
// can reach this gateway. Do not add a public route without authentication.
const worker = {
  async fetch(request: Request, env: Env) {
    if (!new URL(request.url).pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    try {
      containerEnvironment(env);
      const headers = new Headers(request.headers);
      headers.set("X-Template-Service-Token", env.TEMPLATE_SERVICE_TOKEN);
      const backend = env.TEMPLATE_CONTAINER.getByName("shared-team");
      return await backend.fetch(new Request(request, { headers, redirect: "manual" }));
    } catch {
      // Do not leak connection strings, upload content, or secrets in errors.
      return new Response("PDF service unavailable; retry shortly.", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  },
};

export default worker;
