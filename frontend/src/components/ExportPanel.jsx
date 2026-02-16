import React, { useCallback, useState, useEffect } from "react";
import {
  Download,
  FileImage,
  FileType,
  FileCode,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import useStore from "../store";
import { exportPattern } from "../api";
import { saveAs } from "file-saver";

const isElectron =
  typeof window !== "undefined" && !!window.electronAPI?.isElectron;

const formats = [
  {
    id: "svg",
    label: "SVG",
    icon: FileCode,
    desc: "Vector (best for production)",
  },
  {
    id: "png",
    label: "PNG",
    icon: FileImage,
    desc: "Transparent raster image",
  },
  { id: "jpg", label: "JPG", icon: FileType, desc: "Compressed raster image" },
];

/** Convert a Blob to a base64 string (without the data-url prefix) */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

/* ── Shape point generators (for SVG export) ── */
function starPts(cx, cy, r) {
  const outer = r,
    inner = r * 0.4;
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rd = i % 2 === 0 ? outer : inner;
    return `${cx + rd * Math.cos(a)},${cy + rd * Math.sin(a)}`;
  }).join(" ");
}
function hexPts(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
}

const randomShapes = ["circle", "star", "diamond", "hexagon"];

/**
 * Export panel — composes all visible layers into single output.
 */
export default function ExportPanel() {
  const layers = useStore((s) => s.layers);
  const canvasWidth = useStore((s) => s.canvasWidth);
  const canvasHeight = useStore((s) => s.canvasHeight);
  const bgColor = useStore((s) => s.bgColor);
  const [exporting, setExporting] = useState(null);
  const [saveDir, setSaveDir] = useState("");
  const [savedPath, setSavedPath] = useState(null);

  // Load persisted save directory on mount (Electron only)
  useEffect(() => {
    if (isElectron) {
      window.electronAPI.getSaveDirectory().then(setSaveDir);
    }
  }, []);

  const handlePickDirectory = useCallback(async () => {
    if (!isElectron) return;
    const dir = await window.electronAPI.pickSaveDirectory();
    if (dir) setSaveDir(dir);
  }, []);

  const handleOpenDirectory = useCallback(async () => {
    if (!isElectron || !saveDir) return;
    await window.electronAPI.openDirectory(saveDir);
  }, [saveDir]);

  /** Build a composite SVG string with all visible layers */
  const generateSvgString = useCallback(() => {
    const lines = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
      `  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${bgColor}"/>`,
    ];

    for (const layer of layers) {
      if (!layer.visible || layer.dots.length === 0) continue;

      const scaleX = layer.width / canvasWidth;
      const scaleY = layer.height / canvasHeight;
      lines.push(
        `  <g transform="translate(${layer.x}, ${layer.y}) scale(${scaleX}, ${scaleY})" opacity="${layer.opacity}">`,
      );

      for (let i = 0; i < layer.dots.length; i++) {
        const d = layer.dots[i];
        const color = d.color || layer.dotColor;
        const r = d.r || layer.params.dot_radius;
        let shape = d.shape || layer.dotShape;
        if (shape === "random")
          shape =
            randomShapes[Math.abs(Math.round(d.x * 7 + d.y * 13 + i)) % 4];

        if (shape === "diamond") {
          const pts = `${d.x},${d.y - r} ${d.x + r},${d.y} ${d.x},${d.y + r} ${d.x - r},${d.y}`;
          lines.push(`    <polygon points="${pts}" fill="${color}"/>`);
        } else if (shape === "star") {
          lines.push(
            `    <polygon points="${starPts(d.x, d.y, r)}" fill="${color}"/>`,
          );
        } else if (shape === "hexagon") {
          lines.push(
            `    <polygon points="${hexPts(d.x, d.y, r)}" fill="${color}"/>`,
          );
        } else {
          lines.push(
            `    <circle cx="${d.x}" cy="${d.y}" r="${r}" fill="${color}"/>`,
          );
        }
      }

      lines.push("  </g>");
    }

    lines.push("</svg>");
    return lines.join("\n");
  }, [layers, canvasWidth, canvasHeight, bgColor]);

  /** Flatten all visible layers' dots into a single array (for raster export via backend) */
  const flattenDots = useCallback(() => {
    const allDots = [];
    for (const layer of layers) {
      if (!layer.visible || layer.dots.length === 0) continue;
      const scaleX = layer.width / canvasWidth;
      const scaleY = layer.height / canvasHeight;
      for (const d of layer.dots) {
        allDots.push({
          x: layer.x + d.x * scaleX,
          y: layer.y + d.y * scaleY,
          r: (d.r || layer.params.dot_radius) * Math.max(scaleX, scaleY),
          color: d.color || layer.dotColor,
          shape: d.shape || layer.dotShape,
        });
      }
    }
    return allDots;
  }, [layers, canvasWidth, canvasHeight]);

  /** Build the blob for a given format */
  const buildBlob = useCallback(
    async (format) => {
      if (format === "svg") {
        return new Blob([generateSvgString()], { type: "image/svg+xml" });
      }
      const allDots = flattenDots();
      // Use first layer's sessionId (or null) — backend only needs dots for export
      const sessionId = layers.find((l) => l.sessionId)?.sessionId || "export";
      return exportPattern(
        sessionId,
        format,
        canvasWidth,
        canvasHeight,
        allDots,
        "circle", // shape is embedded per-dot
      );
    },
    [layers, canvasWidth, canvasHeight, generateSvgString, flattenDots],
  );

  /** Export via native Save-As dialog (Electron) or browser download */
  const handleExport = useCallback(
    async (format) => {
      if (layers.length === 0) return;
      try {
        setExporting(format);
        setSavedPath(null);
        const filename = `halftone.${format}`;
        const blob = await buildBlob(format);

        if (isElectron) {
          const b64 = await blobToBase64(blob);
          const saved = await window.electronAPI.saveAs(filename, b64);
          if (saved) setSavedPath(saved);
        } else {
          saveAs(blob, filename);
        }
      } catch (e) {
        useStore.getState().setError("Export failed: " + e.message);
      } finally {
        setExporting(null);
      }
    },
    [layers, buildBlob],
  );

  /** Quick-save to the configured directory (Electron only) */
  const handleQuickSave = useCallback(
    async (format) => {
      if (layers.length === 0 || !isElectron || !saveDir) return;
      try {
        setExporting(format);
        setSavedPath(null);
        const filename = `halftone.${format}`;
        const blob = await buildBlob(format);
        const b64 = await blobToBase64(blob);
        const saved = await window.electronAPI.saveToDirectory(filename, b64);
        if (saved) setSavedPath(saved);
      } catch (e) {
        useStore.getState().setError("Export failed: " + e.message);
      } finally {
        setExporting(null);
      }
    },
    [layers, buildBlob, saveDir],
  );

  return (
    <div className="p-4 border-t border-gray-700/50 flex flex-col gap-3 mt-auto">
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider flex items-center gap-2">
        <Download className="w-4 h-4" />
        Export
      </h2>

      {/* Save-directory picker — Electron only */}
      {isElectron && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-400">Save Directory</span>
          <div className="flex gap-1.5">
            <button
              onClick={handlePickDirectory}
              className="flex-1 flex items-center gap-2 bg-surface-lighter hover:bg-surface-lighter/80 text-gray-300 hover:text-white text-xs p-2 rounded-md transition truncate text-left"
              title={saveDir}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="truncate">{saveDir || "Choose folder..."}</span>
            </button>
            {saveDir && (
              <button
                onClick={handleOpenDirectory}
                className="p-2 bg-surface-lighter hover:bg-surface-lighter/80 text-gray-400 hover:text-white rounded-md transition"
                title="Open in Explorer"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Export buttons */}
      <div className="flex flex-col gap-2">
        {formats.map(({ id, label, icon: Icon, desc }) => (
          <div key={id} className="flex gap-1.5">
            <button
              onClick={() => handleExport(id)}
              disabled={exporting !== null || layers.length === 0}
              className={`flex-1 flex items-center gap-3 p-2.5 rounded-lg transition text-left ${
                exporting === id
                  ? "bg-brand-600/30 text-brand-100"
                  : layers.length === 0
                    ? "bg-surface-lighter/50 text-gray-600 cursor-not-allowed"
                    : "bg-surface-lighter hover:bg-surface-lighter/80 text-gray-300 hover:text-white"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </div>
              {exporting === id && (
                <div className="spinner !w-5 !h-5 !border-2" />
              )}
            </button>
            {/* Quick-save button — Electron only, when dir is set */}
            {isElectron && saveDir && (
              <button
                onClick={() => handleQuickSave(id)}
                disabled={exporting !== null || layers.length === 0}
                className="p-2.5 bg-surface-lighter hover:bg-brand-600/50 text-gray-400 hover:text-white rounded-lg transition"
                title={`Quick save to ${saveDir}`}
              >
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Save confirmation toast */}
      {savedPath && (
        <div className="text-xs text-green-400 bg-green-900/20 border border-green-800/30 rounded-md p-2">
          Saved: {savedPath}
        </div>
      )}
    </div>
  );
}
