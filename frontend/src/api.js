/**
 * API helper.
 *
 * In Electron → calls Python directly via IPC (no network).
 * In Web/Docker → uses HTTP fetch to /api (Nginx proxy).
 */

const isElectron =
  typeof window !== "undefined" && !!window.electronAPI?.isElectron;

// ── Helpers ──

/** Convert a File/Blob to a base64 string (no data-url prefix). */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Electron path — fully local via IPC to Python CLI bridge
// ═══════════════════════════════════════════════════════════════════════

async function electronUpload(file, canvasWidth = 800, canvasHeight = 800) {
  const b64 = await fileToBase64(file);
  return window.electronAPI.uploadImage(b64, canvasWidth, canvasHeight);
}

async function electronRegenerate(sessionId, params) {
  return window.electronAPI.regenerateDots(sessionId, params);
}

async function electronUpdateDots(sessionId, dots) {
  // No-op locally — dots live in frontend state only
  return { status: "ok", dot_count: dots.length };
}

async function electronExport(
  sessionId,
  format,
  width,
  height,
  dots,
  dotShape,
) {
  const result = await window.electronAPI.exportPattern(
    dots,
    format,
    width,
    height,
    dotShape,
  );
  // result.data_b64 contains the file content
  const binary = atob(result.data_b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const mimeMap = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg" };
  return new Blob([bytes], {
    type: mimeMap[format] || "application/octet-stream",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Web path — HTTP fetch to /api
// ═══════════════════════════════════════════════════════════════════════

const BASE = "/api";

async function webUpload(file, canvasWidth = 800, canvasHeight = 800) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(
    `${BASE}/upload?canvas_width=${canvasWidth}&canvas_height=${canvasHeight}`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function webRegenerate(sessionId, params) {
  const res = await fetch(`${BASE}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, params }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function webUpdateDots(sessionId, dots) {
  const res = await fetch(`${BASE}/dots/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, dots }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function webExport(sessionId, format, width, height, dots, dotShape) {
  const res = await fetch(`${BASE}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      format,
      width,
      height,
      dots,
      dot_shape: dotShape,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

// ═══════════════════════════════════════════════════════════════════════
// Public API — auto-selects Electron or Web path
// ═══════════════════════════════════════════════════════════════════════

export const uploadImage = isElectron ? electronUpload : webUpload;
export const regenerateDots = isElectron ? electronRegenerate : webRegenerate;
export const updateDots = isElectron ? electronUpdateDots : webUpdateDots;
export const exportPattern = isElectron ? electronExport : webExport;
