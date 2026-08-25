#!/usr/bin/env python3
"""Cut the turret concept sheet into per-component view sets.

The source is a 2x2 sheet of the same turret from four camera angles:

    TL  front (gun toward camera)      TR  back
    BL  left  (gun toward screen-left) BR  right (gun toward screen-right)

Approach A/B (one generation, then split) uses the whole quadrants.
Approach C (three generations) needs each component isolated, so every
quadrant is cropped down to just the base / just the housing / just the barrel
cluster. Boxes below are in quadrant-local pixels, measured off the 1254x1254
source; they are stored as fractions so a differently-sized sheet still works.

  python tools/make_turret_views.py --input <sheet.png> --out assets/reference
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

QUADRANTS = {"front": (0, 0), "back": (1, 0), "left": (0, 1), "right": (1, 1)}

# quadrant-local pixel boxes (x0, y0, x1, y1) on a 627px quadrant
PARTS_PX = {
    "base": {
        "front": (55, 338, 595, 600),
        "back": (5, 350, 550, 600),
        "left": (40, 300, 590, 538),
        "right": (10, 300, 585, 538),
    },
    "head": {
        "front": (185, 92, 495, 302),
        "back": (215, 102, 485, 302),
        "left": (268, 62, 582, 258),
        "right": (38, 62, 368, 258),
    },
    "gun": {
        "front": (276, 162, 414, 300),
        "left": (30, 96, 305, 224),
        "right": (340, 116, 604, 212),
    },
}

# The gun's head-on view is a disc set into the mantlet plate; a rectangular
# crop would hand rembg the plate as well. Mask everything outside the muzzle
# circle so the view is unambiguously "barrel cluster, seen down the axis".
CIRCLE_MASK_PX = {("gun", "front"): (345, 228, 62)}  # cx, cy, r

QUAD_PX = 627.0
MARGIN = 1.12  # square-pad factor, keeps a little air around the subject


def bg_color(img: Image.Image):
    return img.getpixel((2, 2))


def cut_background(img: Image.Image, tol=34) -> Image.Image:
    """Flat studio background -> transparency, by flood fill from the borders.

    The generator runs rembg/u2net on any RGB input, which costs ~7 CPU-minutes
    per view set and is pure waste here: the sheet is already matted on a
    uniform grey. Feeding it RGBA with real alpha skips that entirely.

    Border flood fill rather than a global colour key, because the turret has
    near-black recesses that a global key would punch holes through - only
    background connected to the edge is removed.
    """
    import numpy as np
    from collections import deque

    rgb = np.asarray(img.convert("RGB")).astype(np.int16)
    h, w = rgb.shape[:2]
    bg = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]),
                   axis=0)
    close = (np.abs(rgb - bg).sum(2) <= tol)

    # BFS from every border pixel that matches the background
    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    out = img.convert("RGBA")
    alpha = np.asarray(out)[:, :, 3].copy()
    alpha[seen] = 0
    arr = np.asarray(out).copy()
    arr[:, :, 3] = alpha
    return Image.fromarray(arr, "RGBA")


def square_pad(crop: Image.Image, fill) -> Image.Image:
    side = int(max(crop.size) * MARGIN)
    out = Image.new("RGB", (side, side), fill)
    out.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="assets/reference")
    ap.add_argument("--keep-background", action="store_true",
                    help="emit RGB and let the generator run rembg instead")
    a = ap.parse_args()

    src = Image.open(a.input).convert("RGB")
    W, H = src.size
    qw, qh = W // 2, H // 2
    fill = bg_color(src)
    out_root = Path(a.out)

    # ---- whole-turret views (approach A/B)
    whole = out_root / "views_turret"
    whole.mkdir(parents=True, exist_ok=True)
    quads = {}
    for view, (cx, cy) in QUADRANTS.items():
        q = src.crop((cx * qw, cy * qh, (cx + 1) * qw, (cy + 1) * qh))
        quads[view] = q
        (q if a.keep_background else cut_background(q)).save(whole / f"{view}.png")
    print(f"views_turret: {len(quads)} views @ {qw}x{qh}")

    # ---- per-component views (approach C)
    sx, sy = qw / QUAD_PX, qh / QUAD_PX
    for part, boxes in PARTS_PX.items():
        d = out_root / f"views_turret_{part}"
        d.mkdir(parents=True, exist_ok=True)
        for view, (x0, y0, x1, y1) in boxes.items():
            q = quads[view]
            circ = CIRCLE_MASK_PX.get((part, view))
            if circ:
                cx, cy, r = circ[0] * sx, circ[1] * sy, circ[2] * min(sx, sy)
                masked = Image.new("RGB", q.size, fill)
                mask = Image.new("L", q.size, 0)
                ImageDraw.Draw(mask).ellipse(
                    (cx - r, cy - r, cx + r, cy + r), fill=255)
                masked.paste(q, (0, 0), mask)
                q = masked
            box = (int(x0 * sx), int(y0 * sy), int(x1 * sx), int(y1 * sy))
            img = square_pad(q.crop(box), fill)
            if not a.keep_background:
                img = cut_background(img)
            img.save(d / f"{view}.png")
        print(f"views_turret_{part}: {len(boxes)} views")


if __name__ == "__main__":
    main()
