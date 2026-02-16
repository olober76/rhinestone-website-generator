"""
Dot-placement algorithms — MASK-AWARE edition.

Every algorithm receives:
  mask         – binary (255 = foreground, 0 = background)
  density_map  – 0-255 inside the shape (higher ⇒ denser/larger dots)
  params       – DotParams from the API

Dots are NEVER placed outside the mask.
"""

import math
import random
import time
from typing import List, Dict

import cv2
import numpy as np


# ======================================================================
# Helpers
# ======================================================================

def _rotate_points(pts: list, angle_deg: float, cx: float, cy: float) -> list:
    if angle_deg == 0:
        return pts
    rad = math.radians(angle_deg)
    c, s = math.cos(rad), math.sin(rad)
    out = []
    for p in pts:
        dx, dy = p["x"] - cx, p["y"] - cy
        out.append({
            "x": round(dx * c - dy * s + cx, 2),
            "y": round(dx * s + dy * c + cy, 2),
            "r": p["r"],
        })
    return out


def _in_mask(mask: np.ndarray, x: float, y: float) -> bool:
    h, w = mask.shape[:2]
    xi, yi = int(round(x)), int(round(y))
    if xi < 0 or xi >= w or yi < 0 or yi >= h:
        return False
    return mask[yi, xi] > 127


def _density_at(density_map: np.ndarray, x: float, y: float) -> float:
    h, w = density_map.shape[:2]
    xi = max(0, min(int(x), w - 1))
    yi = max(0, min(int(y), h - 1))
    return density_map[yi, xi] / 255.0


def remove_overlaps_spatial(dots: list, min_dist: float) -> list:
    """Fast-ish greedy overlap removal using a grid index."""
    if len(dots) < 2:
        return dots

    # Build spatial grid for O(1) neighbour lookup
    cell = max(min_dist, 1.0)
    grid: dict = {}

    def _key(x, y):
        return (int(x // cell), int(y // cell))

    kept: list = []
    for d in dots:
        kx, ky = _key(d["x"], d["y"])
        too_close = False
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                for other in grid.get((kx + dx, ky + dy), []):
                    ddx = d["x"] - other["x"]
                    ddy = d["y"] - other["y"]
                    if ddx * ddx + ddy * ddy < min_dist * min_dist:
                        too_close = True
                        break
                if too_close:
                    break
            if too_close:
                break
        if not too_close:
            kept.append(d)
            grid.setdefault((kx, ky), []).append(d)

    return kept


# ======================================================================
# Helpers — size & spacing from density
# ======================================================================

def _dot_radius(base_r: float, density: float, dens_mult: float, sizing_mode: str = "variable") -> float:
    """
    Compute dot radius from density value (0..1).
    If sizing_mode == "uniform", always returns base_r.
    If sizing_mode == "variable":
      Shadow/dark areas (density ~1.0) → large dots.
      Highlight/light areas (density ~0.0) → small or no dots.
    """
    if sizing_mode == "uniform":
        return round(base_r, 2)

    min_factor = 0.2
    max_factor = 1.0 + dens_mult * 0.8  # density slider controls max size
    max_factor = min(max_factor, 2.5)

    factor = min_factor + density * (max_factor - min_factor)
    return round(max(base_r * 0.15, base_r * factor), 2)


def _local_spacing(base_spacing: float, density: float, dens_mult: float) -> float:
    """
    Compute local spacing from density. Dense/dark areas → tighter spacing.
    """
    factor = 2.0 - density * 1.2 * min(dens_mult, 2.0)
    factor = max(0.5, min(factor, 2.5))
    return base_spacing * factor


# ======================================================================
# 1. Poisson Disk Sampling — mask-aware
# ======================================================================

def place_dots_poisson(
    mask: np.ndarray,
    density_map: np.ndarray,
    params,
) -> List[Dict]:
    """
    Density-aware Poisson-disk sampling.
    Dots are ONLY placed where mask == 255.
    Spacing adapts: denser regions ⇒ tighter packing.
    """
    h, w = mask.shape[:2]
    base_r      = params.dot_radius
    min_spacing = params.min_spacing
    dens_mult   = params.density
    sizing_mode = getattr(params, 'sizing_mode', 'variable')
    k = 20  # candidates per active point

    # Use minimum possible spacing for the grid cell size
    min_possible_sp = min_spacing * 0.5
    cell_size = min_possible_sp / math.sqrt(2)
    gw = math.ceil(w / cell_size)
    gh = math.ceil(h / cell_size)
    grid = [None] * (gw * gh)

    dots: List[Dict] = []
    active: list = []

    MAX_DOTS = 15000  # safety limit
    TIME_LIMIT = 30.0  # seconds
    start_time = time.time()

    def _gi(px, py):
        return int(py / cell_size) * gw + int(px / cell_size)

    def _add(px, py, pr):
        idx = _gi(px, py)
        if 0 <= idx < len(grid):
            grid[idx] = len(dots)
        d = {"x": round(px, 2), "y": round(py, 2), "r": round(pr, 2)}
        dots.append(d)
        active.append(d)

    # --- seed: pick random foreground pixel ---
    fg_ys, fg_xs = np.where(mask > 127)
    if len(fg_ys) == 0:
        return []
    seed_idx = random.randint(0, len(fg_ys) - 1)
    sx, sy = float(fg_xs[seed_idx]), float(fg_ys[seed_idx])
    _add(sx, sy, base_r)

    while active:
        if len(dots) >= MAX_DOTS or (time.time() - start_time) > TIME_LIMIT:
            break

        ai = random.randint(0, len(active) - 1)
        pt = active[ai]
        found = False

        loc_d = _density_at(density_map, pt["x"], pt["y"])
        loc_sp = _local_spacing(min_spacing, loc_d, dens_mult)

        for _ in range(k):
            angle = random.uniform(0, 2 * math.pi)
            dist  = random.uniform(loc_sp, loc_sp * 2)
            nx = pt["x"] + dist * math.cos(angle)
            ny = pt["y"] + dist * math.sin(angle)

            # *** CRITICAL: must be inside the mask ***
            if not _in_mask(mask, nx, ny):
                continue

            d = _density_at(density_map, nx, ny)

            # Neighbour collision check
            gi_x, gi_y = int(nx / cell_size), int(ny / cell_size)
            too_close = False
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    ni, nj = gi_x + dx, gi_y + dy
                    if 0 <= ni < gw and 0 <= nj < gh:
                        cell = grid[nj * gw + ni]
                        if cell is not None:
                            o = dots[cell]
                            ddx = nx - o["x"]
                            ddy = ny - o["y"]
                            if ddx * ddx + ddy * ddy < loc_sp * loc_sp:
                                too_close = True
                                break
                    if too_close:
                        break
                if too_close:
                    break

            if not too_close:
                r = _dot_radius(base_r, d, dens_mult, sizing_mode)
                _add(nx, ny, r)
                found = True
                break

        if not found:
            active.pop(ai)

    if params.rotation != 0:
        dots = _rotate_points(dots, params.rotation, w / 2, h / 2)

    return dots


# ======================================================================
# 2. Grid Sampling — mask-aware
# ======================================================================

def place_dots_grid(
    mask: np.ndarray,
    density_map: np.ndarray,
    params,
) -> List[Dict]:
    """
    Uniform grid — only inside mask.  Size modulated by density.
    """
    h, w  = mask.shape[:2]
    base_r   = params.dot_radius
    spacing  = params.min_spacing
    dens_mult = params.density
    sizing_mode = getattr(params, 'sizing_mode', 'variable')

    dots: List[Dict] = []
    y = spacing / 2
    row = 0
    while y < h:
        # Hex-offset: even rows shifted half-spacing for organic feel
        x_off = (spacing / 2) if row % 2 == 0 else 0
        x = x_off + spacing / 2
        while x < w:
            if _in_mask(mask, x, y):
                d = _density_at(density_map, x, y)
                r = _dot_radius(base_r, d, dens_mult, sizing_mode)
                dots.append({
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "r": round(r, 2),
                })
            x += spacing
        y += spacing
        row += 1

    if params.rotation != 0:
        dots = _rotate_points(dots, params.rotation, w / 2, h / 2)

    return dots


# ======================================================================
# 3. Contour-Outline Placement — the fashion/rhinestone key feature
# ======================================================================

def place_dots_contour_outline(
    mask: np.ndarray,
    density_map: np.ndarray,
    params,
) -> List[Dict]:
    """
    Walk the contours of the mask and place dots at even intervals.
    This gives the crisp rhinestone-outline look.

    Uses multiple erosion levels to create concentric rings of contour dots
    (like real rhinestone patterns on clothing).
    """
    h, w     = mask.shape[:2]
    base_r   = params.dot_radius
    spacing  = params.min_spacing
    dens_mult = params.density
    sizing_mode = getattr(params, 'sizing_mode', 'variable')

    dots: List[Dict] = []

    # Generate concentric contour rings via progressive erosion
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    erosion_step = max(2, int(spacing * 0.6))
    current_mask = mask.copy()

    max_rings = 80  # safety limit
    ring = 0
    MAX_DOTS = 15000
    start_time = time.time()

    while ring < max_rings:
        if len(dots) >= MAX_DOTS or (time.time() - start_time) > 20.0:
            break
        # Check there's still shape left
        if cv2.countNonZero(current_mask) < 10:
            break

        contours, _ = cv2.findContours(
            current_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE
        )

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 15:
                continue

            peri = cv2.arcLength(contour, True)
            if peri < spacing * 0.8:
                continue

            # Walk the contour placing dots at uniform spacing
            accum = 0.0
            n = len(contour)
            for i in range(n):
                p0 = contour[i][0]
                p1 = contour[(i + 1) % n][0]
                seg = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
                accum += seg

                if accum >= spacing:
                    px, py = float(p1[0]), float(p1[1])
                    d = _density_at(density_map, px, py)
                    r = _dot_radius(base_r, d, dens_mult, sizing_mode)

                    dots.append({
                        "x": round(px, 2),
                        "y": round(py, 2),
                        "r": round(r, 2),
                    })
                    accum = 0.0

        # Erode for next ring
        current_mask = cv2.erode(current_mask, kernel, iterations=erosion_step)
        ring += 1

    # Remove overlaps globally
    dots = remove_overlaps_spatial(dots, spacing * 0.55)

    if params.rotation != 0:
        dots = _rotate_points(dots, params.rotation, w / 2, h / 2)

    return dots
