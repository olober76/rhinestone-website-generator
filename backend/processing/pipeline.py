"""
Full image-processing pipeline:
  raw bytes → preprocessed → foreground mask → density map → dots

KEY DESIGN PRINCIPLE:
  Dots are placed ONLY inside the detected shape (foreground).
  The background is kept completely clean.
  Contour-following dots line the edges of the shape.
  Interior fill uses density-aware Poisson or grid sampling.
"""

import cv2
import numpy as np
import logging
import random
import time

from .dot_placement import (
    place_dots_poisson,
    place_dots_grid,
    place_dots_contour_outline,
    remove_overlaps_spatial,
)


def _bytes_to_cv2(raw: bytes) -> np.ndarray:
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image")
    return img


def _detect_foreground(gray: np.ndarray, invert: bool = False) -> np.ndarray:
    """
    Produce a clean binary mask:  255 = shape (foreground),  0 = background.
    Works for logos on white / light backgrounds AND dark backgrounds.
    """
    # Use Otsu's method for optimal threshold
    _, otsu_mask = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )

    mean_val = np.mean(gray)

    if mean_val > 128:
        # Light background → dark areas are the shape → invert
        mask = 255 - otsu_mask
    else:
        # Dark background → bright areas are the shape
        mask = otsu_mask

    # User override
    if invert:
        mask = 255 - mask

    # Morphology cleanup: remove small noise, fill small holes
    k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k_med   = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  k_small, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_med,   iterations=2)

    return mask


def _build_density_map(
    gray: np.ndarray,
    mask: np.ndarray,
    edge_strength: float,
    contrast: float,
) -> np.ndarray:
    """
    Build a density map WITHIN the foreground mask only.
    Higher value (0–255) ⇒ denser / larger dots.

    The density map now drives REAL variation in dot size to represent
    shadow (large dots) and highlight (small dots) like classic halftone.
    """
    enhanced = gray.copy().astype(np.float32)

    # Contrast: apply S-curve for more dramatic effect
    if contrast != 1.0:
        # Normalize to 0-1
        norm = enhanced / 255.0
        # S-curve: stronger contrast pushes midtones toward extremes
        # Using power curve centered at 0.5
        midpoint = 0.5
        if contrast > 1.0:
            # Increase contrast: steeper curve
            gamma = 1.0 / contrast
            norm = np.where(
                norm < midpoint,
                midpoint * (norm / midpoint) ** gamma,
                1.0 - (1.0 - midpoint) * ((1.0 - norm) / (1.0 - midpoint)) ** gamma,
            )
        else:
            # Decrease contrast: flatten curve
            gamma = contrast
            norm = midpoint + (norm - midpoint) * gamma
        enhanced = np.clip(norm * 255.0, 0, 255).astype(np.float32)

    # Brightness → density: dark = high density, light = low density
    # This is the key halftone principle
    brightness = (255.0 - enhanced) / 255.0  # 0=light, 1=dark

    # Apply CLAHE-like local enhancement to bring out shadow/highlight detail
    brightness = np.clip(brightness, 0, 1)

    # Edge proximity from Canny + mask boundary
    edges      = cv2.Canny(enhanced.astype(np.uint8), 30, 120)
    mask_edges = cv2.Canny(mask, 30, 120)
    all_edges  = cv2.bitwise_or(edges, mask_edges)

    dist = cv2.distanceTransform(255 - all_edges, cv2.DIST_L2, 5)
    max_dist = dist.max() + 1e-6
    dist = dist / max_dist
    edge_proximity = 1.0 - dist  # 1 at edges, 0 far away

    # Boost edge proximity so it has more effect
    edge_proximity = np.power(edge_proximity, 0.6)  # push values up near edges

    # Blend brightness and edge proximity
    density = brightness * (1.0 - edge_strength) + edge_proximity * edge_strength

    # Stretch result to use full 0-255 range within the mask (maximize dynamic range)
    mask_pixels = density[mask > 127]
    if len(mask_pixels) > 0:
        lo, hi = np.percentile(mask_pixels, [2, 98])
        if hi - lo > 0.01:
            density = (density - lo) / (hi - lo)
            density = np.clip(density, 0, 1)

    density_u8 = (density * 255).astype(np.uint8)

    # Zero out everything outside the mask
    density_u8[mask == 0] = 0
    return density_u8


# -----------------------------------------------------------------------
# public entry point
# -----------------------------------------------------------------------

def process_image(raw: bytes, params) -> dict:
    """
    Returns {'dots': [{x, y, r}, …], 'image_width': …, 'image_height': …}
    """
    logger = logging.getLogger(__name__)
    t0 = time.time()

    img = _bytes_to_cv2(raw)
    orig_h, orig_w = img.shape[:2]
    logger.info(f"Image decoded: {orig_w}x{orig_h}")

    # Fit into canvas keeping aspect ratio
    cw, ch = params.canvas_width, params.canvas_height
    scale  = min(cw / orig_w, ch / orig_h)
    new_w, new_h = int(orig_w * scale), int(orig_h * scale)
    img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    mask    = _detect_foreground(gray, invert=params.invert)
    fg_pct = cv2.countNonZero(mask) / (new_w * new_h) * 100
    logger.info(f"Foreground mask: {fg_pct:.1f}% of image, resized to {new_w}x{new_h}")

    density = _build_density_map(gray, mask, params.edge_strength, params.contrast)
    logger.info(f"Density map built in {time.time() - t0:.2f}s")

    method = params.method.lower()
    t1 = time.time()

    if method == "grid":
        dots = place_dots_grid(mask, density, params)
    elif method == "contour":
        dots = place_dots_contour_outline(mask, density, params)
    else:  # "poisson" (default & best)
        dots = place_dots_poisson(mask, density, params)

    logger.info(f"Dot placement ({method}): {len(dots)} dots in {time.time() - t1:.2f}s")

    # Add crisp contour-edge dots on top
    if params.use_contour_follow and method != "contour":
        t2 = time.time()
        edge_dots = place_dots_contour_outline(mask, density, params)
        dots = _merge_dots(edge_dots, dots, min_dist=params.min_spacing * 0.65)
        logger.info(f"Contour merge: {len(dots)} total dots in {time.time() - t2:.2f}s")

    # Assign random shapes when dot_shape == "random"
    dot_shape = getattr(params, 'dot_shape', 'circle')
    if dot_shape == "random":
        shape_choices = ["circle", "star", "diamond", "hexagon"]
        for d in dots:
            d["shape"] = random.choice(shape_choices)

    logger.info(f"Total processing: {len(dots)} dots in {time.time() - t0:.2f}s")

    return {
        "dots": dots,
        "image_width": new_w,
        "image_height": new_h,
    }


def _merge_dots(priority: list, secondary: list, min_dist: float) -> list:
    """Keep all *priority* dots; add *secondary* only where not overlapping."""
    if not priority and not secondary:
        return []
    if not secondary:
        return priority
    if not priority:
        return secondary

    merged = list(priority)
    if not merged:
        return secondary

    coords = np.array([[d["x"], d["y"]] for d in merged])

    for d in secondary:
        pt = np.array([d["x"], d["y"]])
        dists = np.linalg.norm(coords - pt, axis=1)
        if dists.min() >= min_dist:
            merged.append(d)
            coords = np.vstack([coords, pt])

    return merged
