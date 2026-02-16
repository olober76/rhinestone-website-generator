import React, { useCallback, useState, useRef, useEffect } from "react";
import { RefreshCw, ChevronDown } from "lucide-react";
import useStore from "../store";
import { regenerateDots } from "../api";

/**
 * Slider helper
 */
function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit = "",
  disabled,
}) {
  return (
    <div
      className={`flex flex-col gap-1 ${disabled ? "opacity-40 pointer-events-none" : ""}`}
    >
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">
          {typeof value === "number" ? value.toFixed(step < 1 ? 1 : 0) : value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        disabled={disabled}
      />
    </div>
  );
}

/* ── Shape icons ── */
const shapeIcons = {
  circle: (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <circle cx="7" cy="7" r="6" fill="currentColor" />
    </svg>
  ),
  diamond: (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <polygon points="7,1 13,7 7,13 1,7" fill="currentColor" />
    </svg>
  ),
  star: (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <polygon
        points={(() => {
          const cx = 7,
            cy = 7,
            outer = 6,
            inner = 2.4;
          return Array.from({ length: 10 }, (_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const r = i % 2 === 0 ? outer : inner;
            return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
          }).join(" ");
        })()}
        fill="currentColor"
      />
    </svg>
  ),
  hexagon: (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <polygon
        points={(() => {
          const cx = 7,
            cy = 7,
            r = 6;
          return Array.from({ length: 6 }, (_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
          }).join(" ");
        })()}
        fill="currentColor"
      />
    </svg>
  ),
  random: (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <circle cx="4" cy="4" r="3" fill="currentColor" />
      <polygon points="11,4 14,8 11,12 8,8" fill="currentColor" opacity="0.7" />
    </svg>
  ),
};

const shapeOptions = ["circle", "star", "diamond", "hexagon", "random"];

/**
 * Left sidebar — pattern controls.
 * Operates on the currently selected layer.
 * If no layer is selected, controls are disabled.
 */
export default function ControlPanel() {
  const layers = useStore((s) => s.layers);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const setLayerParam = useStore((s) => s.setLayerParam);
  const updateLayer = useStore((s) => s.updateLayer);
  const canvasWidth = useStore((s) => s.canvasWidth);
  const canvasHeight = useStore((s) => s.canvasHeight);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const pushHistory = useStore((s) => s.pushHistory);
  const bgColor = useStore((s) => s.bgColor);
  const setBgColor = useStore((s) => s.setBgColor);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;
  const params = selectedLayer?.params || {};
  const dotShape = selectedLayer?.dotShape || "circle";
  const dotColor = selectedLayer?.dotColor || "#CCCCCC";
  const noLayer = !selectedLayer;

  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeMenuRef = useRef(null);

  // Close popup on outside click
  useEffect(() => {
    const handler = (e) => {
      if (shapeMenuRef.current && !shapeMenuRef.current.contains(e.target)) {
        setShapeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const setParam = useCallback(
    (key, value) => setLayerParam(key, value),
    [setLayerParam],
  );

  const setDotShape = useCallback(
    (shape) => {
      if (!selectedLayerId) return;
      updateLayer(selectedLayerId, { dotShape: shape });
    },
    [selectedLayerId, updateLayer],
  );

  const setDotColor = useCallback(
    (color) => {
      if (!selectedLayerId) return;
      updateLayer(selectedLayerId, { dotColor: color });
    },
    [selectedLayerId, updateLayer],
  );

  const handleRegenerate = useCallback(async () => {
    if (!selectedLayer) return;
    try {
      pushHistory();
      setLoading(true);
      setError(null);
      const fullParams = {
        ...selectedLayer.params,
        canvas_width: canvasWidth,
        canvas_height: canvasHeight,
      };
      const data = await regenerateDots(selectedLayer.sessionId, fullParams);
      updateLayer(selectedLayer.id, { dots: data.dots });
    } catch (e) {
      setError("Regeneration failed: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [
    selectedLayer,
    canvasWidth,
    canvasHeight,
    pushHistory,
    updateLayer,
    setLoading,
    setError,
  ]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          Pattern Controls
        </h2>
        <button
          onClick={handleRegenerate}
          disabled={noLayer}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition ${
            noLayer
              ? "bg-gray-700 text-gray-500 cursor-not-allowed"
              : "bg-brand-600 hover:bg-brand-700 text-white"
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate
        </button>
      </div>

      {/* Selected layer indicator */}
      {noLayer ? (
        <div className="text-xs text-gray-600 bg-surface rounded-lg p-3 text-center">
          Select a layer to edit its parameters
        </div>
      ) : (
        <div className="text-xs text-gray-400 bg-surface/50 rounded-md px-2 py-1.5 flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: dotColor }}
          />
          Editing:{" "}
          <span className="text-white font-medium">{selectedLayer.name}</span>
        </div>
      )}

      {/* Method selector */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">Placement Method</span>
        <div
          className={`flex gap-1 ${noLayer ? "opacity-40 pointer-events-none" : ""}`}
        >
          {["poisson", "grid", "contour"].map((m) => (
            <button
              key={m}
              className={`flex-1 text-xs py-1.5 rounded-md capitalize transition ${
                params.method === m
                  ? "bg-brand-600 text-white"
                  : "bg-surface-lighter text-gray-400 hover:text-white"
              }`}
              onClick={() => setParam("method", m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Dot shape — popup menu */}
      <div
        className={`flex flex-col gap-1 relative ${noLayer ? "opacity-40 pointer-events-none" : ""}`}
        ref={shapeMenuRef}
      >
        <span className="text-xs text-gray-400">Dot Shape</span>
        <button
          className="flex items-center justify-between gap-2 bg-surface-lighter text-gray-300 hover:text-white text-xs py-2 px-3 rounded-md transition"
          onClick={() => setShapeMenuOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 capitalize">
            {shapeIcons[dotShape]}
            {dotShape}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${shapeMenuOpen ? "rotate-180" : ""}`}
          />
        </button>
        {shapeMenuOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface-light border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
            {shapeOptions.map((s) => (
              <button
                key={s}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs capitalize transition ${
                  dotShape === s
                    ? "bg-brand-600 text-white"
                    : "text-gray-400 hover:bg-surface-lighter hover:text-white"
                }`}
                onClick={() => {
                  setDotShape(s);
                  setParam("dot_shape", s);
                  setShapeMenuOpen(false);
                }}
              >
                {shapeIcons[s]}
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sizing Mode */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">Dot Sizing</span>
        <div
          className={`flex gap-1 ${noLayer ? "opacity-40 pointer-events-none" : ""}`}
        >
          {[
            { value: "uniform", label: "Uniform" },
            { value: "variable", label: "Shadow / Highlight" },
          ].map(({ value, label }) => (
            <button
              key={value}
              className={`flex-1 text-xs py-1.5 rounded-md transition ${
                params.sizing_mode === value
                  ? "bg-brand-600 text-white"
                  : "bg-surface-lighter text-gray-400 hover:text-white"
              }`}
              onClick={() => setParam("sizing_mode", value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Dot Radius"
        value={params.dot_radius || 4}
        min={1}
        max={5}
        step={0.5}
        unit="px"
        onChange={(v) => setParam("dot_radius", v)}
        disabled={noLayer}
      />

      <Slider
        label="Spacing"
        value={params.min_spacing || 10}
        min={3}
        max={30}
        step={1}
        unit="px"
        onChange={(v) => setParam("min_spacing", v)}
        disabled={noLayer}
      />

      <Slider
        label="Density"
        value={params.density || 1}
        min={0.1}
        max={3}
        step={0.1}
        unit="x"
        onChange={(v) => setParam("density", v)}
        disabled={noLayer}
      />

      <Slider
        label="Edge Strength"
        value={params.edge_strength || 0.6}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setParam("edge_strength", v)}
        disabled={noLayer}
      />

      <Slider
        label="Contrast"
        value={params.contrast || 1.2}
        min={0.1}
        max={3}
        step={0.1}
        unit="x"
        onChange={(v) => setParam("contrast", v)}
        disabled={noLayer}
      />

      <Slider
        label="Rotation"
        value={params.rotation || 0}
        min={0}
        max={360}
        step={1}
        unit="°"
        onChange={(v) => setParam("rotation", v)}
        disabled={noLayer}
      />

      {/* Toggles */}
      <div
        className={`flex flex-col gap-2 ${noLayer ? "opacity-40 pointer-events-none" : ""}`}
      >
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={params.invert || false}
            onChange={(e) => setParam("invert", e.target.checked)}
            className="accent-brand-500"
          />
          Invert brightness
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={params.use_contour_follow !== false}
            onChange={(e) => setParam("use_contour_follow", e.target.checked)}
            className="accent-brand-500"
          />
          Contour-following dots
        </label>
      </div>

      <div className="border-t border-gray-700/50 pt-3 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Colors
        </h3>
        <div className="flex gap-4">
          <label
            className={`flex items-center gap-2 text-xs text-gray-400 ${noLayer ? "opacity-40 pointer-events-none" : ""}`}
          >
            Dot
            <input
              type="color"
              value={dotColor}
              onChange={(e) => setDotColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0"
              disabled={noLayer}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Background
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
