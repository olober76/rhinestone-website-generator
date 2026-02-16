/**
 * API helper — communicates with the FastAPI backend.
 */

const BASE = "/api";

export async function uploadImage(file, canvasWidth = 800, canvasHeight = 800) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${BASE}/upload?canvas_width=${canvasWidth}&canvas_height=${canvasHeight}`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function regenerateDots(sessionId, params) {
  const res = await fetch(`${BASE}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, params }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateDots(sessionId, dots) {
  const res = await fetch(`${BASE}/dots/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, dots }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportPattern(
  sessionId,
  format,
  width,
  height,
  dots = null,
  dotShape = "circle",
) {
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
