import React, { useRef, useEffect, useCallback, useState } from "react";
import useStore from "../store";

/**
 * Main SVG-based editor canvas.
 * Each dot is rendered as an editable <circle>.
 */
export default function EditorCanvas() {
  const svgRef = useRef(null);
  const dots = useStore((s) => s.dots);
  const setDots = useStore((s) => s.setDots);
  const params = useStore((s) => s.params);
  const tool = useStore((s) => s.tool);
  const dotColor = useStore((s) => s.dotColor);
  const bgColor = useStore((s) => s.bgColor);
  const zoom = useStore((s) => s.zoom);
  const selectedDot = useStore((s) => s.selectedDot);
  const setSelectedDot = useStore((s) => s.setSelectedDot);
  const pushHistory = useStore((s) => s.pushHistory);

  const [dragging, setDragging] = useState(null); // index of dot being dragged
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const cw = params.canvas_width;
  const ch = params.canvas_height;

  // ----- Dot interactions -----
  const handleDotMouseDown = useCallback(
    (e, idx) => {
      e.stopPropagation();
      if (tool === "delete") {
        pushHistory();
        const next = [...dots];
        next.splice(idx, 1);
        setDots(next);
        setSelectedDot(null);
      } else if (tool === "select") {
        setSelectedDot(idx);
        setDragging(idx);
      }
    },
    [tool, dots, pushHistory, setDots, setSelectedDot],
  );

  const handleSvgMouseDown = useCallback(
    (e) => {
      if (tool === "add") {
        const svg = svgRef.current;
        if (!svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());

        pushHistory();
        setDots([
          ...dots,
          {
            x: Math.round(svgPt.x * 100) / 100,
            y: Math.round(svgPt.y * 100) / 100,
            r: params.dot_radius,
            color: dotColor,
          },
        ]);
      } else if (tool === "select") {
        setSelectedDot(null);
        // Start panning
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    },
    [tool, dots, params.dot_radius, dotColor, pushHistory, setDots, pan],
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (dragging !== null) {
        const svg = svgRef.current;
        if (!svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());

        const next = [...dots];
        next[dragging] = {
          ...next[dragging],
          x: Math.round(svgPt.x * 100) / 100,
          y: Math.round(svgPt.y * 100) / 100,
        };
        setDots(next);
      } else if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    },
    [dragging, dots, setDots, isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    if (dragging !== null) {
      setDragging(null);
    }
    setIsPanning(false);
  }, [dragging]);

  // Zoom with scroll — only on canvas wrapper
  const canvasWrapperRef = useRef(null);
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(0.1, Math.min(5, zoom + delta));
      useStore.getState().setZoom(next);
    },
    [zoom],
  );

  useEffect(() => {
    // Attach to the overflow scroll container (parent of canvas-container)
    // so wheel events anywhere in the canvas area are captured
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

  return (
    <div
      ref={canvasWrapperRef}
      className="canvas-container"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px)`,
        cursor:
          tool === "add"
            ? "crosshair"
            : tool === "delete"
              ? "not-allowed"
              : isPanning
                ? "grabbing"
                : "grab",
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
        {dots.map((d, i) => {
          const r = d.r || params.dot_radius;
          const fill = d.color || dotColor;
          const stroke = selectedDot === i ? "#FFD700" : "none";
          const sw = selectedDot === i ? 1.5 : 0;
          const shape = d.shape || dotShape;

          if (shape === "diamond") {
            const pts = `${d.x},${d.y - r} ${d.x + r},${d.y} ${d.x},${d.y + r} ${d.x - r},${d.y}`;
            return (
              <polygon
                key={i}
                className="dot-circle"
                points={pts}
                fill={fill}
                stroke={stroke}
                strokeWidth={sw}
                opacity={0.9}
                onMouseDown={(e) => handleDotMouseDown(e, i)}
              />
            );
          }
          return (
            <circle
              key={i}
              className="dot-circle"
              cx={d.x}
              cy={d.y}
              r={r}
              fill={fill}
              stroke={stroke}
              strokeWidth={sw}
              opacity={0.9}
              onMouseDown={(e) => handleDotMouseDown(e, i)}
            />
          );
        })}
      </svg>
    </div>
  );
}
