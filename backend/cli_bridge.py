"""
Halftone Studio — CLI Bridge for Electron Desktop App

Reads JSON commands from stdin, processes them using the same pipeline
as the web backend, and writes JSON results to stdout.

No FastAPI/uvicorn needed — runs as a child process of Electron.

Protocol:
  → stdin:  one JSON object per line (newline-delimited JSON)
  ← stdout: one JSON object per line as response

Commands:
  {"cmd": "upload", "image_b64": "...", "canvas_width": 800, "canvas_height": 800}
  {"cmd": "regenerate", "image_b64": "...", "params": {...}}
  {"cmd": "export", "dots": [...], "format": "png", "width": 800, "height": 800, "dot_shape": "circle"}
  {"cmd": "ping"}
"""

import sys
import json
import base64
import traceback

from processing.pipeline import process_image
from processing.svg_generator import dots_to_svg_string
from processing.export import svg_to_png, svg_to_jpg


class ParamsObj:
    """Lightweight params object matching the DotParams interface."""
    def __init__(self, d: dict):
        self.dot_radius = d.get("dot_radius", 4.0)
        self.min_spacing = d.get("min_spacing", 10.0)
        self.density = d.get("density", 1.0)
        self.method = d.get("method", "poisson")
        self.edge_strength = d.get("edge_strength", 0.6)
        self.rotation = d.get("rotation", 0.0)
        self.contrast = d.get("contrast", 1.2)
        self.invert = d.get("invert", False)
        self.use_contour_follow = d.get("use_contour_follow", True)
        self.dot_shape = d.get("dot_shape", "circle")
        self.sizing_mode = d.get("sizing_mode", "uniform")
        self.canvas_width = d.get("canvas_width", 800)
        self.canvas_height = d.get("canvas_height", 800)


# Store the latest uploaded image in memory
_image_store: dict = {}


def handle_upload(msg: dict) -> dict:
    image_b64 = msg["image_b64"]
    raw = base64.b64decode(image_b64)
    cw = msg.get("canvas_width", 800)
    ch = msg.get("canvas_height", 800)

    params = ParamsObj({"canvas_width": cw, "canvas_height": ch})
    result = process_image(raw, params)

    # Store image for later regeneration
    _image_store["raw"] = raw

    return {
        "ok": True,
        "dots": result["dots"],
        "dot_count": len(result["dots"]),
        "image_width": result["image_width"],
        "image_height": result["image_height"],
        "canvas_width": cw,
        "canvas_height": ch,
    }


def handle_regenerate(msg: dict) -> dict:
    # Allow passing image_b64 again, or reuse stored
    if "image_b64" in msg and msg["image_b64"]:
        raw = base64.b64decode(msg["image_b64"])
        _image_store["raw"] = raw
    else:
        raw = _image_store.get("raw")
        if not raw:
            return {"ok": False, "error": "No image in memory. Upload first."}

    params = ParamsObj(msg.get("params", {}))
    result = process_image(raw, params)

    return {
        "ok": True,
        "dots": result["dots"],
        "dot_count": len(result["dots"]),
        "image_width": result["image_width"],
        "image_height": result["image_height"],
    }


def handle_export(msg: dict) -> dict:
    dots = msg.get("dots", [])
    fmt = msg.get("format", "svg").lower()
    width = msg.get("width", 800)
    height = msg.get("height", 800)
    dot_shape = msg.get("dot_shape", "circle")

    svg_string = dots_to_svg_string(dots, width, height, dot_shape=dot_shape)

    if fmt == "svg":
        return {
            "ok": True,
            "format": "svg",
            "data_b64": base64.b64encode(svg_string.encode("utf-8")).decode("ascii"),
        }
    elif fmt == "png":
        png_bytes = svg_to_png(svg_string)
        return {
            "ok": True,
            "format": "png",
            "data_b64": base64.b64encode(png_bytes).decode("ascii"),
        }
    elif fmt == "jpg":
        jpg_bytes = svg_to_jpg(svg_string)
        return {
            "ok": True,
            "format": "jpg",
            "data_b64": base64.b64encode(jpg_bytes).decode("ascii"),
        }
    else:
        return {"ok": False, "error": f"Unsupported format: {fmt}"}


def main():
    # Signal ready
    sys.stdout.write(json.dumps({"status": "ready"}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError as e:
            resp = {"ok": False, "error": f"Invalid JSON: {e}"}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        try:
            cmd = msg.get("cmd", "")
            if cmd == "ping":
                resp = {"ok": True, "pong": True}
            elif cmd == "upload":
                resp = handle_upload(msg)
            elif cmd == "regenerate":
                resp = handle_regenerate(msg)
            elif cmd == "export":
                resp = handle_export(msg)
            else:
                resp = {"ok": False, "error": f"Unknown command: {cmd}"}
        except Exception:
            resp = {"ok": False, "error": traceback.format_exc()}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
