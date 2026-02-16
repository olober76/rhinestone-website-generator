import React, { useCallback, useState } from "react";
import { Upload, Image as ImageIcon } from "lucide-react";
import useStore from "../store";
import { uploadImage } from "../api";

export default function UploadZone() {
  const [dragging, setDragging] = useState(false);
  const setSessionId = useStore((s) => s.setSessionId);
  const setDots = useStore((s) => s.setDots);
  const setLoading = useStore((s) => s.setLoading);
  const setError = useStore((s) => s.setError);
  const setImageDims = useStore((s) => s.setImageDims);
  const params = useStore((s) => s.params);

  const handleFile = useCallback(
    async (file) => {
      if (!file || !file.type.startsWith("image/")) {
        setError("Please upload an image file (PNG, JPG, SVG, etc.)");
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const data = await uploadImage(
          file,
          params.canvas_width,
          params.canvas_height,
        );
        setSessionId(data.session_id);
        setDots(data.dots);
        setImageDims(data.image_width, data.image_height);
      } catch (e) {
        setError("Upload failed: " + e.message);
      } finally {
        setLoading(false);
      }
    },
    [params.canvas_width, params.canvas_height],
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [handleFile],
  );

  const onFileChange = useCallback(
    (e) => {
      const file = e.target.files[0];
      handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={`dropzone w-full max-w-xl p-12 flex flex-col items-center gap-5 text-center ${
        dragging ? "active" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="w-20 h-20 rounded-full bg-surface-lighter flex items-center justify-center">
        <Upload className="w-9 h-9 text-brand-500" />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-1">Upload your image</h2>
        <p className="text-gray-400 text-sm">
          Drag & drop a logo, design, or photo — or click to browse
        </p>
      </div>

      <label className="cursor-pointer bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-lg font-medium transition">
        Choose File
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />
      </label>

      <div className="flex items-center gap-3 text-xs text-gray-500 mt-2">
        <ImageIcon className="w-4 h-4" />
        <span>PNG, JPG, SVG, BMP, WEBP supported</span>
      </div>
    </div>
  );
}
