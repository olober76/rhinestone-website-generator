import React, { useCallback, useState, useRef } from "react";
import {
  Eye,
  EyeOff,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Plus,
  Pencil,
  Image as ImageIcon,
} from "lucide-react";
import useStore, { createLayer } from "../store";
import { uploadImage } from "../api";

/**
 * Right sidebar — Photoshop-like layer panel.
 * Shows all layers (top = front), with controls for ordering,
 * visibility, deletion, and adding new elements.
 */
export default function LayerPanel() {
  const layers = useStore((s) => s.layers);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const selectLayer = useStore((s) => s.selectLayer);
  const removeLayer = useStore((s) => s.removeLayer);
  const toggleLayerVisibility = useStore((s) => s.toggleLayerVisibility);
  const moveLayerUp = useStore((s) => s.moveLayerUp);
  const moveLayerDown = useStore((s) => s.moveLayerDown);
  const moveLayerToTop = useStore((s) => s.moveLayerToTop);
  const moveLayerToBottom = useStore((s) => s.moveLayerToBottom);

  const renameLayer = useStore((s) => s.renameLayer);
  const addLayer = useStore((s) => s.addLayer);
  const updateLayer = useStore((s) => s.updateLayer);
  const canvasWidth = useStore((s) => s.canvasWidth);
  const canvasHeight = useStore((s) => s.canvasHeight);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const pushHistory = useStore((s) => s.pushHistory);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Add new element (upload image) ──
  const handleAddElement = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) {
        setError("Please select an image file");
        return;
      }
      // Reset file input so same file can be re-selected
      e.target.value = "";

      try {
        pushHistory();
        setLoading(true);
        setError(null);

        const data = await uploadImage(file, canvasWidth, canvasHeight);

        // Compute tight bounding box from actual dot positions
        const dots = data.dots;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const d of dots) {
          const r = d.r || 4;
          if (d.x - r < minX) minX = d.x - r;
          if (d.y - r < minY) minY = d.y - r;
          if (d.x + r > maxX) maxX = d.x + r;
          if (d.y + r > maxY) maxY = d.y + r;
        }
        // Fallback if no dots
        if (!isFinite(minX)) {
          minX = 0;
          minY = 0;
          maxX = canvasWidth;
          maxY = canvasHeight;
        }

        const dotW = maxX - minX;
        const dotH = maxY - minY;

        // Scale element to ~50% of canvas, centered
        const scale = 0.5;
        const newW = dotW * scale;
        const newH = dotH * scale;
        const newX = (canvasWidth - newW) / 2;
        const newY = (canvasHeight - newH) / 2;

        const layer = createLayer({
          sessionId: data.session_id,
          dots: dots,
          imageWidth: data.image_width,
          imageHeight: data.image_height,
          // Bounding box at half canvas size, centered
          width: newW,
          height: newH,
          x: newX,
          y: newY,
          // Store offsets so the transform stays correct
          _dotOffsetX: minX,
          _dotOffsetY: minY,
          _origWidth: dotW,
          _origHeight: dotH,
        });

        addLayer(layer);
      } catch (err) {
        setError("Upload failed: " + err.message);
      } finally {
        setLoading(false);
      }
    },
    [canvasWidth, canvasHeight, addLayer, pushHistory, setLoading, setError],
  );

  // ── Rename ──
  const startRename = (id, currentName) => {
    setEditingId(id);
    setEditName(currentName);
    setTimeout(() => inputRef.current?.select(), 50);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameLayer(editingId, editName.trim());
    }
    setEditingId(null);
  };

  // Reversed layers: display top → bottom (rendering order is bottom → top)
  const reversedLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full">
      {/* Header + Add Element button */}
      <div className="px-3 py-3 border-b border-gray-700/50 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Layers
          </h2>
          <span className="text-[10px] text-gray-600">
            {layers.length} element{layers.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={handleAddElement}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-xs py-2.5 rounded-lg font-medium transition"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Element
        </button>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto">
        {reversedLayers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs gap-2 p-6 text-center">
            <ImageIcon className="w-8 h-8 opacity-50" />
            <span>No elements yet</span>
            <span className="text-[10px]">
              Click "Add Element" to upload an image
            </span>
          </div>
        ) : (
          reversedLayers.map((layer) => {
            const isSelected = layer.id === selectedLayerId;
            return (
              <div
                key={layer.id}
                onClick={() => selectLayer(layer.id)}
                className={`group flex items-center gap-2 px-3 py-2.5 border-b border-gray-800/50 cursor-pointer transition ${
                  isSelected
                    ? "bg-brand-600/20 border-l-2 border-l-brand-500"
                    : "hover:bg-surface-lighter border-l-2 border-l-transparent"
                }`}
              >
                {/* Visibility toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisibility(layer.id);
                  }}
                  className={`p-0.5 rounded transition ${
                    layer.visible
                      ? "text-gray-400 hover:text-white"
                      : "text-gray-700 hover:text-gray-500"
                  }`}
                  title={layer.visible ? "Hide" : "Show"}
                >
                  {layer.visible ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Dot color indicator */}
                <div
                  className="w-3 h-3 rounded-sm shrink-0 border border-gray-700"
                  style={{ backgroundColor: layer.dotColor }}
                />

                {/* Name */}
                <div className="flex-1 min-w-0">
                  {editingId === layer.id ? (
                    <input
                      ref={inputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full bg-surface text-white text-xs px-1 py-0.5 rounded border border-brand-500 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`text-xs truncate block ${
                        isSelected ? "text-white font-medium" : "text-gray-300"
                      } ${!layer.visible ? "opacity-50" : ""}`}
                      onDoubleClick={() => startRename(layer.id, layer.name)}
                    >
                      {layer.name}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600 block">
                    {layer.dots.length} dots
                  </span>
                </div>

                {/* Actions — visible on hover or selected */}
                <div
                  className={`flex items-center gap-0.5 ${
                    isSelected
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  } transition-opacity`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(layer.id, layer.name);
                    }}
                    className="p-0.5 text-gray-500 hover:text-white transition"
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pushHistory();
                      moveLayerUp(layer.id);
                    }}
                    className="p-0.5 text-gray-500 hover:text-white transition"
                    title="Move forward"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pushHistory();
                      moveLayerDown(layer.id);
                    }}
                    className="p-0.5 text-gray-500 hover:text-white transition"
                    title="Move backward"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pushHistory();
                      removeLayer(layer.id);
                    }}
                    className="p-0.5 text-gray-500 hover:text-red-400 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom actions — layer ordering */}
      {selectedLayerId && layers.length > 1 && (
        <div className="px-3 py-3 border-t border-gray-700/50 shrink-0">
          <div className="flex gap-1">
            <button
              onClick={() => {
                pushHistory();
                moveLayerToTop(selectedLayerId);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-white bg-surface-lighter/50 hover:bg-surface-lighter py-1.5 rounded transition"
              title="Bring to front"
            >
              <ChevronsUp className="w-3 h-3" />
              Front
            </button>
            <button
              onClick={() => {
                pushHistory();
                moveLayerUp(selectedLayerId);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-white bg-surface-lighter/50 hover:bg-surface-lighter py-1.5 rounded transition"
              title="Move forward"
            >
              <ChevronUp className="w-3 h-3" />
              Up
            </button>
            <button
              onClick={() => {
                pushHistory();
                moveLayerDown(selectedLayerId);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-white bg-surface-lighter/50 hover:bg-surface-lighter py-1.5 rounded transition"
              title="Move backward"
            >
              <ChevronDown className="w-3 h-3" />
              Down
            </button>
            <button
              onClick={() => {
                pushHistory();
                moveLayerToBottom(selectedLayerId);
              }}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-white bg-surface-lighter/50 hover:bg-surface-lighter py-1.5 rounded transition"
              title="Send to back"
            >
              <ChevronsDown className="w-3 h-3" />
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
