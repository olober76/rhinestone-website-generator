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

// ═══════════════════════════════════════════════════════════════════════
// File Logger — writes to halftone-studio.log in userData
// ═══════════════════════════════════════════════════════════════════════

const logDir = isDev ? path.join(__dirname, "..") : app.getPath("userData");

const logFile = path.join(logDir, "halftone-studio.log");

function initLog() {
  try {
    // Rotate if > 2 MB
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
      const old = logFile + ".old";
      if (fs.existsSync(old)) fs.unlinkSync(old);
      fs.renameSync(logFile, old);
    }
    const header =
      `\n${"=".repeat(60)}\n` +
      `Halftone Studio — ${new Date().toISOString()}\n` +
      `Platform: ${process.platform} ${process.arch}\n` +
      `Electron: ${process.versions.electron}  Node: ${process.versions.node}\n` +
      `Packaged: ${app.isPackaged}  Backend dir: ${backendDir}\n` +
      `${"=".repeat(60)}\n`;
    fs.appendFileSync(logFile, header);
  } catch (e) {
    console.error("Failed to init log file:", e.message);
  }
}

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  const line = `[${ts}] [${level}] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    fs.appendFileSync(logFile, line);
  } catch {}
}

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
      if (ver.includes("3.")) {
        log("INFO", `Found Python: ${cmd} → ${ver}`);
        return cmd;
      }
    } catch {}
  }
  log("ERROR", "Python 3 not found on PATH");
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Python CLI Bridge — stdin/stdout JSON protocol
// ═══════════════════════════════════════════════════════════════════════

// Packages the CLI bridge needs (import-name → pip-name)
const REQUIRED_PACKAGES = [
  { importName: "cv2", pipName: "opencv-python-headless" },
  { importName: "numpy", pipName: "numpy" },
  { importName: "skimage", pipName: "scikit-image" },
  { importName: "PIL", pipName: "Pillow" },
  { importName: "cairosvg", pipName: "cairosvg" },
  { importName: "shapely", pipName: "shapely" },
];

/**
 * Check which Python packages are missing and install them.
 * Shows a progress dialog while installing.
 * Returns true if all deps are satisfied, false on failure.
 */
async function ensureDependencies(pythonCmd) {
  // Write a temp check script (avoids quoting issues on Windows)
  const checkPy = path.join(app.getPath("temp"), "halftone_check_deps.py");
  const scriptLines = REQUIRED_PACKAGES.map(
    (p) =>
      `try:\n    import ${p.importName}\n    print("ok:${p.importName}")\nexcept ImportError:\n    print("miss:${p.importName}")`,
  ).join("\n");
  fs.writeFileSync(checkPy, scriptLines, "utf-8");

  let checkOutput;
  try {
    checkOutput = execSync(`${pythonCmd} "${checkPy}"`, {
      encoding: "utf-8",
      timeout: 30000,
      windowsHide: true,
      cwd: backendDir,
    });
    log("INFO", "Dependency check output:", checkOutput.trim());
  } catch (e) {
    log("ERROR", "Dependency check script failed:", e.message);
    // Fallback: try installing everything
    checkOutput = REQUIRED_PACKAGES.map((p) => `miss:${p.importName}`).join(
      "\n",
    );
  }

  const missing = REQUIRED_PACKAGES.filter((p) =>
    checkOutput.includes(`miss:${p.importName}`),
  );

  if (missing.length === 0) {
    log("INFO", "All Python dependencies satisfied");
    return true;
  }

  const pipNames = missing.map((p) => p.pipName);
  log("INFO", `Missing packages: ${pipNames.join(", ")}  — installing...`);

  // Show a non-blocking progress window
  let progressWin = new BrowserWindow({
    width: 450,
    height: 200,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: "#1a1a2e",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  progressWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:system-ui;user-select:none">
      <div style="width:40px;height:40px;border:3px solid #444;border-top:3px solid #7c3aed;
        border-radius:50%;animation:spin 1s linear infinite;margin-bottom:18px"></div>
      <div style="font-size:15px;font-weight:600">Installing Python dependencies...</div>
      <div style="font-size:12px;color:#888;margin-top:8px">${pipNames.join(", ")}</div>
      <div style="font-size:11px;color:#666;margin-top:12px">This only happens once</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </body></html>
  `)}`,
  );

  // Use spawn (array args — no shell quoting issues with spaces in paths)
  const pipArgs = ["-m", "pip", "install", "--quiet", ...pipNames];
  log("INFO", `pip command: ${pythonCmd} ${pipArgs.join(" ")}`);

  const ok = await new Promise((resolve) => {
    const pip = spawn(pythonCmd, pipArgs, {
      cwd: backendDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    pip.stdout.on("data", (d) => log("PIP", d.toString().trim()));
    pip.stderr.on("data", (d) => {
      const s = d.toString().trim();
      stderr += s + "\n";
      log("PIP:ERR", s);
    });

    pip.on("error", (err) => {
      log("ERROR", "pip spawn error:", err.message);
      resolve({ success: false, error: err.message });
    });

    pip.on("close", (code) => {
      if (code === 0) {
        log("INFO", "pip install succeeded (exit 0)");
        resolve({ success: true });
      } else {
        log("ERROR", `pip install failed (exit ${code})`);
        resolve({ success: false, error: stderr });
      }
    });
  });

  if (progressWin && !progressWin.isDestroyed()) progressWin.close();

  if (!ok.success) {
    dialog.showErrorBox(
      "Dependency Installation Failed",
      `Could not install required Python packages:\n${pipNames.join(", ")}\n\n` +
        `Error: ${ok.error}\n\n` +
        "Please run manually:\n" +
        `  pip install ${pipNames.join(" ")}`,
    );
    return false;
  }

  log("INFO", "All dependencies installed successfully");
  return true;
}

async function startBridge() {
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

  // Ensure Python packages are installed
  const depsOk = await ensureDependencies(pythonCmd);
  if (!depsOk) {
    app.quit();
    return;
  }

  log(
    "INFO",
    `Starting bridge: ${pythonCmd} cli_bridge.py  (cwd: ${backendDir})`,
  );

  bridgeProcess = spawn(pythonCmd, ["cli_bridge.py"], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  log("INFO", `Bridge PID: ${bridgeProcess.pid}`);

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
          log("INFO", "Bridge ready");
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
          const { resolve, reject, cmdName } = currentRequest;
          currentRequest = null;
          if (msg.ok === false) {
            log(
              "ERROR",
              `Bridge cmd [${cmdName}] failed:`,
              msg.error || "unknown",
            );
            reject(new Error(msg.error || "Bridge error"));
          } else {
            log(
              "INFO",
              `Bridge cmd [${cmdName}] ok — keys: ${Object.keys(msg).join(", ")}`,
            );
            resolve(msg);
          }
          processQueue();
        }
      } catch (e) {
        log(
          "ERROR",
          "Bridge parse error:",
          e.message,
          "raw:",
          line.substring(0, 200),
        );
        if (currentRequest) {
          currentRequest.reject(e);
          currentRequest = null;
          processQueue();
        }
      }
    }
  });

  bridgeProcess.stderr.on("data", (data) => {
    log("STDERR", data.toString().trim());
  });

  bridgeProcess.on("error", (err) => {
    log("ERROR", "Bridge spawn error:", err.message);
    dialog.showErrorBox(
      "Backend Error",
      `Failed to start the processing engine:\n${err.message}\n\n` +
        "Make sure Python 3.9+ is installed with:\n" +
        "  pip install numpy opencv-python-headless scikit-image Pillow cairosvg shapely",
    );
  });

  bridgeProcess.on("exit", (code) => {
    log("WARN", `Bridge exited with code ${code}`);
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
    log("ERROR", "Bridge not running, rejecting request");
    currentRequest.reject(new Error("Bridge not running"));
    currentRequest = null;
    processQueue();
    return;
  }
  const jsonStr = JSON.stringify(currentRequest.payload);
  log(
    "INFO",
    `Sending cmd [${currentRequest.cmdName}] (${jsonStr.length} bytes)`,
  );
  bridgeProcess.stdin.write(jsonStr + "\n");
}

/** Send a command to the Python bridge and await the response. */
function sendToBridge(cmdName, payload) {
  return new Promise((resolve, reject) => {
    log("INFO", `Queuing cmd [${cmdName}]`);
    if (!bridgeReady) {
      pendingRequests.push({ payload, resolve, reject, cmdName });
      return;
    }
    requestQueue.push({ payload, resolve, reject, cmdName });
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
  log(
    "INFO",
    `IPC python:upload — image size: ${imageB64.length} chars, canvas: ${canvasW}x${canvasH}`,
  );
  return sendToBridge("upload", {
    cmd: "upload",
    image_b64: imageB64,
    canvas_width: canvasW,
    canvas_height: canvasH,
  });
});

ipcMain.handle("python:regenerate", async (_ev, sessionId, paramsObj) => {
  log("INFO", `IPC python:regenerate — session: ${sessionId}`);
  return sendToBridge("regenerate", {
    cmd: "regenerate",
    session_id: sessionId,
    params: paramsObj,
  });
});

ipcMain.handle("python:export", async (_ev, dots, fmt, w, h, dotShape) => {
  log("INFO", `IPC python:export — format: ${fmt}, dots: ${dots.length}`);
  return sendToBridge("export", {
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

app.whenReady().then(async () => {
  initLog();
  log("INFO", "App ready, starting bridge...");
  await startBridge();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (bridgeProcess) {
    log("INFO", "Shutting down bridge...");
    bridgeProcess.kill();
    bridgeProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  log("INFO", "Before quit — cleaning up");
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
  }
});
