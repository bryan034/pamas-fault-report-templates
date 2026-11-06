// Build the Windows installer on this computer. Everything is prepared locally so
// the bundled templates never pass through a shared build service.
//   npm run seed            (once, and whenever the bundled templates should change)
//   npm run build:windows
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const PYTHON = "cpython-3.12.14-windows-x86_64-none";
const LIBREOFFICE_VERSION = "26.2.7";
const LIBREOFFICE_SHA256 = "480fecf759fc6393bd614fbf43753eb95a8198fc1a065d41b727e3b664cd1e59";
const LIBREOFFICE_MSI = `LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`;
// Stable-channel files move to the archive once superseded.
const LIBREOFFICE_URLS = [
  `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/${LIBREOFFICE_MSI}`,
  `https://downloadarchive.documentfoundation.org/libreoffice/old/${LIBREOFFICE_VERSION}.2/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}.2_Win_x86-64.msi`,
];
// Not used to turn a .docx into a PDF. Dictionaries and translations are most of the size.
const LIBREOFFICE_UNUSED = ["help", "readmes", "share/extensions", "share/gallery", "share/template", "share/wizards", "program/resource"];

const desktop = fileURLToPath(new URL("../", import.meta.url));
const root = join(desktop, "..");
const build = join(desktop, ".build");
const cache = join(build, "cache");
const windows = join(build, "windows");
const uvEnvironment = { ...process.env, UV_CACHE_DIR: join(root, "backend", ".uv-cache") };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed with exit code ${result.status}`);
  return result;
}

const step = message => console.log(`\n== ${message}`);

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadLibreOffice() {
  const target = join(cache, LIBREOFFICE_MSI);
  if (existsSync(target) && (await sha256(target)) === LIBREOFFICE_SHA256) return target;
  for (const url of LIBREOFFICE_URLS) {
    const response = await fetch(url);
    if (!response.ok) continue;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
    if ((await sha256(target)) === LIBREOFFICE_SHA256) return target;
    await rm(target);
    throw new Error(`${url} did not match the expected checksum`);
  }
  throw new Error(`Could not download ${LIBREOFFICE_MSI}. Choose a current version from libreoffice.org and update this script.`);
}

/**
 * The MSI is extracted, not installed, in a throwaway Linux container. It holds x86,
 * x64 and ARM64 copies of the Microsoft runtime under one name, and msiextract keeps
 * whichever comes last, so the x64 copies are pulled out of its cabinet by their keys.
 */
function extractMsi(output) {
  const script = `set -e
    apt-get update -qq >/dev/null
    apt-get install -y -qq msitools cabextract >/dev/null 2>&1
    msiextract -C /out "/in/$MSI_NAME" >/dev/null
    msiinfo extract "/in/$MSI_NAME" libreoffice1.cab > /tmp/libreoffice.cab
    mkdir /out/runtime
    cabextract -q -d /out/runtime -F '*.dll_amd64.*' /tmp/libreoffice.cab
    for file in /out/runtime/*; do mv "$file" "/out/runtime/$(basename "$file" | sed 's/_amd64[.].*//')"; done`;
  run("docker", ["run", "--rm", "-e", `MSI_NAME=${LIBREOFFICE_MSI}`, "-v", `${cache}:/in:ro`, "-v", `${output}:/out`, "debian:bookworm-slim", "sh", "-c", script]);
}

/** A wrong-architecture runtime only fails on the user's computer, so stop the build here. */
function assertWindowsX64(path) {
  const file = readFileSync(path);
  const machine = file.readUInt16LE(file.readUInt32LE(0x3c) + 4);
  if (machine !== 0x8664) throw new Error(`${path} is not an x64 Windows file`);
}

async function prepareLibreOffice() {
  const extracted = join(cache, `libreoffice-${LIBREOFFICE_VERSION}`);
  if (!existsSync(join(extracted, "runtime", "msvcp140.dll"))) {
    await rm(extracted, { recursive: true, force: true });
    await mkdir(extracted, { recursive: true });
    await downloadLibreOffice();
    extractMsi(extracted);
  }
  const target = join(windows, "libreoffice");
  await cp(join(extracted, "LibreOffice:."), target, { recursive: true });
  for (const unused of LIBREOFFICE_UNUSED) await rm(join(target, unused), { recursive: true, force: true });
  // Normally installed system-wide by the MSI. Keeping them beside soffice needs no
  // administrator rights and no separate Visual C++ installation on a clean computer.
  const runtime = await readdir(join(extracted, "runtime"));
  if (!runtime.includes("vcruntime140.dll")) throw new Error("LibreOffice's Microsoft runtime files were not found");
  for (const name of runtime) {
    assertWindowsX64(join(extracted, "runtime", name));
    await cp(join(extracted, "runtime", name), join(target, "program", name));
  }
  // Layout-compatible fonts (Carlito for Calibri, Liberation for Arial) that the MSI
  // would add to Windows. Used only when the computer lacks the document's font.
  await cp(join(extracted, "Fonts"), join(target, "share", "fonts", "truetype"), { recursive: true });
}

async function preparePython() {
  run("uv", ["python", "install", PYTHON, "--no-bin", "--install-dir", join(cache, "uv-python")], { env: uvEnvironment });
  const [folder] = (await readdir(join(cache, "uv-python"))).filter(name => name.startsWith("cpython-3.12") && name.includes("windows"));
  const source = join(cache, "uv-python", folder);
  // Skip uv's Unix-style "python" link: it is meaningless on Windows.
  await cp(source, join(windows, "python"), { recursive: true, filter: path => path !== join(source, "python") });
  for (const unused of ["include", "libs", "Scripts", "Lib/test", "Lib/idlelib", "Lib/tkinter", "Lib/ensurepip", "tcl"]) {
    await rm(join(windows, "python", unused), { recursive: true, force: true });
  }
}

async function prepareBackend() {
  const target = join(windows, "backend");
  await mkdir(target, { recursive: true });
  for (const item of ["app", "migrations", "alembic.ini"]) await cp(join(root, "backend", item), join(target, item), { recursive: true, filter: source => !source.includes("__pycache__") });
  const requirements = join(cache, "requirements.txt");
  const { stdout } = run("uv", ["export", "--project", join(root, "backend"), "--frozen", "--no-dev", "--no-emit-project", "--format", "requirements-txt"], { env: uvEnvironment, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  await writeFile(requirements, stdout);
  // Exact versions and checksums from uv.lock, in their Windows builds.
  run("uv", ["pip", "install", "--no-config", "--require-hashes", "-r", requirements,
    "--target", join(target, "site-packages"), "--python-platform", "x86_64-pc-windows-msvc", "--python-version", "3.12", "--only-binary", ":all:"],
  { env: uvEnvironment });
  // Bytecode is portable within Python 3.12, and precompiling makes each launch faster.
  run("uv", ["run", "--no-project", "--python", "3.12", "python", "-m", "compileall", "-q", "--invalidation-mode", "unchecked-hash", target, join(windows, "python", "Lib")],
    { env: uvEnvironment, stdio: ["ignore", "ignore", "inherit"] });
}

async function folderSize(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

const seed = join(build, "seed", "templates.sqlite");
if (!existsSync(seed)) throw new Error("Bundled templates are missing. Run: npm run seed");

step("Building the web interface");
run(process.execPath, [join(desktop, "scripts", "build-web.mjs")]);

await rm(windows, { recursive: true, force: true });
await mkdir(windows, { recursive: true });
await mkdir(cache, { recursive: true });
step("Preparing Windows Python");
await preparePython();
step("Preparing the backend and its Windows packages");
await prepareBackend();
step(`Preparing LibreOffice ${LIBREOFFICE_VERSION}`);
await prepareLibreOffice();
for (const part of ["python", "backend", "libreoffice"]) {
  console.log(`  ${part}: ${Math.round((await folderSize(join(windows, part))) / 1e6)} MB`);
}

step("Creating the installer");
run(join(desktop, "node_modules", ".bin", "electron-builder"), ["--win", "nsis", "--x64", "--publish", "never"], { cwd: desktop, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
console.log(`\nInstaller written to ${join(desktop, "dist")}`);
