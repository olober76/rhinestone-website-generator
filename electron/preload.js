/**
 * Halfstone Studio — Electron Preload Script
 *
 * Exposes safe IPC methods to the renderer process.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Check if running in Electron
  isElectron: true,

  // Pick a directory for saving exports
  pickSaveDirectory: () => ipcRenderer.invoke("dialog:pickSaveDirectory"),

  // Get the currently configured save directory
  getSaveDirectory: () => ipcRenderer.invoke("settings:getSaveDirectory"),

  // Save a file (base64 data) directly to the configured directory
  saveToDirectory: (filename, dataB64) =>
    ipcRenderer.invoke("file:saveToDirectory", filename, dataB64),

  // Save with native "Save As" dialog
  saveAs: (filename, dataB64) =>
    ipcRenderer.invoke("file:saveAs", filename, dataB64),

  // Open a folder in the system file explorer
  openDirectory: (dirPath) =>
    ipcRenderer.invoke("shell:openDirectory", dirPath),
});
