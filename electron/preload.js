/**
 * Halftone Studio — Electron Preload Script
 *
 * Exposes safe IPC methods to the renderer process.
 * All image processing goes through Python bridge (no HTTP).
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Identity ──
  isElectron: true,

  // ── Python processing (fully local, no network) ──
  uploadImage: (imageB64, canvasW, canvasH) =>
    ipcRenderer.invoke("python:upload", imageB64, canvasW, canvasH),

  regenerateDots: (sessionId, params) =>
    ipcRenderer.invoke("python:regenerate", sessionId, params),

  exportPattern: (dots, format, width, height, dotShape) =>
    ipcRenderer.invoke("python:export", dots, format, width, height, dotShape),

  // ── File save dialogs ──
  pickSaveDirectory: () => ipcRenderer.invoke("dialog:pickSaveDirectory"),
  getSaveDirectory: () => ipcRenderer.invoke("settings:getSaveDirectory"),
  saveToDirectory: (filename, dataB64) =>
    ipcRenderer.invoke("file:saveToDirectory", filename, dataB64),
  saveAs: (filename, dataB64) =>
    ipcRenderer.invoke("file:saveAs", filename, dataB64),
  openDirectory: (dirPath) =>
    ipcRenderer.invoke("shell:openDirectory", dirPath),
});
