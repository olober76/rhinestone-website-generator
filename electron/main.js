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
// File Logger — writes to halftone-studio.log in multiple locations
// so it's easy to find regardless of platform or packaging mode.
// ═══════════════════════════════════════════════════════════════════════

// Resolve log directory safely — app.getPath("userData") needs app to be
// ready first, so we use os.homedir() as a safe fallback that is always
// available at module load time.
const os = require("os");

function getLogDir() {
  // During development: write next to package.json root
  if (isDev) return path.join(__dirname, "..");

  // Packaged: write to the user's home directory so it's always findable.
  // On Linux:   ~/halftone-studio.log
  // On macOS:   ~/halftone-studio.log
  // On Windows: %USERPROFILE%\halftone-studio.log
  return os.homedir();
}

const logFile = path.join(getLogDir(), "halftone-studio.log");

// Also write a copy next to the executable (release dir) when packaged,
// so testers can find it without knowing userData paths.
const logFileSideCar = app.isPackaged
  ? path.join(path.dirname(process.execPath), "halftone-studio.log")
  : null;

function writeToLog(line) {
  // Primary log (home dir — always writable)
  try { fs.appendFileSync(logFile, line); } catch {}
  // Side-car log next to the AppImage / .exe (best-effort)
  if (logFileSideCar) {
    try { fs.appendFileSync(logFileSideCar, line); } catch {}
  }
}

function initLog() {
  const rotate = (f) => {
    try {
      if (fs.existsSync(f) && fs.statSync(f).size > 2 * 1024 * 1024) {
        const old = f + ".old";
        if (fs.existsSync(old)) fs.unlinkSync(old);
        fs.renameSync(f, old);
      }
    } catch {}
  };
  rotate(logFile);
  if (logFileSideCar) rotate(logFileSideCar);

  const header =
    `\n${"=".repeat(60)}\n` +
    `Halftone Studio — ${new Date().toISOString()}\n` +
    `Platform: ${process.platform} ${process.arch}\n` +
    `Electron: ${process.versions.electron}  Node: ${process.versions.node}\n` +
    `Packaged: ${app.isPackaged}  Backend dir: ${backendDir}\n` +
    `Log (home): ${logFile}\n` +
    (logFileSideCar ? `Log (sidecar): ${logFileSideCar}\n` : "") +
    `${"=".repeat(60)}\n`;

  writeToLog(header);
  console.log(header);
}

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  const line = `[${ts}] [${level}] ${msg}\n`;
  console.log(line.trimEnd());
  writeToLog(line);
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

/**
 * Try to resolve a command to its absolute path via `which` / `where`.
 * Returns the full path string, or null if not found.
 */
function resolveCommandPath(cmd) {
  try {
    const whichCmd = process.platform === "win32" ? `where "${cmd}"` : `which "${cmd}"`;
    const out = execSync(whichCmd, {
      encoding: "utf-8",
      timeout: 5000,
      windowsHide: true,
      shell: true,
    }).trim();
    // `where` on Windows can return multiple lines — take the first
    const firstLine = out.split(/\r?\n/)[0].trim();
    return firstLine || null;
  } catch {
    return null;
  }
}

/**
 * Given a pip executable path, resolve the Python interpreter it belongs to.
 * e.g. /usr/bin/pip3 → /usr/bin/python3
 */
function pythonFromPip(pipPath) {
  try {
    // Ask pip's Python to print its own executable path
    const out = execSync(`"${pipPath}" --version`, {
      encoding: "utf-8",
      timeout: 8000,
      windowsHide: true,
      shell: true,
    }).trim();
    // pip output: "pip X.Y.Z from /path/to/site-packages/pip (python 3.X)"
    // Extract the site-packages path and derive the Python binary from it
    const match = out.match(/from (.+?)\/pip\s/);
    if (match) {
      // e.g. /home/user/anaconda3/lib/python3.12/site-packages
      // walk up to find the Python binary
      let dir = path.dirname(match[1]); // …/python3.12
      dir = path.dirname(dir);           // …/lib
      dir = path.dirname(dir);           // …/anaconda3 (prefix)
      const candidates = [
        path.join(dir, "bin", "python3"),
        path.join(dir, "bin", "python"),
        path.join(dir, "python3.exe"),
        path.join(dir, "python.exe"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) {
          log("INFO", `Resolved python from pip: ${c}`);
          return c;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Find the best (python, pip) pair available on this system.
 *
 * Strategy (in order of priority):
 *  1. python3/python that already has `python -m pip` working
 *  2. Standalone pip3/pip binary — derive the matching Python from it
 *  3. python3/python without pip — try ensurepip bootstrap
 *
 * Returns { pythonCmd, pipInfo: { cmd, args } } or null.
 */
function findPythonAndPip() {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  // ── Candidate Python commands, ordered best-first ──
  const pythonCandidates = isWin
    ? ["python", "python3", "py"]
    : isMac
    ? [
        "/opt/homebrew/bin/python3",  // Apple Silicon Homebrew (has pip)
        "/usr/local/bin/python3",      // Intel Homebrew
        "python3",
        "python",
      ]
    : [
        // Linux: DO NOT lead with /usr/bin/python3 — it often has no pip
        // Let PATH resolution find the right one first (e.g. pyenv, user install)
        "python3",
        "python",
        "/usr/bin/python3",
      ];

  const execOpts = { encoding: "utf-8", timeout: 8000, windowsHide: true, shell: true };

  // ── Pass 1: find a Python that already has pip ──
  for (const cmd of pythonCandidates) {
    try {
      const ver = execSync(`"${cmd}" --version`, execOpts).trim();
      if (!ver.includes("3.")) continue;

      // Does this Python have pip?
      try {
        execSync(`"${cmd}" -m pip --version`, execOpts);
        log("INFO", `Found Python+pip: ${cmd} → ${ver}`);
        return { pythonCmd: cmd, pipInfo: { cmd, args: ["-m", "pip"] } };
      } catch {}
    } catch {}
  }

  // ── Pass 2: find a pip3/pip binary and resolve its Python ──
  const pipCandidates = isWin ? ["pip", "pip3"] : ["pip3", "pip"];
  for (const pipCmd of pipCandidates) {
    const pipPath = resolveCommandPath(pipCmd);
    if (!pipPath) continue;

    try {
      execSync(`"${pipPath}" --version`, execOpts);
    } catch {
      continue;
    }

    // Try to run packages via this pip directly (it installs into its own Python)
    // Also figure out the matching python binary
    const derivedPython = pythonFromPip(pipPath);

    if (derivedPython) {
      try {
        const ver = execSync(`"${derivedPython}" --version`, execOpts).trim();
        if (ver.includes("3.")) {
          log("INFO", `Using pip at ${pipPath}, python: ${derivedPython} → ${ver}`);
          return { pythonCmd: derivedPython, pipInfo: { cmd: derivedPython, args: ["-m", "pip"] } };
        }
      } catch {}
    }

    // Fallback: use pip binary directly but we still need a matching python.
    // Try to find python3/python that this pip's site-packages will be on.
    // Last resort: just use pip binary for install, use best python for running.
    for (const cmd of pythonCandidates) {
      try {
        const ver = execSync(`"${cmd}" --version`, execOpts).trim();
        if (ver.includes("3.")) {
          log("WARN", `Using pip at ${pipPath} with python ${cmd} (may mismatch — fallback)`);
          return { pythonCmd: cmd, pipInfo: { cmd: pipPath, args: [] } };
        }
      } catch {}
    }
  }

  // ── Pass 3: Python without pip — try ensurepip bootstrap ──
  for (const cmd of pythonCandidates) {
    try {
      const ver = execSync(`"${cmd}" --version`, execOpts).trim();
      if (!ver.includes("3.")) continue;

      log("WARN", `Trying ensurepip bootstrap for ${cmd}...`);
      execSync(`"${cmd}" -m ensurepip --upgrade`, { ...execOpts, timeout: 30000 });
      execSync(`"${cmd}" -m pip --version`, execOpts);
      log("INFO", `pip bootstrapped via ensurepip for ${cmd}`);
      return { pythonCmd: cmd, pipInfo: { cmd, args: ["-m", "pip"] } };
    } catch {}
  }

  log("ERROR", "Could not find a usable Python+pip combination");
  return null;
}

// Thin wrappers kept for call-site compatibility
function findPython() {
  const result = findPythonAndPip();
  return result ? result.pythonCmd : null;
}
function findPip(pythonCmd) {
  // If called with a specific pythonCmd, just check if that Python has pip
  try {
    execSync(`"${pythonCmd}" -m pip --version`, {
      encoding: "utf-8", timeout: 8000, windowsHide: true, shell: true,
    });
    return { cmd: pythonCmd, args: ["-m", "pip"] };
  } catch {
    return null;
  }
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
 * macOS only: ensure libcairo is installed via Homebrew.
 * cairosvg is a Python wrapper around the native libcairo C library.
 * Without it, cairosvg imports successfully but crashes at runtime.
 *
 * Checks: `brew list cairo`
 * If missing and Homebrew is available: runs `brew install cairo` with a progress window.
 * If Homebrew itself is missing: shows an info dialog (SVG export still works).
 *
 * Returns true if cairo is available (or we managed to install it), false otherwise.
 */
async function ensureCairoMac() {
  if (process.platform !== "darwin") return true;

  // Check if cairo is already installed
  try {
    execSync("brew list cairo", {
      encoding: "utf-8", timeout: 10000, windowsHide: true, shell: true,
    });
    log("INFO", "macOS: libcairo already installed via Homebrew");
    return true;
  } catch {
    // Not installed — continue
  }

  // Check if Homebrew is available at all
  const brewPath = resolveCommandPath("brew") ||
    (fs.existsSync("/opt/homebrew/bin/brew") ? "/opt/homebrew/bin/brew" : null) ||
    (fs.existsSync("/usr/local/bin/brew") ? "/usr/local/bin/brew" : null);

  if (!brewPath) {
    log("WARN", "macOS: Homebrew not found — skipping cairo install");
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Optional: Install libcairo for PNG/JPG Export",
      message:
        "Homebrew is not installed on this Mac.\n\n" +
        "SVG export works without any extra setup.\n\n" +
        "To enable PNG/JPG export, install Homebrew first:\n" +
        "  https://brew.sh\n\n" +
        "Then run:  brew install cairo",
      buttons: ["OK"],
    });
    return false;
  }

  // Ask the user before installing (brew install takes ~30 seconds)
  const choice = dialog.showMessageBoxSync({
    type: "question",
    title: "Install libcairo for PNG/JPG Export?",
    message:
      "Halftone Studio uses libcairo to export PNG and JPG files.\n\n" +
      "It is not installed on your Mac yet.\n" +
      "We can install it now via Homebrew (this takes about 30 seconds).\n\n" +
      "SVG export works without it — you can skip this.",
    buttons: ["Install cairo via Homebrew", "Skip (SVG only)"],
    defaultId: 0,
    cancelId: 1,
  });

  if (choice !== 0) {
    log("INFO", "macOS: user skipped cairo install");
    return false;
  }

  // Show progress window
  let cairoWin = new BrowserWindow({
    width: 480,
    height: 200,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: "#1a1a2e",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: true,
    skipTaskbar: true,
  });
  cairoWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:system-ui;user-select:none">
      <div style="width:44px;height:44px;border:3px solid #333;border-top:3px solid #7c3aed;
        border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px"></div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">Installing libcairo…</div>
      <div style="font-size:12px;color:#888;text-align:center;max-width:380px;line-height:1.5">
        Running: brew install cairo</div>
      <div style="font-size:11px;color:#555;margin-top:14px">This only happens once (~30 sec)</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </body></html>
  `)}`,
  );
  await new Promise((r) => setTimeout(r, 500));

  log("INFO", `macOS: running ${brewPath} install cairo`);
  const installed = await new Promise((resolve) => {
    const proc = spawn(brewPath, ["install", "cairo"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    proc.stdout.on("data", (d) => log("BREW", d.toString().trim()));
    proc.stderr.on("data", (d) => log("BREW:ERR", d.toString().trim()));
    proc.on("error", (err) => { log("ERROR", "brew spawn error:", err.message); resolve(false); });
    proc.on("close", (code) => {
      log(code === 0 ? "INFO" : "ERROR", `brew install cairo exited ${code}`);
      resolve(code === 0);
    });
  });

  if (cairoWin && !cairoWin.isDestroyed()) cairoWin.close();
  cairoWin = null;

  if (installed) {
    log("INFO", "macOS: libcairo installed successfully");
  } else {
    log("WARN", "macOS: brew install cairo failed — PNG/JPG export may not work");
    dialog.showMessageBoxSync({
      type: "warning",
      title: "libcairo Installation Failed",
      message:
        "brew install cairo did not complete successfully.\n\n" +
        "SVG export still works fine.\n\n" +
        "To enable PNG/JPG export, run manually in Terminal:\n" +
        "  brew install cairo",
      buttons: ["OK"],
    });
  }
  return installed;
}

/**
 * Check which Python packages are missing and install them.
 * Shows a progress dialog while installing.
 * Returns { ok: true, pythonCmd } or { ok: false }.
 */
async function ensureDependencies() {
  // ── Find a working Python+pip pair ──
  const found = findPythonAndPip();
  if (!found) {
    dialog.showErrorBox(
      "Python / pip Not Found",
      "Halftone Studio needs Python 3 with pip.\n\n" +
        "On Linux:   sudo apt install python3 python3-pip\n" +
        "On macOS:   brew install python3  (or install from python.org)\n" +
        "On Windows: install Python from https://python.org\n\n" +
        "After installing, restart the app.",
    );
    return { ok: false };
  }

  const { pythonCmd, pipInfo } = found;
  log("INFO", `Using Python: ${pythonCmd}, pip: ${pipInfo.cmd} ${pipInfo.args.join(" ")}`);

  // ── Write a temp check script ──
  const checkPy = path.join(app.getPath("temp"), "halftone_check_deps.py");
  const scriptLines = REQUIRED_PACKAGES.map(
    (p) =>
      `try:\n    import ${p.importName}\n    print("ok:${p.importName}")\nexcept ImportError:\n    print("miss:${p.importName}")`,
  ).join("\n");
  fs.writeFileSync(checkPy, scriptLines, "utf-8");

  let checkOutput;
  try {
    checkOutput = execSync(`"${pythonCmd}" "${checkPy}"`, {
      encoding: "utf-8",
      timeout: 30000,
      windowsHide: true,
      shell: true,
      cwd: backendDir,
    });
    log("INFO", "Dependency check output:", checkOutput.trim());
  } catch (e) {
    log("ERROR", "Dependency check script failed:", e.message);
    // Fallback: assume all missing
    checkOutput = REQUIRED_PACKAGES.map((p) => `miss:${p.importName}`).join("\n");
  }

  const missing = REQUIRED_PACKAGES.filter((p) =>
    checkOutput.includes(`miss:${p.importName}`),
  );

  if (missing.length === 0) {
    log("INFO", "All Python dependencies satisfied");
    // macOS: even if cairosvg pip package is installed, libcairo (the native C
    // library) may still be missing. Check and offer to install via Homebrew.
    await ensureCairoMac();
    return { ok: true, pythonCmd };
  }

  const pipNames = missing.map((p) => p.pipName);
  log("INFO", `Missing packages: ${pipNames.join(", ")}  — installing...`);

  // ── Show progress window ──
  let progressWin = new BrowserWindow({
    width: 480,
    height: 220,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: "#1a1a2e",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    // On Linux show: without this the window may not appear at all
    show: true,
    skipTaskbar: true,
  });
  progressWin.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100vh;background:#1a1a2e;color:#e0e0e0;font-family:system-ui;user-select:none">
      <div style="width:44px;height:44px;border:3px solid #333;border-top:3px solid #7c3aed;
        border-radius:50%;animation:spin 1s linear infinite;margin-bottom:20px"></div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">Installing Python dependencies…</div>
      <div style="font-size:12px;color:#888;text-align:center;max-width:380px;line-height:1.5">${pipNames.join(", ")}</div>
      <div style="font-size:11px;color:#555;margin-top:14px">This only happens once</div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    </body></html>
  `)}`,
  );
  // Force the window to paint before we block on the install
  await new Promise((r) => setTimeout(r, 600));

  // ── Build pip install args ──
  // On Linux/macOS we may need --break-system-packages (PEP 668 / externally-managed env)
  // or fall back to --user if that fails.
  const buildPipInstallArgs = (extraFlags = []) => [
    ...pipInfo.args,
    "install",
    "--quiet",
    ...extraFlags,
    ...pipNames,
  ];

  const runPip = (args) =>
    new Promise((resolve) => {
      const pip = spawn(pipInfo.cmd, args, {
        cwd: backendDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
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
          log("ERROR", `pip install failed (exit ${code}), stderr: ${stderr.slice(0, 400)}`);
          resolve({ success: false, error: stderr });
        }
      });
    });

  log("INFO", `pip command: ${pipInfo.cmd} ${buildPipInstallArgs().join(" ")}`);

  // First attempt: plain install
  let result = await runPip(buildPipInstallArgs());

  // If it fails with "externally-managed" (PEP 668), retry with --break-system-packages
  if (!result.success && result.error.includes("externally-managed")) {
    log("WARN", "Retrying pip with --break-system-packages (PEP 668 env)");
    result = await runPip(buildPipInstallArgs(["--break-system-packages"]));
  }

  // If still failing, retry with --user
  if (!result.success) {
    log("WARN", "Retrying pip with --user flag");
    result = await runPip(buildPipInstallArgs(["--user"]));
  }

  if (progressWin && !progressWin.isDestroyed()) progressWin.close();
  progressWin = null;

  if (!result.success) {
    const isLinux = process.platform === "linux";
    const isMac = process.platform === "darwin";
    const hint = isLinux
      ? "sudo apt install python3-pip\n  then: pip3 install " + pipNames.join(" ")
      : isMac
      ? "pip3 install " + pipNames.join(" ")
      : "pip install " + pipNames.join(" ");

    dialog.showErrorBox(
      "Dependency Installation Failed",
      `Could not install required Python packages:\n${pipNames.join(", ")}\n\n` +
        `Error: ${result.error}\n\n` +
        "Please run manually:\n  " +
        hint,
    );
    return { ok: false };
  }

  log("INFO", "All dependencies installed successfully");

  // ── macOS: ensure libcairo is present for cairosvg PNG/JPG export ──
  // (only runs if cairosvg was among the packages we needed to install)
  if (process.platform === "darwin" && pipNames.includes("cairosvg")) {
    await ensureCairoMac();
  }

  return { ok: true, pythonCmd };
}

async function startBridge() {
  // ensureDependencies now handles Python+pip discovery internally
  const deps = await ensureDependencies();
  if (!deps.ok) {
    app.quit();
    return;
  }

  const pythonCmd = deps.pythonCmd;

  log("INFO", `Starting bridge: ${pythonCmd} cli_bridge.py  (cwd: ${backendDir})`);

  // On macOS/Linux, PATH inside the spawned process may not include the user's
  // shell PATH (Electron launches without a login shell). Inherit the full PATH
  // so that any shared libraries (e.g. Cairo for cairosvg) can be found.
  const spawnEnv = { ...process.env, PYTHONUNBUFFERED: "1" };
  if (process.platform !== "win32" && process.env.PATH) {
    const extraPaths = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ];
    const existing = process.env.PATH.split(":");
    const merged = [...new Set([...existing, ...extraPaths])];
    spawnEnv.PATH = merged.join(":");
  }

  bridgeProcess = spawn(pythonCmd, ["cli_bridge.py"], {
    cwd: backendDir,
    env: spawnEnv,
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
  log("INFO", `Log file (home):    ${logFile}`);
  if (logFileSideCar) log("INFO", `Log file (sidecar): ${logFileSideCar}`);

  // Add an IPC handler so the renderer can open the log file location
  ipcMain.handle("debug:getLogPath", () => logFile);
  ipcMain.handle("debug:openLog", () => shell.openPath(path.dirname(logFile)));

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
