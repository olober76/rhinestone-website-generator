"""
Export helpers: SVG → PNG / JPG conversion.
"""

import io
from PIL import Image

# cairosvg requires libcairo (a C library) to be installed on the system.
# On macOS: brew install cairo
# On Linux: apt install libcairo2
# We import lazily so the bridge can still start even if cairo is missing,
# and return a helpful error only when PNG/JPG export is actually attempted.
try:
    import cairosvg as _cairosvg
    _CAIRO_AVAILABLE = True
    _CAIRO_ERROR = None
except Exception as e:
    _cairosvg = None
    _CAIRO_AVAILABLE = False
    _CAIRO_ERROR = (
        f"cairosvg import failed: {e}\n"
        "PNG/JPG export requires libcairo.\n"
        "  macOS:  brew install cairo\n"
        "  Linux:  sudo apt install libcairo2\n"
        "Use SVG export instead (no native library needed)."
    )


def svg_to_png(svg_string: str, scale: float = 2.0) -> bytes:
    """Convert SVG string to PNG bytes using CairoSVG."""
    if not _CAIRO_AVAILABLE:
        raise RuntimeError(_CAIRO_ERROR)
    return _cairosvg.svg2png(bytestring=svg_string.encode("utf-8"), scale=scale)


def svg_to_jpg(svg_string: str, scale: float = 2.0, quality: int = 92) -> bytes:
    """Convert SVG → PNG → JPG."""
    png_bytes = svg_to_png(svg_string, scale=scale)
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
