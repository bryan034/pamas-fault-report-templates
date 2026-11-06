// Refresh the bundled templates from the local Compose database. The database volume
// is copied into a throwaway one first, so the saved data is only ever mounted read-only.
import { spawnSync } from "node:child_process";
import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_VOLUME = process.env.SEED_SOURCE_VOLUME || "fault-report-generator-source_template-postgres";
const COPY_VOLUME = "report-formatter-seed-copy";
const CONTAINER = "report-formatter-seed-postgres";
const PORT = "55439";
const POSTGRES_IMAGE = "postgres:17-alpine";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const backend = join(desktop, "..", "backend");
const target = join(desktop, ".build", "seed", "templates.sqlite");
const temporary = `${target}.new`;

function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

function removeCopy() {
  spawnSync("docker", ["rm", "-f", CONTAINER]);
  spawnSync("docker", ["volume", "rm", COPY_VOLUME]);
}

removeCopy();
rmSync(temporary, { force: true });
try {
  docker("volume", "inspect", SOURCE_VOLUME);
  docker("volume", "create", COPY_VOLUME);
  docker("run", "--rm", "-v", `${SOURCE_VOLUME}:/from:ro`, "-v", `${COPY_VOLUME}:/to`, "alpine", "cp", "-a", "/from/.", "/to/");
  docker("run", "--rm", "-v", `${COPY_VOLUME}:/data`, "alpine", "sed", "-i", "s/scram-sha-256/trust/", "/data/pg_hba.conf");
  docker("run", "-d", "--name", CONTAINER, "-v", `${COPY_VOLUME}:/var/lib/postgresql/data`, "-p", `127.0.0.1:${PORT}:5432`, POSTGRES_IMAGE);
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    ready = spawnSync("docker", ["exec", CONTAINER, "pg_isready", "-q", "-U", "templates", "-d", "templates"]).status === 0;
    if (!ready) await new Promise(done => setTimeout(done, 1000));
  }
  if (!ready) throw new Error("The temporary database did not start");
  const result = spawnSync("uv", ["run", "--frozen", "python", "-m", "app.desktop_seed", temporary], {
    cwd: backend,
    stdio: "inherit",
    env: {
      ...process.env,
      UV_CACHE_DIR: join(backend, ".uv-cache"),
      TEMPLATE_SEED_SOURCE_URL: `postgresql+psycopg://templates@127.0.0.1:${PORT}/templates`,
    },
  });
  if (result.status !== 0) throw new Error("Exporting templates failed");
  renameSync(temporary, target);
} finally {
  removeCopy();
  rmSync(temporary, { force: true });
}
