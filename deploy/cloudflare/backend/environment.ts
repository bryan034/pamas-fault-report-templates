export type BackendSecrets = {
  TEMPLATE_DATABASE_URL: string;
  TEMPLATE_SERVICE_TOKEN: string;
  TEMPLATE_DATABASE_SCHEMA: string;
  TEMPLATE_ENVIRONMENT: string;
  TEMPLATE_OWNER_EMAIL: string;
  TEMPLATE_PUBLIC_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ONLYOFFICE_JWT_SECRET: string;
  TEMPLATE_MIGRATE_ON_START?: "true" | "false";
};

export function containerEnvironment(env: BackendSecrets): Record<string, string> {
  if (!["staging", "production"].includes(env.TEMPLATE_ENVIRONMENT) ||
      !env.TEMPLATE_DATABASE_URL?.startsWith("postgresql+psycopg://") ||
      !/[?&]sslmode=(require|verify-ca|verify-full)(&|$)/.test(env.TEMPLATE_DATABASE_URL) ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(env.TEMPLATE_DATABASE_SCHEMA || "") ||
      ["public", "auth", "storage", "pg_catalog", "information_schema"].includes(env.TEMPLATE_DATABASE_SCHEMA) ||
      !env.TEMPLATE_SERVICE_TOKEN || env.TEMPLATE_SERVICE_TOKEN.length < 32 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.TEMPLATE_OWNER_EMAIL || "") ||
      !/^https:\/\/[^/?#]+$/.test(env.TEMPLATE_PUBLIC_ORIGIN || "") ||
      (env.TEMPLATE_MIGRATE_ON_START !== undefined && !["true", "false"].includes(env.TEMPLATE_MIGRATE_ON_START)) ||
      !env.ONLYOFFICE_JWT_SECRET || env.ONLYOFFICE_JWT_SECRET.length < 32 ||
      !env.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com") || !env.GOOGLE_CLIENT_SECRET)
    throw new Error("Configure the backend database, service token, Google credentials, origin and owner");
  return {
    TEMPLATE_DATABASE_URL: env.TEMPLATE_DATABASE_URL,
    TEMPLATE_SERVICE_TOKEN: env.TEMPLATE_SERVICE_TOKEN,
    TEMPLATE_DATABASE_SCHEMA: env.TEMPLATE_DATABASE_SCHEMA,
    TEMPLATE_ENVIRONMENT: env.TEMPLATE_ENVIRONMENT,
    TEMPLATE_OWNER_EMAIL: env.TEMPLATE_OWNER_EMAIL,
    TEMPLATE_ACCESS_MODE: "google",
    TEMPLATE_PUBLIC_ORIGIN: env.TEMPLATE_PUBLIC_ORIGIN,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    ONLYOFFICE_JWT_SECRET: env.ONLYOFFICE_JWT_SECRET,
    TEMPLATE_MIGRATE_ON_START: env.TEMPLATE_MIGRATE_ON_START || "true",
    WORD_CONVERSION_ENGINE: "onlyoffice",
    ONLYOFFICE_INTERNAL_URL: "http://onlyoffice.internal",
    ONLYOFFICE_CALLBACK_BASE: "http://templates.internal",
  };
}
