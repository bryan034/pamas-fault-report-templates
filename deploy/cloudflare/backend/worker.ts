import { Container, ContainerProxy } from "@cloudflare/containers";
import { containerEnvironment, type BackendSecrets } from "./environment";
import { CONVERTER_HOST, SOURCE_HOST, conversionRoute, waitForConverter } from "./conversion";
export { ContainerProxy };

type Env = BackendSecrets & {
  TEMPLATE_CONTAINER: DurableObjectNamespace<TemplateContainer>;
  ONLYOFFICE_CONTAINER: DurableObjectNamespace<OnlyOfficeContainer>;
};

export class TemplateContainer extends Container<Env> {
  defaultPort = 8000;
  sleepAfter = "15m";
  envVars = containerEnvironment(this.env);
}

export class OnlyOfficeContainer extends Container<Env> {
  defaultPort = 80;
  sleepAfter = "15m";
  // The converter can only fetch signed document sources through the private handler.
  enableInternet = false;
  envVars = {
    JWT_ENABLED: "true",
    JWT_SECRET: this.env.ONLYOFFICE_JWT_SECRET,
    JWT_HEADER: "Authorization",
    ALLOW_PRIVATE_IP_ADDRESS: "true",
    ALLOW_META_IP_ADDRESS: "false",
  };
}

TemplateContainer.outboundByHost = {
  [CONVERTER_HOST]: async (request: Request, environment: unknown) => {
    if (conversionRoute(request) !== "converter") return new Response(null, { status: 403 });
    const env = environment as Env;
    const converter = env.ONLYOFFICE_CONTAINER.getByName("word-converter");
    await converter.startAndWaitForPorts({
      ports: [80], cancellationOptions: { portReadyTimeoutMS: 180_000 },
    });
    if (request.method === "POST") await waitForConverter(converter);
    return converter.fetch(request);
  },
};
OnlyOfficeContainer.outboundByHost = {
  [SOURCE_HOST]: async (request: Request, environment: unknown) => {
    if (conversionRoute(request) !== "source") return new Response(null, { status: 403 });
    const env = environment as Env;
    return env.TEMPLATE_CONTAINER.getByName("shared-team").fetch(request);
  },
};

// No public routes or workers.dev hostname. Only the frontend service binding
// can reach this gateway. Conversion/cache endpoints are never browser routes.
const worker = {
  async fetch(request: Request, env: Env) {
    if (!new URL(request.url).pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    try {
      containerEnvironment(env);
      const headers = new Headers(request.headers);
      headers.set("X-Template-Service-Token", env.TEMPLATE_SERVICE_TOKEN);
      return await env.TEMPLATE_CONTAINER.getByName("shared-team").fetch(
        new Request(request, { headers, redirect: "manual" }),
      );
    } catch {
      return new Response("Template service unavailable; retry shortly.", {
        status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3" },
      });
    }
  },
};

export default worker;
