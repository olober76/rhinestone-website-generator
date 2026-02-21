import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
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
    style: {
      cursor: onDelete ? "pointer" : "default",
      pointerEvents: onDelete ? "all" : undefined,
    },
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

/* ── Snap guide configuration ── */
const SNAP_THRESHOLD = 6; // px in canvas coords — distance to snap
const GUIDE_COLOR = "#ff3b9a"; // magenta/pink like Canva/Photoshop

/**
 * Multi-layer SVG editor canvas.
 * Features:
 * - Proper z-order with clipPath per layer (Photoshop-like stacking)
 * - Pan/zoom, per-layer bounding-box move/resize
 * - Snap guides for auto-center and alignment (Canva/Photoshop-like)
 * - Click-to-delete dots
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

  const [pan, _setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  // Synchronous pan updater — keeps panRef always current
  // (useEffect would be too late for rapid wheel events)
  const setPan = useCallback((v) => {
    const next = typeof v === "function" ? v(panRef.current) : v;
    panRef.current = next;
    _setPan(next);
  }, []);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Drag state for bounding-box move/resize
  const [dragMode, setDragMode] = useState(null); // null | 'move' | 'resize-XX'
  const [dragStart, setDragStart] = useState(null);
  const [dragLayerStart, setDragLayerStart] = useState(null);

  // Snap guide lines (shown during drag)
  const [guides, setGuides] = useState([]); // [{axis:'x'|'y', pos:number}]

  // Viewport ref and size for scrollbars
  const viewportRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  const cw = canvasWidth;
  const ch = canvasHeight;

  // ─── Viewport size tracking for scrollbars ───────────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setViewportSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Center canvas when canvas dimensions change ─────────────
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const vpW = el.clientWidth;
    const vpH = el.clientHeight;
    if (vpW <= 0 || vpH <= 0) return;
    const contentW = cw * zoom;
    const contentH = ch * zoom;
    setPan({
      x: (vpW - contentW) / 2,
      y: (vpH - contentH) / 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cw, ch]); // Only re-center on canvas dimension change, NOT viewport/zoom

  // ─── Compute snap targets from canvas + other layers ─────────
  const getSnapTargets = useCallback(
    (excludeLayerId) => {
      const targets = {
        x: [], // vertical snap lines (x positions)
        y: [], // horizontal snap lines (y positions)
      };

      // Canvas edges & center
      targets.x.push(0, cw / 2, cw);
      targets.y.push(0, ch / 2, ch);

      // Other layers' edges & centers
      for (const l of layers) {
        if (l.id === excludeLayerId || !l.visible) continue;
        targets.x.push(l.x, l.x + l.width / 2, l.x + l.width);
        targets.y.push(l.y, l.y + l.height / 2, l.y + l.height);
      }

      return targets;
    },
    [layers, cw, ch],
  );

  // ─── Apply snapping to a position ────────────────────────────
  const applySnap = useCallback(
    (layerX, layerY, layerW, layerH, excludeLayerId) => {
      const targets = getSnapTargets(excludeLayerId);
      const activeGuides = [];
      let snappedX = layerX;
      let snappedY = layerY;

      // Points on the layer that can snap: left, center, right
      const layerXPoints = [layerX, layerX + layerW / 2, layerX + layerW];
      const layerYPoints = [layerY, layerY + layerH / 2, layerY + layerH];

      // Snap X (vertical guides)
      let bestDx = Infinity;
      let bestSnapX = null;
      let bestGuideX = null;
      for (const lxp of layerXPoints) {
        for (const tx of targets.x) {
          const dist = Math.abs(lxp - tx);
          if (dist < SNAP_THRESHOLD && dist < bestDx) {
            bestDx = dist;
            bestSnapX = layerX + (tx - lxp); // shift layer so point aligns
            bestGuideX = tx;
          }
        }
      }
      if (bestSnapX !== null) {
        snappedX = bestSnapX;
        activeGuides.push({ axis: "x", pos: bestGuideX });
      }

      // Snap Y (horizontal guides)
      let bestDy = Infinity;
      let bestSnapY = null;
      let bestGuideY = null;
      for (const lyp of layerYPoints) {
        for (const ty of targets.y) {
          const dist = Math.abs(lyp - ty);
          if (dist < SNAP_THRESHOLD && dist < bestDy) {
            bestDy = dist;
            bestSnapY = layerY + (ty - lyp);
            bestGuideY = ty;
          }
        }
      }
      if (bestSnapY !== null) {
        snappedY = bestSnapY;
        activeGuides.push({ axis: "y", pos: bestGuideY });
      }

      return { x: snappedX, y: snappedY, guides: activeGuides };
    },
    [getSnapTargets],
  );

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
        const rawX = e.clientX - panStart.x;
        const rawY = e.clientY - panStart.y;
        setPan({ x: rawX, y: rawY });
        return;
      }

      // Bounding box drag
      if (dragMode && dragStart && dragLayerStart) {
        const svgPt = clientToSvg(e.clientX, e.clientY);
        const dx = svgPt.x - dragStart.x;
        const dy = svgPt.y - dragStart.y;
        const ls = dragLayerStart;

        if (dragMode === "move") {
          // Apply snapping
          const rawX = ls.x + dx;
          const rawY = ls.y + dy;
          const snapped = applySnap(rawX, rawY, ls.width, ls.height, ls.id);
          updateLayer(ls.id, { x: snapped.x, y: snapped.y });
          setGuides(snapped.guides);
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
      applySnap,
    ],
  );

  const handleMouseUp = useCallback(() => {
    if (dragMode) {
      setDragMode(null);
      setDragStart(null);
      setDragLayerStart(null);
      setGuides([]); // clear guides on drop
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

  // ─── Zoom with scroll — zooms toward pointer position ────────
  // Uses CSS transform scale (not SVG dimension change) so pan+zoom
  // are always atomic in one CSS property — no render-race drift.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const state = useStore.getState();
      const cur = state.zoom;

      // Multiplicative zoom (like the reference example)
      const zoomFactor = 1 - e.deltaY / 500;
      const next = Math.max(1, Math.min(5, cur * zoomFactor));
      if (next === cur) return;

      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const curPan = panRef.current;

      // The canvas point under the cursor (in SVG coords):
      //   canvasX = (mx - pan.x) / curZoom
      // After zoom we want the same point under the cursor:
      //   mx = newPan.x + canvasX * nextZoom
      //   newPan.x = mx - canvasX * nextZoom
      //            = mx - (mx - pan.x) / curZoom * nextZoom
      //            = mx - (mx - pan.x) * (nextZoom / curZoom)
      const ratio = next / cur;
      const newPanX = mx - (mx - curPan.x) * ratio;
      const newPanY = my - (my - curPan.y) * ratio;

      panRef.current = { x: newPanX, y: newPanY };
      _setPan({ x: newPanX, y: newPanY });
      state.setZoom(next);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ─── Scrollbar constants & drag handler ──────────────────────
  const SCROLLBAR_SIZE = 8;
  const SCROLLBAR_MARGIN = 4;
  const MIN_THUMB_SIZE = 30;

  const handleScrollThumbDown = useCallback(
    (e, axis) => {
      e.stopPropagation();
      e.preventDefault();
      const curPan = panRef.current;
      const startMouse = axis === "x" ? e.clientX : e.clientY;
      const startPanVal = axis === "x" ? curPan.x : curPan.y;

      const handleMove = (ev) => {
        const vp = viewportRef.current;
        if (!vp) return;
        const vpRect = vp.getBoundingClientRect();
        const curZoom = useStore.getState().zoom;

        if (axis === "x") {
          const contentTotal = cw * curZoom;
          const vpW = vpRect.width;
          const trackW = vpW - 2 * SCROLLBAR_MARGIN - SCROLLBAR_SIZE;
          const thumbW = Math.max(
            MIN_THUMB_SIZE,
            (vpW / contentTotal) * trackW,
          );
          const scrollableTrack = trackW - thumbW;
          const scrollableContent = contentTotal - vpW;
          if (scrollableTrack <= 0 || scrollableContent <= 0) return;
          const delta = ev.clientX - startMouse;
          const panDelta = (delta / scrollableTrack) * scrollableContent;
          const newX = Math.min(
            0,
            Math.max(vpW - contentTotal, startPanVal - panDelta),
          );
          setPan((prev) => ({ ...prev, x: newX }));
        } else {
          const contentTotal = ch * curZoom;
          const vpH = vpRect.height;
          const trackH = vpH - 2 * SCROLLBAR_MARGIN - SCROLLBAR_SIZE;
          const thumbH = Math.max(
            MIN_THUMB_SIZE,
            (vpH / contentTotal) * trackH,
          );
          const scrollableTrack = trackH - thumbH;
          const scrollableContent = contentTotal - vpH;
          if (scrollableTrack <= 0 || scrollableContent <= 0) return;
          const delta = ev.clientY - startMouse;
          const panDelta = (delta / scrollableTrack) * scrollableContent;
          const newY = Math.min(
            0,
            Math.max(vpH - contentTotal, startPanVal - panDelta),
          );
          setPan((prev) => ({ ...prev, y: newY }));
        }
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [cw, ch],
  );

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

  // ─── Render snap guide lines ─────────────────────────────────
  const renderGuides = () => {
    if (guides.length === 0) return null;
    return (
      <g key="snap-guides" pointerEvents="none">
        {guides.map((g, i) =>
          g.axis === "x" ? (
            <line
              key={`guide-${i}`}
              x1={g.pos}
              y1={0}
              x2={g.pos}
              y2={ch}
              stroke={GUIDE_COLOR}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
          ) : (
            <line
              key={`guide-${i}`}
              x1={0}
              y1={g.pos}
              x2={cw}
              y2={g.pos}
              stroke={GUIDE_COLOR}
              strokeWidth={1 / zoom}
              strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            />
          ),
        )}
      </g>
    );
  };

  // ─── Render a single layer's dots ─────────────────────────────
  const renderLayer = (layer, index) => {
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
        key={`layer-group-${layer.id}`}
        onMouseDown={
          tool === "select"
            ? (e) => {
                e.stopPropagation();
                selectLayer(layer.id);
                startDrag(e, layer, "move");
              }
            : undefined
        }
      >
        <g
          transform={`translate(${layer.x}, ${layer.y}) scale(${scaleX}, ${scaleY}) translate(${-dotOffsetX}, ${-dotOffsetY})`}
        >
          {layer.dots.map((d, i) =>
            renderDot(d, i, layer, tool === "delete" ? handleDotDelete : null),
          )}
        </g>
      </g>
    );
  };

  const getCursor = () => {
    if (isPanning) return "grabbing";
    if (dragMode === "move") return "move";
    if (dragMode) return "crosshair";
    return "grab";
  };

  // ─── Scrollbar computations ──────────────────────────────────
  const contentW = cw * zoom;
  const contentH = ch * zoom;
  const needHScroll = contentW > viewportSize.w;
  const needVScroll = contentH > viewportSize.h;

  const hTrackW =
    viewportSize.w -
    2 * SCROLLBAR_MARGIN -
    (needVScroll ? SCROLLBAR_SIZE + SCROLLBAR_MARGIN : 0);
  const hThumbW =
    hTrackW > 0
      ? Math.max(MIN_THUMB_SIZE, (viewportSize.w / contentW) * hTrackW)
      : 0;
  const hScrollRange = contentW - viewportSize.w;
  const hThumbRange = hTrackW - hThumbW;
  const hThumbX =
    hScrollRange > 0 && hThumbRange > 0
      ? Math.max(
          0,
          Math.min(hThumbRange, (-pan.x / hScrollRange) * hThumbRange),
        )
      : 0;

  const vTrackH =
    viewportSize.h -
    2 * SCROLLBAR_MARGIN -
    (needHScroll ? SCROLLBAR_SIZE + SCROLLBAR_MARGIN : 0);
  const vThumbH =
    vTrackH > 0
      ? Math.max(MIN_THUMB_SIZE, (viewportSize.h / contentH) * vTrackH)
      : 0;
  const vScrollRange = contentH - viewportSize.h;
  const vThumbRange = vTrackH - vThumbH;
  const vThumbY =
    vScrollRange > 0 && vThumbRange > 0
      ? Math.max(
          0,
          Math.min(vThumbRange, (-pan.y / vScrollRange) * vThumbRange),
        )
      : 0;

  return (
    <div
      ref={viewportRef}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        ref={canvasWrapperRef}
        className="canvas-container"
        style={{
          transformOrigin: "0 0",
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          cursor: getCursor(),
        }}
      >
        <svg
          ref={svgRef}
          width={cw}
          height={ch}
          viewBox={`0 0 ${cw} ${ch}`}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Background */}
          <rect width={cw} height={ch} fill={bgColor} />

          {/* Layers — rendered bottom to top, each clipped for proper overlap */}
          {layers.map((layer, index) => renderLayer(layer, index))}

          {/* Snap guide lines — rendered above layers */}
          {renderGuides()}

          {/* Bounding boxes — rendered on top of everything */}
          {layers.map((layer) => renderBoundingBox(layer))}
        </svg>
      </div>

      {/* Horizontal scrollbar */}
      {needHScroll && (
        <div
          style={{
            position: "absolute",
            bottom: SCROLLBAR_MARGIN,
            left: SCROLLBAR_MARGIN,
            width: hTrackW,
            height: SCROLLBAR_SIZE,
            borderRadius: SCROLLBAR_SIZE / 2,
            backgroundColor: "rgba(0,0,0,0.15)",
            zIndex: 10,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              position: "absolute",
              left: hThumbX,
              top: 0,
              width: hThumbW,
              height: SCROLLBAR_SIZE,
              borderRadius: SCROLLBAR_SIZE / 2,
              backgroundColor: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              transition: "background-color 0.15s",
            }}
            onMouseDown={(e) => handleScrollThumbDown(e, "x")}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.7)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.5)";
            }}
          />
        </div>
      )}

      {/* Vertical scrollbar */}
      {needVScroll && (
        <div
          style={{
            position: "absolute",
            right: SCROLLBAR_MARGIN,
            top: SCROLLBAR_MARGIN,
            width: SCROLLBAR_SIZE,
            height: vTrackH,
            borderRadius: SCROLLBAR_SIZE / 2,
            backgroundColor: "rgba(0,0,0,0.15)",
            zIndex: 10,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              position: "absolute",
              top: vThumbY,
              left: 0,
              width: SCROLLBAR_SIZE,
              height: vThumbH,
              borderRadius: SCROLLBAR_SIZE / 2,
              backgroundColor: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              transition: "background-color 0.15s",
            }}
            onMouseDown={(e) => handleScrollThumbDown(e, "y")}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.7)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.5)";
            }}
          />
        </div>
      )}
    </div>
  );
}
