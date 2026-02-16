import React from "react";
import { Trash2, Undo2, ZoomIn, ZoomOut, MousePointer2 } from "lucide-react";
import useStore from "../store";

const btnClass = (active) =>
  `p-2 rounded-lg transition ${
    active
      ? "bg-brand-600 text-white"
      : "bg-surface-lighter text-gray-400 hover:text-white hover:bg-surface-lighter/80"
  }`;

export default function Toolbar() {
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const history = useStore((s) => s.history);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="h-11 bg-surface-light border-b border-gray-700/50 flex items-center px-4 gap-2 shrink-0">
      {/* Select tool */}
      <button
        className={btnClass(tool === "select")}
        onClick={() => setTool("select")}
        title="Select / Move / Resize elements"
      >
        <MousePointer2 className="w-4 h-4" />
      </button>

      {/* Delete tool */}
      <button
        className={btnClass(tool === "delete")}
        onClick={() => setTool("delete")}
        title="Click dots to delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <span className="text-xs text-gray-500 ml-1">
        {tool === "select" ? "Select / Move" : "Click dot to delete"}
      </span>

      <div className="w-px h-6 bg-gray-700 mx-1" />

      {/* Undo */}
      <button
        className={`p-2 rounded-lg transition ${
          history.length
            ? "text-gray-400 hover:text-white"
            : "text-gray-600 cursor-not-allowed"
        } bg-surface-lighter`}
        onClick={undo}
        disabled={!history.length}
        title="Undo"
      >
        <Undo2 className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-gray-700 mx-1" />

      {/* Zoom */}
      <button
        className="p-2 rounded-lg bg-surface-lighter text-gray-400 hover:text-white transition"
        onClick={() => setZoom(Math.max(0.1, zoom - 0.2))}
        title="Zoom out"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <span className="text-xs text-gray-400 w-12 text-center">
        {Math.round(zoom * 100)}%
      </span>
      <button
        className="p-2 rounded-lg bg-surface-lighter text-gray-400 hover:text-white transition"
        onClick={() => setZoom(Math.min(5, zoom + 0.2))}
        title="Zoom in"
      >
        <ZoomIn className="w-4 h-4" />
      </button>

      <button
        className="ml-1 text-xs text-gray-500 hover:text-gray-300 transition"
        onClick={() => setZoom(1)}
      >
        Reset
      </button>
    </div>
  );
}
