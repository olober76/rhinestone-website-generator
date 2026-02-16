import React, { useCallback, useState } from "react";
import { Download, FileImage, FileType, FileCode } from "lucide-react";
import useStore from "../store";
import { exportPattern } from "../api";
import { saveAs } from "file-saver";

const formats = [
  {
    id: "svg",
    label: "SVG",
    icon: FileCode,
    desc: "Vector (best for production)",
  },
  {
    id: "png",
    label: "PNG",
    icon: FileImage,
    desc: "Transparent raster image",
  },
  { id: "jpg", label: "JPG", icon: FileType, desc: "Compressed raster image" },
];

export default function ExportPanel() {
  const sessionId = useStore((s) => s.sessionId);
  const dots = useStore((s) => s.dots);
  const params = useStore((s) => s.params);
  const dotColor = useStore((s) => s.dotColor);
  const bgColor = useStore((s) => s.bgColor);
  const dotShape = useStore((s) => s.dotShape);
  const [exporting, setExporting] = useState(null);

  const handleExport = useCallback(
    async (format) => {
      if (!sessionId) return;
      try {
        setExporting(format);

        // Attach current colors to dots before export
        const coloredDots = dots.map((d) => ({
          ...d,
          color: d.color || dotColor,
        }));

        const blob = await exportPattern(
          sessionId,
          format,
          params.canvas_width,
          params.canvas_height,
          coloredDots,
          dotShape,
        );
        saveAs(blob, `halftone.${format}`);
      } catch (e) {
        useStore.getState().setError("Export failed: " + e.message);
      } finally {
        setExporting(null);
      }
    },
    [sessionId, dots, params, dotColor],
  );

  // Client-side SVG export (instant, no server round-trip)
  const handleClientSvgExport = useCallback(() => {
    const svgLines = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${params.canvas_width}" height="${params.canvas_height}" viewBox="0 0 ${params.canvas_width} ${params.canvas_height}">`,
      `  <rect width="${params.canvas_width}" height="${params.canvas_height}" fill="${bgColor}"/>`,
    ];

    const starPts = (cx, cy, r) => {
      const outer = r,
        inner = r * 0.4;
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rd = i % 2 === 0 ? outer : inner;
        return `${cx + rd * Math.cos(a)},${cy + rd * Math.sin(a)}`;
      }).join(" ");
    };
    const hexPts = (cx, cy, r) =>
      Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      }).join(" ");

    const randomShapes = ["circle", "star", "diamond", "hexagon"];
    dots.forEach((d, i) => {
      const color = d.color || dotColor;
      const r = d.r || params.dot_radius;
      let shape = d.shape || dotShape;
      if (shape === "random") shape = randomShapes[Math.abs(Math.round(d.x * 7 + d.y * 13 + i)) % 4];
      if (shape === "diamond") {
        const pts = `${d.x},${d.y - r} ${d.x + r},${d.y} ${d.x},${d.y + r} ${d.x - r},${d.y}`;
        svgLines.push(`  <polygon points="${pts}" fill="${color}"/>`);
      } else if (shape === "star") {
        svgLines.push(
          `  <polygon points="${starPts(d.x, d.y, r)}" fill="${color}"/>`,
        );
      } else if (shape === "hexagon") {
        svgLines.push(
          `  <polygon points="${hexPts(d.x, d.y, r)}" fill="${color}"/>`,
        );
      } else {
        svgLines.push(
          `  <circle cx="${d.x}" cy="${d.y}" r="${r}" fill="${color}"/>`,
        );
      }
    });
    svgLines.push("</svg>");

    const blob = new Blob([svgLines.join("\n")], { type: "image/svg+xml" });
    saveAs(blob, "halftone.svg");
  }, [dots, params, dotColor, bgColor, dotShape]);

  return (
    <div className="p-4 border-t border-gray-700/50 flex flex-col gap-3 mt-auto">
      <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider flex items-center gap-2">
        <Download className="w-4 h-4" />
        Export
      </h2>

      <div className="flex flex-col gap-2">
        {formats.map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() =>
              id === "svg" ? handleClientSvgExport() : handleExport(id)
            }
            disabled={exporting !== null}
            className={`flex items-center gap-3 p-2.5 rounded-lg transition text-left ${
              exporting === id
                ? "bg-brand-600/30 text-brand-100"
                : "bg-surface-lighter hover:bg-surface-lighter/80 text-gray-300 hover:text-white"
            }`}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="text-xs text-gray-500">{desc}</div>
            </div>
            {exporting === id && (
              <div className="spinner !w-5 !h-5 !border-2" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
