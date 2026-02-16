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
        saveAs(blob, `halfstone.${format}`);
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
    dots.forEach((d) => {
      const color = d.color || dotColor;
      const r = d.r || params.dot_radius;
      const shape = d.shape || dotShape;
      if (shape === "diamond") {
        const pts = `${d.x},${d.y - r} ${d.x + r},${d.y} ${d.x},${d.y + r} ${d.x - r},${d.y}`;
        svgLines.push(`  <polygon points="${pts}" fill="${color}"/>`);
      } else {
        svgLines.push(`  <circle cx="${d.x}" cy="${d.y}" r="${r}" fill="${color}"/>`);
      }
    });
    svgLines.push("</svg>");

    const blob = new Blob([svgLines.join("\n")], { type: "image/svg+xml" });
    saveAs(blob, "halfstone.svg");
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
