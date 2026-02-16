import React, { useState } from "react";
import { Monitor, Smartphone, Square, Layout, ArrowRight } from "lucide-react";
import useStore from "../store";

const presets = [
  { label: "Square", w: 800, h: 800, icon: Square },
  { label: "HD (16:9)", w: 1920, h: 1080, icon: Monitor },
  { label: "Portrait", w: 1080, h: 1920, icon: Smartphone },
  { label: "A4 Landscape", w: 1122, h: 793, icon: Layout },
  { label: "Instagram", w: 1080, h: 1080, icon: Square },
  { label: "4K", w: 3840, h: 2160, icon: Monitor },
];

export default function CanvasSetup() {
  const createCanvas = useStore((s) => s.createCanvas);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(800);
  const [activePreset, setActivePreset] = useState(0);

  const applyPreset = (idx) => {
    setActivePreset(idx);
    setWidth(presets[idx].w);
    setHeight(presets[idx].h);
  };

  const handleCreate = () => {
    const w = Math.max(100, Math.min(8000, width));
    const h = Math.max(100, Math.min(8000, height));
    createCanvas(w, h);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        {/* Title */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-100 mb-2">
            Create New Canvas
          </h2>
          <p className="text-gray-400 text-sm">
            Choose a canvas size to get started. You can add multiple halftone
            elements after creating the canvas.
          </p>
        </div>

        {/* Presets grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {presets.map((p, i) => {
            const Icon = p.icon;
            const isActive = activePreset === i;
            return (
              <button
                key={i}
                onClick={() => applyPreset(i)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition ${
                  isActive
                    ? "border-brand-500 bg-brand-600/20 text-white"
                    : "border-gray-700/50 bg-surface-light text-gray-400 hover:text-white hover:border-gray-600"
                }`}
              >
                <Icon className="w-6 h-6" />
                <span className="text-xs font-medium">{p.label}</span>
                <span className="text-[10px] text-gray-500">
                  {p.w} × {p.h}
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom size */}
        <div className="bg-surface-light rounded-xl border border-gray-700/50 p-5 mb-6">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Custom Size
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">
                Width (px)
              </label>
              <input
                type="number"
                value={width}
                min={100}
                max={8000}
                onChange={(e) => {
                  setWidth(parseInt(e.target.value) || 100);
                  setActivePreset(-1);
                }}
                className="w-full bg-surface text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <span className="text-gray-600 mt-5">×</span>
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">
                Height (px)
              </label>
              <input
                type="number"
                value={height}
                min={100}
                max={8000}
                onChange={(e) => {
                  setHeight(parseInt(e.target.value) || 100);
                  setActivePreset(-1);
                }}
                className="w-full bg-surface text-white text-sm px-3 py-2 rounded-lg border border-gray-700 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex items-center justify-center mb-6">
          <div
            className="border border-gray-700/50 bg-surface-light rounded-lg flex items-center justify-center"
            style={{
              width: Math.min(200, (200 * width) / Math.max(width, height)),
              height: Math.min(200, (200 * height) / Math.max(width, height)),
            }}
          >
            <span className="text-[10px] text-gray-500">
              {width} × {height}
            </span>
          </div>
        </div>

        {/* Create button */}
        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white py-3 rounded-xl font-semibold transition text-sm"
        >
          Create Canvas
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
