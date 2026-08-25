#!/usr/bin/env python3
"""Render orthographic previews of a mesh to a PNG, with no GPU or GL context.

Generated meshes have to be eyeballed before they can be cut into parts, and
trimesh's own viewer needs a live OpenGL context that a headless/CLI session
does not have. This samples the surface and splats the points into a depth
buffer instead - crude, but enough to read orientation, silhouette and where
the mechanical joints are.

  python tools/preview_mesh.py --input mesh.glb --out preview.png
  python tools/preview_mesh.py --input mesh.glb --out p.png --grid 0.1
"""

import argparse
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw

from turret_assemble import load_single_mesh

# (name, horizontal axis, vertical axis, depth axis, flip_h, flip_v, depth_sign)
VIEWS = [
    ("front  +Z", 0, 1, 2, False, True, +1),
    ("right  +X", 2, 1, 0, True, True, +1),
    ("top    +Y", 0, 2, 1, False, False, +1),
]


def render(points, res, h_ax, v_ax, d_ax, flip_h, flip_v, d_sign, lo, hi):
    span = float(np.max(hi - lo)) or 1.0
    centre = (lo + hi) / 2.0
    pad = 0.06

    def to_px(vals, ax):
        n = (vals - centre[ax]) / span + 0.5
        return np.clip((n * (1 - 2 * pad) + pad) * (res - 1), 0, res - 1)

    x = to_px(points[:, h_ax], h_ax)
    y = to_px(points[:, v_ax], v_ax)
    if flip_h:
        x = res - 1 - x
    if flip_v:
        y = res - 1 - y
    depth = points[:, d_ax] * d_sign

    buf = np.full((res, res), np.inf)
    np.minimum.at(buf, (y.astype(int), x.astype(int)), -depth)

    hit = np.isfinite(buf)
    img = np.zeros((res, res), np.uint8)
    if hit.any():
        d = buf[hit]
        norm = (d - d.min()) / ((d.max() - d.min()) or 1.0)
        img[hit] = (40 + (1.0 - norm) * 215).astype(np.uint8)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", type=int, default=420)
    ap.add_argument("--samples", type=int, default=400000)
    ap.add_argument("--grid", type=float, default=None,
                    help="draw gridlines every N mesh units, with labels")
    a = ap.parse_args()

    mesh = load_single_mesh(a.input)
    lo, hi = mesh.bounds
    print(f"{len(mesh.faces)} faces  bounds {np.round(lo,3)} .. {np.round(hi,3)}")

    pts, _ = trimesh.sample.sample_surface(mesh, a.samples)
    pts = np.asarray(pts)

    res = a.res
    sheet = Image.new("RGB", (res * len(VIEWS), res + 22), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    span = float(np.max(hi - lo)) or 1.0
    centre = (lo + hi) / 2.0
    pad = 0.06

    for i, (name, h_ax, v_ax, d_ax, fh, fv, ds) in enumerate(VIEWS):
        g = render(pts, res, h_ax, v_ax, d_ax, fh, fv, ds, lo, hi)
        tile = Image.fromarray(np.dstack([g, g, g]))
        ox = i * res

        if a.grid:
            td = ImageDraw.Draw(tile)
            for ax, is_h in ((h_ax, True), (v_ax, False)):
                start = np.ceil(lo[ax] / a.grid) * a.grid
                for t in np.arange(start, hi[ax] + 1e-9, a.grid):
                    n = (t - centre[ax]) / span + 0.5
                    p = (n * (1 - 2 * pad) + pad) * (res - 1)
                    if (is_h and fh) or (not is_h and fv):
                        p = res - 1 - p
                    col = (90, 30, 30) if abs(t) < 1e-9 else (45, 45, 55)
                    if is_h:
                        td.line([(p, 0), (p, res)], fill=col)
                        td.text((p + 2, res - 12), f"{t:+.1f}", fill=(150, 150, 90))
                    else:
                        td.line([(0, p), (res, p)], fill=col)
                        td.text((2, p + 1), f"{t:+.1f}", fill=(150, 150, 90))

        sheet.paste(tile, (ox, 22))
        draw.text((ox + 6, 6), f"{name}   (h={'xyz'[h_ax]}, v={'xyz'[v_ax]})",
                  fill=(230, 230, 120))

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(a.out)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
