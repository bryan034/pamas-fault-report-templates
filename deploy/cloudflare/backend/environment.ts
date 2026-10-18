export type BackendSecrets = {
  TEMPLATE_DATABASE_URL: string;
  TEMPLATE_SERVICE_TOKEN: string;
  TEMPLATE_DATABASE_SCHEMA: string;
  TEMPLATE_ENVIRONMENT: string;
  TEMPLATE_OWNER_EMAIL: string;
};

export function containerEnvironment(env: BackendSecrets): Record<string, string> {
  if (!["staging", "production"].includes(env.TEMPLATE_ENVIRONMENT) ||
      !env.TEMPLATE_DATABASE_URL?.startsWith("postgresql+psycopg://") ||
      !/[?&]sslmode=(require|verify-ca|verify-full)(&|$)/.test(env.TEMPLATE_DATABASE_URL) ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env.TEMPLATE_DATABASE_SCHEMA || "") ||
      ["public", "auth", "storage", "pg_catalog", "information_schema"].includes(env.TEMPLATE_DATABASE_SCHEMA) ||
      !env.TEMPLATE_SERVICE_TOKEN || env.TEMPLATE_SERVICE_TOKEN.length < 32 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.TEMPLATE_OWNER_EMAIL || ""))
    throw new Error("Configure the backend environment, TLS database URL, schema, service token, and owner email");
  return {
    TEMPLATE_DATABASE_URL: env.TEMPLATE_DATABASE_URL,
    TEMPLATE_SERVICE_TOKEN: env.TEMPLATE_SERVICE_TOKEN,
    TEMPLATE_DATABASE_SCHEMA: env.TEMPLATE_DATABASE_SCHEMA,
    TEMPLATE_ENVIRONMENT: env.TEMPLATE_ENVIRONMENT,
    TEMPLATE_OWNER_EMAIL: env.TEMPLATE_OWNER_EMAIL,
  };
}
