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


def square_pad(crop: Image.Image, fill) -> Image.Image:
    side = int(max(crop.size) * MARGIN)
    out = Image.new("RGB", (side, side), fill)
    out.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", default="assets/reference")
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
        q.save(whole / f"{view}.png")
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
            img.save(d / f"{view}.png")
        print(f"views_turret_{part}: {len(boxes)} views")


if __name__ == "__main__":
    main()
