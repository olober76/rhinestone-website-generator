/**
 * Halftone Studio — Electron Main Process
 *
 * Spawns a Python CLI bridge process (no web server) and communicates
 * via stdin/stdout JSON messages.  Fully local — zero network calls.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const fs = require("fs");

// ── Paths ──
const isDev = !app.isPackaged;

const backendDir = isDev
  ? path.join(__dirname, "..", "backend")
  : path.join(process.resourcesPath, "backend");

// ── State ──
let mainWindow = null;
let bridgeProcess = null;
let bridgeReady = false;

// Sequential request queue (Python is single-threaded)
const pendingRequests = [];
const requestQueue = [];
let currentRequest = null;

// ── Settings (simple JSON in userData) ──
const settingsPath = path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath))
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {}
  return { saveDirectory: app.getPath("downloads") };
}

function saveSettings(s) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
}

// ── Find Python 3 ──
function findPython() {
  const candidates =
    process.platform === "win32"
      ? ["python", "python3", "py"]
      : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const ver = execSync(`${cmd} --version`, {
        encoding: "utf-8",
        timeout: 5000,
        windowsHide: true,
      }).trim();
      if (ver.includes("3.")) return cmd;
    } catch {}
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Python CLI Bridge — stdin/stdout JSON protocol
// ═══════════════════════════════════════════════════════════════════════

function startBridge() {
  const pythonCmd = findPython();
  if (!pythonCmd) {
    dialog.showErrorBox(
      "Python Not Found",
      "Halftone Studio requires Python 3.9+ installed on your system.\n\n" +
        "Please install Python from https://python.org and try again.\n" +
        "Make sure to check 'Add Python to PATH' during installation.",
    );
    app.quit();
    return;
  }

  console.log(`[Bridge] Starting: ${pythonCmd} cli_bridge.py  (cwd: ${backendDir})`);

  bridgeProcess = spawn(pythonCmd, ["cli_bridge.py"], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  // ── stdout: line-delimited JSON, sequential response matching ──
  let buffer = "";
  bridgeProcess.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete tail
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.status === "ready") {
          console.log("[Bridge] Ready");
          bridgeReady = true;
          // flush pending
          while (pendingRequests.length) {
            requestQueue.push(pendingRequests.shift());
          }
          processQueue();
          continue;
        }
        // Resolve current sequential request
        if (currentRequest) {
          const { resolve, reject } = currentRequest;
          currentRequest = null;
          if (msg.ok === false) reject(new Error(msg.error || "Bridge error"));
          else resolve(msg);
          processQueue();
        }
      } catch (e) {
        console.error("[Bridge] Parse error:", e.message);
        if (currentRequest) {
          currentRequest.reject(e);
          currentRequest = null;
          processQueue();
        }
      }
    }
  });

  bridgeProcess.stderr.on("data", (data) => {
    console.log(`[Bridge:err] ${data.toString().trim()}`);
  });

  bridgeProcess.on("error", (err) => {
    console.error("[Bridge] Spawn error:", err.message);
    dialog.showErrorBox(
      "Backend Error",
      `Failed to start the processing engine:\n${err.message}\n\n` +
        "Make sure Python 3.9+ is installed with:\n" +
        "  pip install numpy opencv-python-headless scikit-image Pillow cairosvg shapely",
    );
  });

  bridgeProcess.on("exit", (code) => {
    console.log(`[Bridge] Exited with code ${code}`);
    bridgeProcess = null;
    bridgeReady = false;
    // reject inflight
    if (currentRequest) {
      currentRequest.reject(new Error("Bridge exited"));
      currentRequest = null;
    }
    for (const req of requestQueue) req.reject(new Error("Bridge exited"));
    requestQueue.length = 0;
  });
}

function processQueue() {
  if (currentRequest) return;
  if (requestQueue.length === 0) return;
  currentRequest = requestQueue.shift();
  if (!bridgeProcess || !bridgeProcess.stdin.writable) {
    currentRequest.reject(new Error("Bridge not running"));
    currentRequest = null;
    processQueue();
    return;
  }
  bridgeProcess.stdin.write(JSON.stringify(currentRequest.payload) + "\n");
}

/** Send a command to the Python bridge and await the response. */
function sendToBridge(payload) {
  return new Promise((resolve, reject) => {
    if (!bridgeReady) {
      pendingRequests.push({ payload, resolve, reject });
      return;
    }
    requestQueue.push({ payload, resolve, reject });
    processQueue();
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Window
// ═══════════════════════════════════════════════════════════════════════

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Halftone Studio",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0f0f0f",
    show: false,
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "..", "frontend", "dist", "index.html"),
    );
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// IPC — image processing (fully local via Python bridge, NO HTTP)
// ═══════════════════════════════════════════════════════════════════════

ipcMain.handle("python:upload", async (_ev, imageB64, canvasW, canvasH) => {
  return sendToBridge({
    cmd: "upload",
    image_b64: imageB64,
    canvas_width: canvasW,
    canvas_height: canvasH,
  });
});

ipcMain.handle("python:regenerate", async (_ev, paramsObj) => {
  return sendToBridge({ cmd: "regenerate", params: paramsObj });
});

ipcMain.handle("python:export", async (_ev, dots, fmt, w, h, dotShape) => {
  return sendToBridge({
    cmd: "export",
    dots,
    format: fmt,
    width: w,
    height: h,
    dot_shape: dotShape,
  });
});

// ═══════════════════════════════════════════════════════════════════════
// IPC — file save dialogs
// ═══════════════════════════════════════════════════════════════════════

ipcMain.handle("dialog:pickSaveDirectory", async () => {
  const settings = loadSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Export Directory",
    defaultPath: settings.saveDirectory,
    properties: ["openDirectory", "createDirectory"],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    settings.saveDirectory = result.filePaths[0];
    saveSettings(settings);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("settings:getSaveDirectory", () => loadSettings().saveDirectory);

ipcMain.handle("file:saveToDirectory", async (_ev, filename, dataB64) => {
  const dir = loadSettings().saveDirectory;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, filename);
  fs.writeFileSync(fp, Buffer.from(dataB64, "base64"));
  return fp;
});

ipcMain.handle("file:saveAs", async (_ev, filename, dataB64) => {
  const settings = loadSettings();
  const ext = path.extname(filename).slice(1);
  const filterMap = {
    svg: { name: "SVG Image", extensions: ["svg"] },
    png: { name: "PNG Image", extensions: ["png"] },
    jpg: { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save Export",
    defaultPath: path.join(settings.saveDirectory, filename),
    filters: [filterMap[ext] || { name: "All Files", extensions: ["*"] }],
  });
  if (!result.canceled && result.filePath) {
    settings.saveDirectory = path.dirname(result.filePath);
    saveSettings(settings);
    fs.writeFileSync(result.filePath, Buffer.from(dataB64, "base64"));
    return result.filePath;
  }
  return null;
});

ipcMain.handle("shell:openDirectory", async (_ev, dirPath) => {
  shell.openPath(dirPath);
});

// ═══════════════════════════════════════════════════════════════════════
// App lifecycle
// ═══════════════════════════════════════════════════════════════════════

app.whenReady().then(() => {
  startBridge();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (bridgeProcess) {
    console.log("[Bridge] Shutting down...");
    bridgeProcess.kill();
    bridgeProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
});
