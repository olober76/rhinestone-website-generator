import React from "react";
import { Plus, Diamond } from "lucide-react";
import useStore from "../store";

/**
 * Simple welcome screen — "New Project" button.
 * Canvas size is auto-computed as a square fitting the viewport.
 */
export default function CanvasSetup() {
  const createCanvas = useStore((s) => s.createCanvas);

  const handleNewProject = () => {
    // Compute a square canvas that fits the available viewport
    // Leave room for header (56px), sidebars, and padding
    const availW = window.innerWidth - 320 - 288 - 64; // minus left sidebar, right sidebar, padding
    const availH = window.innerHeight - 56 - 64; // minus header and padding
    const size = Math.max(400, Math.min(availW, availH));
    // Round to nearest 100 for clean numbers
    const rounded = Math.round(size / 100) * 100;
    createCanvas(Math.max(400, rounded));
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center">
        <Diamond className="w-16 h-16 text-brand-500 mx-auto mb-6 opacity-80" />
        <h2 className="text-2xl font-bold text-gray-100 mb-2">
          Halftone <span className="text-brand-500">Studio</span>
        </h2>
        <p className="text-gray-500 text-sm mb-8 max-w-xs mx-auto">
          Create stunning rhinestone &amp; halftone dot patterns from any image.
        </p>
        <button
          onClick={handleNewProject}
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-8 py-3 rounded-xl font-semibold transition text-sm"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>
    </div>
  );
}
