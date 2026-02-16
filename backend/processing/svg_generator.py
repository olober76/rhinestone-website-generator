"""
SVG generation from dot data.
Supports circle and diamond shapes.
"""

from typing import List, Dict


def dots_to_svg_string(dots: List[Dict], width: int, height: int, bg_color: str = "#111111", dot_shape: str = "circle") -> str:
    """Build an SVG string from dot list."""
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'  <rect width="{width}" height="{height}" fill="{bg_color}"/>',
    ]
    for d in dots:
        cx = d.get("x", 0)
        cy = d.get("y", 0)
        r = d.get("r", 3)
        color = d.get("color", "#CCCCCC")
        shape = d.get("shape", dot_shape)

        if shape == "diamond":
            points = f"{cx},{cy - r} {cx + r},{cy} {cx},{cy + r} {cx - r},{cy}"
            lines.append(f'  <polygon points="{points}" fill="{color}"/>')
        else:
            lines.append(f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>')
    lines.append("</svg>")
    return "\n".join(lines)


def generate_svg(dots: List[Dict], width: int, height: int) -> bytes:
    """Return SVG as bytes."""
    return dots_to_svg_string(dots, width, height).encode("utf-8")
