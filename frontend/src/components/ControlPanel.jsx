import React, { useCallback } from "react";
import { RefreshCw } from "lucide-react";
import useStore from "../store";
import { regenerateDots } from "../api";

/**
 * Slider helper
 */
function Slider({ label, value, min, max, step, onChange, unit = "" }) {
  return (
    <div className="flex flex-col gap-1">
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
      />
    </div>
  );
}

export default function ControlPanel() {
  const params = useStore((s) => s.params);
  const setParam = useStore((s) => s.setParam);
  const sessionId = useStore((s) => s.sessionId);
  const setDots = useStore((s) => s.setDots);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const pushHistory = useStore((s) => s.pushHistory);
  const dotColor = useStore((s) => s.dotColor);
  const setDotColor = useStore((s) => s.setDotColor);
  const bgColor = useStore((s) => s.bgColor);
  const setBgColor = useStore((s) => s.setBgColor);
  const dotShape = useStore((s) => s.dotShape);
  const setDotShape = useStore((s) => s.setDotShape);

  const handleRegenerate = useCallback(async () => {
    if (!sessionId) return;
    try {
      pushHistory();
      setLoading(true);
      setError(null);
      const data = await regenerateDots(sessionId, params);
      setDots(data.dots);
    } catch (e) {
      setError("Regeneration failed: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId, params, pushHistory, setDots, setLoading, setError]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
          Pattern Controls
        </h2>
        <button
          onClick={handleRegenerate}
          className="flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs px-3 py-1.5 rounded-lg transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate
        </button>
      </div>

      {/* Method selector */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">Placement Method</span>
        <div className="flex gap-1">
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

      {/* Dot shape selector */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-gray-400">Dot Shape</span>
        <div className="flex gap-1">
          {["circle", "diamond"].map((s) => (
            <button
              key={s}
              className={`flex-1 text-xs py-1.5 rounded-md capitalize transition flex items-center justify-center gap-1.5 ${
                dotShape === s
                  ? "bg-brand-600 text-white"
                  : "bg-surface-lighter text-gray-400 hover:text-white"
              }`}
              onClick={() => setDotShape(s)}
            >
              {s === "circle" ? (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <circle cx="6" cy="6" r="5" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <polygon points="6,0 12,6 6,12 0,6" fill="currentColor" />
                </svg>
              )}
              {s}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="Dot Radius"
        value={params.dot_radius}
        min={1}
        max={30}
        step={0.5}
        unit="px"
        onChange={(v) => setParam("dot_radius", v)}
      />

      <Slider
        label="Spacing"
        value={params.min_spacing}
        min={3}
        max={60}
        step={1}
        unit="px"
        onChange={(v) => setParam("min_spacing", v)}
      />

      <Slider
        label="Density"
        value={params.density}
        min={0.1}
        max={3}
        step={0.1}
        unit="x"
        onChange={(v) => setParam("density", v)}
      />

      <Slider
        label="Edge Strength"
        value={params.edge_strength}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setParam("edge_strength", v)}
      />

      <Slider
        label="Contrast"
        value={params.contrast}
        min={0.1}
        max={3}
        step={0.1}
        unit="x"
        onChange={(v) => setParam("contrast", v)}
      />

      <Slider
        label="Rotation"
        value={params.rotation}
        min={0}
        max={360}
        step={1}
        unit="°"
        onChange={(v) => setParam("rotation", v)}
      />

      {/* Toggles */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={params.invert}
            onChange={(e) => setParam("invert", e.target.checked)}
            className="accent-brand-500"
          />
          Invert brightness
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={params.use_contour_follow}
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
          <label className="flex items-center gap-2 text-xs text-gray-400">
            Dot
            <input
              type="color"
              value={dotColor}
              onChange={(e) => setDotColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border-0"
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
