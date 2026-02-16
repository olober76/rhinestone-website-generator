"""
SVG generation from dot data.
Supports circle, diamond, star, hexagon shapes.
"""

import math
from typing import List, Dict


def _star_points(cx: float, cy: float, r: float) -> str:
    """5-pointed star polygon points."""
    outer, inner = r, r * 0.4
    pts = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        rad = outer if i % 2 == 0 else inner
        pts.append(f"{cx + rad * math.cos(angle):.2f},{cy + rad * math.sin(angle):.2f}")
    return " ".join(pts)


def _hex_points(cx: float, cy: float, r: float) -> str:
    """Regular hexagon polygon points."""
    pts = []
    for i in range(6):
        angle = -math.pi / 2 + i * math.pi / 3
        pts.append(f"{cx + r * math.cos(angle):.2f},{cy + r * math.sin(angle):.2f}")
    return " ".join(pts)


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
        elif shape == "star":
            lines.append(f'  <polygon points="{_star_points(cx, cy, r)}" fill="{color}"/>')
        elif shape == "hexagon":
            lines.append(f'  <polygon points="{_hex_points(cx, cy, r)}" fill="{color}"/>')
        else:
            lines.append(f'  <circle cx="{cx}" cy="{cy}" r="{r}" fill="{color}"/>')
    lines.append("</svg>")
    return "\n".join(lines)


def generate_svg(dots: List[Dict], width: int, height: int) -> bytes:
    """Return SVG as bytes."""
    return dots_to_svg_string(dots, width, height).encode("utf-8")
