import React from "react";
import useStore from "../store";
import { ArrowLeft, Diamond } from "lucide-react";

export default function Header() {
  const canvasCreated = useStore((s) => s.canvasCreated);
  const layers = useStore((s) => s.layers);
  const resetCanvas = useStore((s) => s.resetCanvas);
  const canvasWidth = useStore((s) => s.canvasWidth);
  const canvasHeight = useStore((s) => s.canvasHeight);

  const totalDots = layers.reduce((sum, l) => sum + l.dots.length, 0);

  return (
    <header className="h-14 bg-surface-light border-b border-gray-700/50 flex items-center px-5 gap-3 shrink-0">
      {/* Back button */}
      {canvasCreated && (
        <button
          onClick={resetCanvas}
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm mr-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      )}

      <Diamond className="w-6 h-6 text-brand-500" />
      <h1 className="text-lg font-bold tracking-tight">
        Halftone <span className="text-brand-500">Studio</span>
      </h1>

      {canvasCreated && (
        <div className="ml-auto flex items-center gap-4 text-sm text-gray-400">
          <span className="text-xs text-gray-500">
            {canvasWidth} × {canvasHeight}
          </span>
          <span>
            <strong className="text-gray-200">{layers.length}</strong>{" "}
            {layers.length === 1 ? "layer" : "layers"}
          </span>
          <span>
            <strong className="text-gray-200">
              {totalDots.toLocaleString()}
            </strong>{" "}
            dots
          </span>
        </div>
      )}
    </header>
  );
}
