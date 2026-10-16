-- Run once per NEW staging/production Supabase project using SQL Editor.
-- App tables are deliberately not in public (the default Data API schema).
-- This does not migrate any existing local data.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report_formatter_app') THEN
    CREATE ROLE report_formatter_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
CREATE SCHEMA IF NOT EXISTS report_formatter;
REVOKE ALL ON SCHEMA report_formatter FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA report_formatter FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA report_formatter FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA report_formatter
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA report_formatter
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
GRANT USAGE, CREATE ON SCHEMA report_formatter TO report_formatter_app;
GRANT ALL ON ALL TABLES IN SCHEMA report_formatter TO report_formatter_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA report_formatter TO report_formatter_app;
ALTER DEFAULT PRIVILEGES FOR ROLE report_formatter_app IN SCHEMA report_formatter
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE report_formatter_app IN SCHEMA report_formatter
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
COMMIT;

-- Set report_formatter_app's password separately in the Supabase SQL Editor;
-- never commit it here. Startup needs CREATE privileges for new app tables.
