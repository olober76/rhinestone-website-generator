/**
 * Halfstone Studio — Electron Main Process
 *
 * Spawns the Python FastAPI backend, then loads the React frontend.
 * Provides IPC for native save-directory dialog.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");

// ── Paths ──
const isDev = !app.isPackaged;
const rootDir = isDev
  ? path.join(__dirname, "..")
  : path.join(process.resourcesPath);

const backendDir = isDev
  ? path.join(rootDir, "backend")
  : path.join(rootDir, "backend");

const frontendDir = isDev
  ? path.join(rootDir, "frontend", "dist")
  : path.join(rootDir, "frontend-dist");

// ── State ──
let mainWindow = null;
let backendProcess = null;
const BACKEND_PORT = 8000;

// ── Settings store (simple JSON file) ──
const settingsPath = path.join(app.getPath("userData"), "settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
  } catch {}
  return { saveDirectory: app.getPath("downloads") };
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// ── Find Python executable ──
function findPython() {
  const candidates =
    process.platform === "win32"
      ? ["python", "python3", "py"]
      : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      const { execSync } = require("child_process");
      const version = execSync(`${cmd} --version`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (version.includes("3.")) return cmd;
    } catch {}
  }
  return null;
}

// ── Wait for backend to be ready ──
function waitForBackend(port, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock
        .connect(port, "127.0.0.1", () => {
          sock.destroy();
          resolve();
        })
        .on("error", () => {
          sock.destroy();
          if (Date.now() - start > timeout) {
            reject(new Error("Backend did not start within timeout"));
          } else {
            setTimeout(check, 300);
          }
        })
        .on("timeout", () => {
          sock.destroy();
          setTimeout(check, 300);
        });
    };
    check();
  });
}

// ── Start Python backend ──
function startBackend() {
  const pythonCmd = findPython();
  if (!pythonCmd) {
    dialog.showErrorBox(
      "Python Not Found",
      "Halfstone Studio requires Python 3.9+ installed on your system.\n\n" +
        "Please install Python from https://python.org and try again.\n\n" +
        "Make sure to check 'Add Python to PATH' during installation."
    );
    app.quit();
    return null;
  }

  console.log(`[Electron] Starting backend with: ${pythonCmd}`);
  console.log(`[Electron] Backend directory: ${backendDir}`);

  const proc = spawn(
    pythonCmd,
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  proc.stdout.on("data", (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  proc.stderr.on("data", (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  proc.on("error", (err) => {
    console.error("[Electron] Failed to start backend:", err.message);
    dialog.showErrorBox(
      "Backend Error",
      `Failed to start the processing backend:\n${err.message}\n\n` +
        "Make sure Python 3.9+ is installed with pip packages:\n" +
        "fastapi, uvicorn, opencv-python-headless, numpy, scikit-image, Pillow, cairosvg"
    );
  });

  proc.on("exit", (code) => {
    console.log(`[Electron] Backend exited with code ${code}`);
    backendProcess = null;
  });

  return proc;
}

// ── Create main window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Halfstone Studio",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0f0f0f",
    show: false,
  });

  // Remove default menu
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // Dev mode: load from Vite dev server
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load built files
    mainWindow.loadFile(path.join(frontendDir, "index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── IPC Handlers ──

// Pick save directory
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

// Get current save directory
ipcMain.handle("settings:getSaveDirectory", () => {
  return loadSettings().saveDirectory;
});

// Save file to directory
ipcMain.handle("file:saveToDirectory", async (_event, filename, dataB64) => {
  const settings = loadSettings();
  const dir = settings.saveDirectory;

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, filename);
  const buffer = Buffer.from(dataB64, "base64");
  fs.writeFileSync(filePath, buffer);
  return filePath;
});

// Save file with "Save As" dialog
ipcMain.handle("file:saveAs", async (_event, filename, dataB64) => {
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
    // Update save directory to match where user chose
    settings.saveDirectory = path.dirname(result.filePath);
    saveSettings(settings);

    const buffer = Buffer.from(dataB64, "base64");
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
  }
  return null;
});

// Open folder in file explorer
ipcMain.handle("shell:openDirectory", async (_event, dirPath) => {
  shell.openPath(dirPath);
});

// ── App lifecycle ──
app.whenReady().then(async () => {
  // Start backend
  backendProcess = startBackend();

  if (backendProcess) {
    try {
      await waitForBackend(BACKEND_PORT);
      console.log("[Electron] Backend is ready");
    } catch (err) {
      console.error("[Electron]", err.message);
    }
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Kill backend
  if (backendProcess) {
    console.log("[Electron] Shutting down backend...");
    backendProcess.kill();
    backendProcess = null;
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
