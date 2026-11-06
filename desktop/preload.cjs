"use strict";
// The only desktop abilities the page can reach. File paths stay in the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reportFormatterDesktop", {
  lastBackupAt: () => ipcRenderer.invoke("backup:last"),
  backup: () => ipcRenderer.invoke("backup:create"),
  restore: () => ipcRenderer.invoke("backup:restore"),
});
