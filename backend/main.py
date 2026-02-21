"""
Rhinestone / Halftone Pattern Generator — FastAPI Backend
Converts images into editable dot patterns suitable for clothing production.
"""

import io
import uuid
import logging
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from processing.pipeline import process_image
from processing.svg_generator import generate_svg, dots_to_svg_string
from processing.export import svg_to_png, svg_to_jpg

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Halftone Studio",
    version="1.0.0",
    description="Convert any image/logo into halftone dot patterns with variable sizing",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store for processed sessions (swap for Redis/DB later)
sessions: dict = {}

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class DotParams(BaseModel):
    dot_radius: float = Field(4.0, ge=1, le=15, description="Radius of each dot")
    min_spacing: float = Field(10.0, ge=3, le=30, description="Minimum gap between dots")
    density: float = Field(1.0, ge=0.1, le=5.0, description="Density multiplier")
    method: str = Field("grid", description="Placement method: poisson | grid | contour")
    edge_strength: float = Field(0.6, ge=0.0, le=1.0, description="How strongly dots follow contours")
    rotation: float = Field(0.0, ge=0.0, le=360.0, description="Pattern rotation in degrees")
    contrast: float = Field(1.2, ge=0.1, le=3.0, description="Contrast adjustment")
    invert: bool = Field(False, description="Invert brightness mapping")
    use_contour_follow: bool = Field(False, description="Enable contour-following placement")
    dot_shape: str = Field("circle", description="Dot shape: circle | diamond | star | hexagon | random")
    sizing_mode: str = Field("uniform", description="Sizing mode: uniform | variable")
    canvas_width: int = Field(800, ge=100, le=4000)
    canvas_height: int = Field(800, ge=100, le=4000)


class RegenerateRequest(BaseModel):
    session_id: str
    params: DotParams


class ExportRequest(BaseModel):
    session_id: str
    format: str = Field("svg", description="Export format: svg | png | jpg")
    width: int = Field(800, ge=100, le=4000)
    height: int = Field(800, ge=100, le=4000)
    dots: Optional[list] = Field(None, description="Optional: edited dot array from frontend")
    dot_shape: str = Field("circle", description="Dot shape: circle | diamond | star | hexagon | random")


class DotEditRequest(BaseModel):
    session_id: str
    dots: list  # [{x, y, r}, ...]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_image(
    file: UploadFile = File(...),
    canvas_width: int = 800,
    canvas_height: int = 800,
):
    """Upload an image and get initial dot pattern."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    contents = await file.read()
    session_id = str(uuid.uuid4())

    try:
        # Run full processing pipeline with default params
        params = DotParams(canvas_width=canvas_width, canvas_height=canvas_height)
        result = process_image(contents, params)

        sessions[session_id] = {
            "raw_image": contents,
            "dots": result["dots"],
            "params": params.model_dump(),
            "image_width": result["image_width"],
            "image_height": result["image_height"],
        }

        return {
            "session_id": session_id,
            "dots": result["dots"],
            "dot_count": len(result["dots"]),
            "image_width": result["image_width"],
            "image_height": result["image_height"],
            "canvas_width": params.canvas_width,
            "canvas_height": params.canvas_height,
        }

    except Exception as e:
        logger.exception("Processing failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/regenerate")
async def regenerate_dots(req: RegenerateRequest):
    """Regenerate dot pattern with new parameters."""
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        result = process_image(session["raw_image"], req.params)
        session["dots"] = result["dots"]
        session["params"] = req.params.model_dump()

        return {
            "session_id": req.session_id,
            "dots": result["dots"],
            "dot_count": len(result["dots"]),
            "image_width": result["image_width"],
            "image_height": result["image_height"],
        }

    except Exception as e:
        logger.exception("Regeneration failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dots/update")
async def update_dots(req: DotEditRequest):
    """Save edited dot positions from the frontend editor."""
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session["dots"] = req.dots
    return {"status": "ok", "dot_count": len(req.dots)}


@app.post("/api/export")
async def export_pattern(req: ExportRequest):
    """Export the dot pattern as SVG / PNG / JPG."""
    session = sessions.get(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    dots = req.dots if req.dots else session["dots"]
    fmt = req.format.lower()

    # For PNG export, use transparent background (no bg rect)
    bg = "none" if fmt == "png" else "#111111"
    svg_string = dots_to_svg_string(dots, req.width, req.height, bg_color=bg, dot_shape=req.dot_shape)

    if fmt == "svg":
        return StreamingResponse(
            io.BytesIO(svg_string.encode("utf-8")),
            media_type="image/svg+xml",
            headers={"Content-Disposition": "attachment; filename=rhinestone.svg"},
        )
    elif fmt == "png":
        png_bytes = svg_to_png(svg_string)
        return StreamingResponse(
            io.BytesIO(png_bytes),
            media_type="image/png",
            headers={"Content-Disposition": "attachment; filename=rhinestone.png"},
        )
    elif fmt == "jpg":
        jpg_bytes = svg_to_jpg(svg_string)
        return StreamingResponse(
            io.BytesIO(jpg_bytes),
            media_type="image/jpeg",
            headers={"Content-Disposition": "attachment; filename=rhinestone.jpg"},
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported format. Use svg, png, or jpg.")
