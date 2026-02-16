import React, { useRef, useEffect, useCallback, useState } from "react";
import useStore from "../store";

/* ── Shape helpers ── */
function starPoints(cx, cy, r) {
  const outer = r,
    inner = r * 0.4;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

function diamondPoints(cx, cy, r) {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

const randomShapes = ["circle", "star", "diamond", "hexagon"];

function resolveShape(d, i, layerShape) {
  const raw = d.shape || layerShape;
  if (raw === "random")
    return randomShapes[Math.abs(Math.round(d.x * 7 + d.y * 13 + i)) % 4];
  return raw;
}

/** Render a single dot SVG element. */
function renderDot(d, i, layer, onDelete) {
  const r = d.r || layer.params.dot_radius;
  const fill = d.color || layer.dotColor;
  const shape = resolveShape(d, i, layer.dotShape);

  const common = {
    key: i,
    className: "dot-circle",
    fill,
    stroke: "none",
    strokeWidth: 0,
    opacity: layer.opacity * 0.9,
    style: { cursor: onDelete ? "pointer" : "default" },
    onMouseDown: onDelete
      ? (e) => {
          e.stopPropagation();
          onDelete(layer.id, i);
        }
      : undefined,
  };

  switch (shape) {
    case "diamond":
      return <polygon {...common} points={diamondPoints(d.x, d.y, r)} />;
    case "star":
      return <polygon {...common} points={starPoints(d.x, d.y, r)} />;
    case "hexagon":
      return <polygon {...common} points={hexPoints(d.x, d.y, r)} />;
    default:
      return <circle {...common} cx={d.x} cy={d.y} r={r} />;
  }
}

/* ── Bounding-box resize handle size (in canvas coordinates) ── */
const HANDLE_SIZE = 8;

/**
 * Multi-layer SVG editor canvas.
 * Supports pan/zoom, per-layer bounding-box move/resize,
 * click-to-delete dots, and layer ordering.
 */
export default function EditorCanvas() {
  const svgRef = useRef(null);
  const canvasWrapperRef = useRef(null);

  const layers = useStore((s) => s.layers);
  const selectedLayerId = useStore((s) => s.selectedLayerId);
  const selectLayer = useStore((s) => s.selectLayer);
  const updateLayer = useStore((s) => s.updateLayer);
  const canvasWidth = useStore((s) => s.canvasWidth);
  const canvasHeight = useStore((s) => s.canvasHeight);
  const bgColor = useStore((s) => s.bgColor);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const pushHistory = useStore((s) => s.pushHistory);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Drag state for bounding-box move/resize
  const [dragMode, setDragMode] = useState(null); // null | 'move' | 'resize-XX'
  const [dragStart, setDragStart] = useState(null);
  const [dragLayerStart, setDragLayerStart] = useState(null);

  const cw = canvasWidth;
  const ch = canvasHeight;

  // ─── Convert client coords to SVG coords ─────────────────────
  const clientToSvg = useCallback(
    (clientX, clientY) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * cw,
        y: ((clientY - rect.top) / rect.height) * ch,
      };
    },
    [cw, ch],
  );

  // ─── Delete dot in a layer ────────────────────────────────────
  const handleDotDelete = useCallback(
    (layerId, dotIdx) => {
      if (tool !== "delete") return;
      pushHistory();
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;
      const next = [...layer.dots];
      next.splice(dotIdx, 1);
      updateLayer(layerId, { dots: next });
    },
    [tool, layers, pushHistory, updateLayer],
  );

  // ─── Canvas pan ──────────────────────────────────────────────
  const handleSvgMouseDown = useCallback(
    (e) => {
      // Only pan if not interacting with a layer element
      if (e.target === svgRef.current || e.target.tagName === "rect") {
        if (tool === "select") {
          // Deselect layer when clicking empty canvas
          selectLayer(null);
        }
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [pan, tool, selectLayer],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
        return;
      }

      // Bounding box drag
      if (dragMode && dragStart && dragLayerStart) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        const dx = svgPt.x - dragStart.x;
        const dy = svgPt.y - dragStart.y;
        const ls = dragLayerStart;

        if (dragMode === "move") {
          updateLayer(ls.id, { x: ls.x + dx, y: ls.y + dy });
        } else if (dragMode === "resize-se") {
          const newW = Math.max(50, ls.width + dx);
          const newH = Math.max(50, ls.height + dy);
          updateLayer(ls.id, { width: newW, height: newH });
        } else if (dragMode === "resize-sw") {
          const newW = Math.max(50, ls.width - dx);
          const newH = Math.max(50, ls.height + dy);
          updateLayer(ls.id, {
            x: ls.x + (ls.width - newW),
            width: newW,
            height: newH,
          });
        } else if (dragMode === "resize-ne") {
          const newW = Math.max(50, ls.width + dx);
          const newH = Math.max(50, ls.height - dy);
          updateLayer(ls.id, {
            y: ls.y + (ls.height - newH),
            width: newW,
            height: newH,
          });
        } else if (dragMode === "resize-nw") {
          const newW = Math.max(50, ls.width - dx);
          const newH = Math.max(50, ls.height - dy);
          updateLayer(ls.id, {
            x: ls.x + (ls.width - newW),
            y: ls.y + (ls.height - newH),
            width: newW,
            height: newH,
          });
        } else if (dragMode === "resize-n") {
          const newH = Math.max(50, ls.height - dy);
          updateLayer(ls.id, { y: ls.y + (ls.height - newH), height: newH });
        } else if (dragMode === "resize-s") {
          const newH = Math.max(50, ls.height + dy);
          updateLayer(ls.id, { height: newH });
        } else if (dragMode === "resize-e") {
          const newW = Math.max(50, ls.width + dx);
          updateLayer(ls.id, { width: newW });
        } else if (dragMode === "resize-w") {
          const newW = Math.max(50, ls.width - dx);
          updateLayer(ls.id, { x: ls.x + (ls.width - newW), width: newW });
        }
      }
    },
    [
      isPanning,
      panStart,
      dragMode,
      dragStart,
      dragLayerStart,
      clientToSvg,
      updateLayer,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (dragMode) {
      setDragMode(null);
      setDragStart(null);
      setDragLayerStart(null);
    }
    setIsPanning(false);
  }, [dragMode]);

  // ─── Start bounding-box interaction ──────────────────────────
  const startDrag = useCallback(
    (e, layer, mode) => {
      e.stopPropagation();
      pushHistory();
      selectLayer(layer.id);
      setDragMode(mode);
      setDragStart(clientToSvg(e.clientX, e.clientY));
      setDragLayerStart({
        id: layer.id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
      });
    },
    [clientToSvg, pushHistory, selectLayer],
  );

  // ─── Zoom with scroll ────────────────────────────────────────
  useEffect(() => {
    const el = canvasWrapperRef.current?.parentElement;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const cur = useStore.getState().zoom;
      const next = Math.max(0.1, Math.min(5, cur + delta));
      useStore.getState().setZoom(next);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ─── Render bounding box + handles for selected layer ────────
  const renderBoundingBox = (layer) => {
    if (layer.id !== selectedLayerId || tool !== "select") return null;
    const { x, y, width, height } = layer;
    const hs = HANDLE_SIZE / zoom; // scale-independent handle size

    const handles = [
      { mode: "resize-nw", cx: x, cy: y, cursor: "nwse-resize" },
      { mode: "resize-ne", cx: x + width, cy: y, cursor: "nesw-resize" },
      { mode: "resize-sw", cx: x, cy: y + height, cursor: "nesw-resize" },
      {
        mode: "resize-se",
        cx: x + width,
        cy: y + height,
        cursor: "nwse-resize",
      },
      { mode: "resize-n", cx: x + width / 2, cy: y, cursor: "ns-resize" },
      {
        mode: "resize-s",
        cx: x + width / 2,
        cy: y + height,
        cursor: "ns-resize",
      },
      { mode: "resize-w", cx: x, cy: y + height / 2, cursor: "ew-resize" },
      {
        mode: "resize-e",
        cx: x + width,
        cy: y + height / 2,
        cursor: "ew-resize",
      },
    ];

    return (
      <g key={`bbox-${layer.id}`}>
        {/* Bounding box outline */}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke="#7c3aed"
          strokeWidth={2 / zoom}
          strokeDasharray={`${6 / zoom} ${4 / zoom}`}
          pointerEvents="none"
        />

        {/* Move area (transparent fill over the layer) */}
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="transparent"
          style={{ cursor: "move" }}
          onMouseDown={(e) => startDrag(e, layer, "move")}
        />

        {/* Resize handles */}
        {handles.map((h) => (
          <rect
            key={h.mode}
            x={h.cx - hs / 2}
            y={h.cy - hs / 2}
            width={hs}
            height={hs}
            fill="white"
            stroke="#7c3aed"
            strokeWidth={1.5 / zoom}
            style={{ cursor: h.cursor }}
            onMouseDown={(e) => startDrag(e, layer, h.mode)}
          />
        ))}
      </g>
    );
  };

  // ─── Render a single layer's dots with transform ─────────────
  const renderLayer = (layer) => {
    if (!layer.visible || layer.dots.length === 0) return null;

    // Dots are generated at canvas-space coordinates.
    // The bounding box (x, y, width, height) was computed from actual dot extents.
    // We scale from dot-extent space to the current bounding box size.
    const dotOffsetX = layer._dotOffsetX || 0;
    const dotOffsetY = layer._dotOffsetY || 0;
    const origW = layer._origWidth || layer.width;
    const origH = layer._origHeight || layer.height;
    const scaleX = layer.width / origW;
    const scaleY = layer.height / origH;

    return (
      <g
        key={`dots-${layer.id}`}
        transform={`translate(${layer.x}, ${layer.y}) scale(${scaleX}, ${scaleY}) translate(${-dotOffsetX}, ${-dotOffsetY})`}
        onMouseDown={(e) => {
          if (tool === "select") {
            e.stopPropagation();
            selectLayer(layer.id);
            // Also start move
            startDrag(e, layer, "move");
          }
        }}
      >
        {layer.dots.map((d, i) =>
          renderDot(d, i, layer, tool === "delete" ? handleDotDelete : null),
        )}
      </g>
    );
  };

  const getCursor = () => {
    if (isPanning) return "grabbing";
    if (dragMode === "move") return "move";
    if (dragMode) return "crosshair";
    return "grab";
  };

  return (
    <div
      ref={canvasWrapperRef}
      className="canvas-container"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px)`,
        cursor: getCursor(),
      }}
    >
      <svg
        ref={svgRef}
        width={cw * zoom}
        height={ch * zoom}
        viewBox={`0 0 ${cw} ${ch}`}
        onMouseDown={handleSvgMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Background */}
        <rect width={cw} height={ch} fill={bgColor} />

        {/* Layers — rendered bottom to top */}
        {layers.map((layer) => renderLayer(layer))}

        {/* Bounding boxes — rendered on top of everything */}
        {layers.map((layer) => renderBoundingBox(layer))}
      </svg>
    </div>
  );
}
