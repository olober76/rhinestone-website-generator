"""
Export helpers: SVG → PNG / JPG conversion.
"""

import io
import cairosvg
from PIL import Image


def svg_to_png(svg_string: str, scale: float = 2.0) -> bytes:
    """Convert SVG string to PNG bytes using CairoSVG."""
    return cairosvg.svg2png(bytestring=svg_string.encode("utf-8"), scale=scale)


def svg_to_jpg(svg_string: str, scale: float = 2.0, quality: int = 92) -> bytes:
    """Convert SVG → PNG → JPG."""
    png_bytes = svg_to_png(svg_string, scale=scale)
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
