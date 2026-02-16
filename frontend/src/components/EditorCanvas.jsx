import React, { useRef, useEffect, useCallback, useState } from "react";
import useStore from "../store";

/* ── Shape helper: compute polygon points string ── */
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

/**
 * Main SVG-based editor canvas.
 * Click a dot to delete it. Drag on canvas to pan. Scroll to zoom.
 */
export default function EditorCanvas() {
  const svgRef = useRef(null);
  const dots = useStore((s) => s.dots);
  const setDots = useStore((s) => s.setDots);
  const params = useStore((s) => s.params);
  const dotColor = useStore((s) => s.dotColor);
  const bgColor = useStore((s) => s.bgColor);
  const zoom = useStore((s) => s.zoom);
  const pushHistory = useStore((s) => s.pushHistory);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const cw = params.canvas_width;
  const ch = params.canvas_height;

  // ----- Click dot to delete -----
  const handleDotMouseDown = useCallback(
    (e, idx) => {
      e.stopPropagation();
      pushHistory();
      const next = [...dots];
      next.splice(idx, 1);
      setDots(next);
    },
    [dots, pushHistory, setDots],
  );

  // ----- Canvas pan -----
  const handleSvgMouseDown = useCallback(
    (e) => {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Zoom with scroll — only on canvas wrapper
  const canvasWrapperRef = useRef(null);

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

  const dotShape = useStore((s) => s.dotShape);

  /* ── Resolve "random" to a deterministic shape per dot ── */
  const randomShapes = ["circle", "star", "diamond", "hexagon"];
  const resolveShape = (d, i) => {
    const raw = d.shape || dotShape;
    if (raw === "random") return randomShapes[Math.abs(Math.round(d.x * 7 + d.y * 13 + i)) % 4];
    return raw;
  };

  /* ── Render a single dot by shape ── */
  const renderDot = (d, i) => {
    const r = d.r || params.dot_radius;
    const fill = d.color || dotColor;
    const shape = resolveShape(d, i);

    const common = {
      key: i,
      className: "dot-circle",
      fill,
      stroke: "none",
      strokeWidth: 0,
      opacity: 0.9,
      style: { cursor: "pointer" },
      onMouseDown: (e) => handleDotMouseDown(e, i),
    };

    switch (shape) {
      case "diamond":
        return <polygon {...common} points={diamondPoints(d.x, d.y, r)} />;
      case "star":
        return <polygon {...common} points={starPoints(d.x, d.y, r)} />;
      case "hexagon":
        return <polygon {...common} points={hexPoints(d.x, d.y, r)} />;
      default: // circle
        return <circle {...common} cx={d.x} cy={d.y} r={r} />;
    }
  };

  return (
    <div
      ref={canvasWrapperRef}
      className="canvas-container"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px)`,
        cursor: isPanning ? "grabbing" : "grab",
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

        {/* Dots */}
        {dots.map((d, i) => renderDot(d, i))}
      </svg>
    </div>
  );
}
