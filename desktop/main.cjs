"use strict";
// Report Formatter desktop shell: starts the private Python backend and shows the app.
const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BACKUP_EXTENSION = "rfbackup";
const STARTUP_TIMEOUT_MS = 180_000; // First launch on a slow PC, with antivirus scanning.
const token = randomBytes(32).toString("hex");

let backend = null;
let origin = null;
let window = null;
let quitting = false;

const dataDir = () => path.join(app.getPath("userData"), "data");
const settingsPath = () => path.join(app.getPath("userData"), "desktop-settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(changes) {
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...changes }, null, 2));
}

function locations() {
  const here = path.join(__dirname, "..");
  if (app.isPackaged) {
    const resources = process.resourcesPath;
    return {
      python: path.join(resources, "python", "python.exe"),
      backend: path.join(resources, "backend"),
      web: path.join(resources, "web"),
      seed: path.join(resources, "seed", "templates.sqlite"),
      libreOffice: path.join(resources, "libreoffice", "program", "soffice.com"),
    };
  }
  return {
    python: path.join(here, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    backend: path.join(here, "backend"),
    web: path.join(here, "desktop", ".build", "web"),
    seed: process.env.REPORT_FORMATTER_SEED || path.join(here, "desktop", ".build", "seed", "templates.sqlite"),
    libreOffice: process.env.LIBREOFFICE_BINARY || "",
  };
}

function backendEnvironment(where) {
  const environment = { ...process.env };
  // A computer's own Python or application settings must not change this app's behaviour.
  for (const name of Object.keys(environment)) {
    if (/^(PYTHON|TEMPLATE_|WORD_CONVERSION_|ONLYOFFICE_|GOOGLE_|VIRTUAL_ENV)/i.test(name)) delete environment[name];
  }
  return {
    ...environment,
    TEMPLATE_DESKTOP_TOKEN: token,
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    ...(app.isPackaged ? { PYTHONPATH: where.backend + path.delimiter + path.join(where.backend, "site-packages") } : {}),
    ...(where.libreOffice ? { LIBREOFFICE_BINARY: where.libreOffice } : {}),
  };
}

/** Start the backend and resolve with its origin once it answers health checks. */
function startBackend() {
  const where = locations();
  const logs = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logs, { recursive: true });
  const log = fs.createWriteStream(path.join(logs, "backend.log"), { flags: "w" });
  const child = spawn(
    where.python,
    ["-m", "app.desktop", "--data-dir", dataDir(), "--web-dir", where.web,
      ...(fs.existsSync(where.seed) ? ["--seed", where.seed] : [])],
    { cwd: where.backend, env: backendEnvironment(where), stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  backend = child;
  child.stderr.pipe(log);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The app took too long to start.")), STARTUP_TIMEOUT_MS);
    const finish = (action, value) => {
      clearTimeout(timer);
      action(value);
    };
    child.once("error", error => finish(reject, error));
    child.once("exit", code => {
      if (backend === child) backend = null;
      finish(reject, new Error(`The app's background service stopped (code ${code}).`));
      if (!quitting && origin && backend === null) void backendCrashed();
    });
    let output = "";
    child.stdout.on("data", chunk => {
      log.write(chunk);
      if (output === null) return;
      output += chunk;
      const match = /REPORT_FORMATTER_PORT=(\d+)/.exec(output);
      if (!match) return;
      output = null;
      const address = `http://127.0.0.1:${match[1]}`;
      waitForHealth(address, child).then(() => finish(resolve, address), error => finish(reject, error));
    });
  });
}

async function waitForHealth(address, child) {
  while (child.exitCode === null) {
    try {
      const response = await fetch(`${address}/api/health`, { headers: { "X-Desktop-Token": token } });
      if (response.ok) return;
    } catch {
      // Not listening yet: database upgrades run before the server accepts requests.
    }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error("The app's background service stopped while starting.");
}

function stopBackend() {
  const child = backend;
  backend = null;
  origin = null;
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const forced = setTimeout(() => child.kill(), 5000);
    child.once("exit", () => {
      clearTimeout(forced);
      resolve();
    });
    child.stdin.end(); // The backend exits when its stdin closes.
  });
}

/** Add the launch token to this app's requests only; the page itself never sees it. */
function sendTokenTo(address) {
  // Registering again replaces the previous listener, after a restart changes the port.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${address}/*`] }, (details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, "X-Desktop-Token": token } });
  });
}

async function showApp() {
  origin = await startBackend();
  sendTokenTo(origin);
  await window.loadURL(`${origin}/`);
}

async function backendCrashed() {
  origin = null;
  const { response } = await dialog.showMessageBox(window, {
    type: "error",
    title: "Report Formatter",
    message: "Report Formatter stopped unexpectedly.",
    detail: "Your saved work is safe. Anything not yet saved may need to be entered again.",
    buttons: ["Restart", "Close"],
  });
  if (response !== 0) return app.quit();
  await showApp().catch(startupFailed);
}

function startupFailed(error) {
  if (quitting) return;
  dialog.showErrorBox(
    "Report Formatter could not start",
    `${error.message}\n\nRestart your computer and try again. If it still does not open, send this file to your support contact:\n${path.join(app.getPath("userData"), "logs", "backend.log")}`,
  );
  app.quit();
}

async function postPath(route, target) {
  const response = await fetch(`${origin}/api/desktop/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Desktop-Token": token },
    body: JSON.stringify({ path: target }),
  });
  if (response.ok) return null;
  const problem = await response.json().catch(() => null);
  return typeof problem?.detail === "string" ? problem.detail : "That did not work. Please try again.";
}

async function createBackup() {
  const settings = readSettings();
  const date = new Date().toISOString().slice(0, 10);
  const name = `Report Formatter backup ${date}.${BACKUP_EXTENSION}`;
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: "Save backup to a USB drive or cloud folder (OneDrive, Google Drive, Dropbox)",
    defaultPath: path.join(settings.backupFolder || app.getPath("documents"), name),
    filters: [{ name: "Report Formatter backup", extensions: [BACKUP_EXTENSION] }],
    buttonLabel: "Save backup",
  });
  if (canceled || !filePath) return { status: "cancelled" };
  const problem = await postPath("backup", filePath);
  if (problem) return { status: "failed", message: problem };
  const lastBackupAt = new Date().toISOString();
  saveSettings({ backupFolder: path.dirname(filePath), lastBackupAt });
  await dialog.showMessageBox(window, {
    type: "info",
    title: "Backup saved",
    message: "Your backup was saved.",
    detail: `${filePath}\n\nThis includes all saved templates and reports. Unsaved changes on screen are not included.`,
  });
  return { status: "saved", lastBackupAt };
}

async function restoreBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: "Choose a backup to restore",
    defaultPath: readSettings().backupFolder || app.getPath("documents"),
    filters: [{ name: "Report Formatter backup", extensions: [BACKUP_EXTENSION] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths.length) return { status: "cancelled" };
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    title: "Restore this backup?",
    message: "Replace everything in Report Formatter with this backup?",
    detail: `${filePaths[0]}\n\nTemplates and reports saved after this backup will no longer appear. Unsaved changes on screen will be lost.`,
    buttons: ["Cancel", "Replace with backup"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { status: "cancelled" };
  const problem = await postPath("restore", filePaths[0]);
  if (problem) return { status: "failed", message: problem };
  await stopBackend();
  await showApp().catch(startupFailed);
  return { status: "restored" };
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    title: "Report Formatter",
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    window = null;
  });

  const isAppUrl = url => {
    try {
      return Boolean(origin) && new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  // Nothing in this app is meant to open a website.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // Electron has no built-in prompt for a page's "unsaved changes" warning.
  window.webContents.on("will-prevent-unload", event => {
    const response = dialog.showMessageBoxSync(window, {
      type: "warning",
      title: "Unsaved changes",
      message: "You have unsaved changes. Leave without saving?",
      buttons: ["Stay", "Leave without saving"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, "starting.html"));
}

if (!app.requestSingleInstanceLock()) {
  // Opening the icon twice focuses the running app instead of sharing its database.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle("backup:last", () => readSettings().lastBackupAt ?? null);
  ipcMain.handle("backup:create", () => createBackup());
  ipcMain.handle("backup:restore", () => restoreBackup());

  app.whenReady().then(() => {
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    createWindow();
    showApp().catch(startupFailed);
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", event => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    stopBackend().finally(() => app.quit());
  });
}
