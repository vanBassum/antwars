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


def sample_colours(mesh, face_idx, points):
    """Per-sample RGB from the mesh's texture, or None if it has no texture.

    Depth shading alone cannot show whether texturing worked, which is most of
    what there is to review on a generated asset.
    """
    vis = getattr(mesh, "visual", None)
    uv = getattr(vis, "uv", None)
    mat = getattr(vis, "material", None)
    img = getattr(mat, "baseColorTexture", None) if mat is not None else None
    if uv is None or img is None:
        return None
    try:
        tri = mesh.triangles[face_idx]
        bary = trimesh.triangles.points_to_barycentric(tri, points)
        face_uv = np.asarray(uv)[mesh.faces[face_idx]]          # (n, 3, 2)
        p_uv = (bary[:, :, None] * face_uv).sum(axis=1)         # (n, 2)
        tex = np.asarray(img.convert("RGB"))
        th, tw = tex.shape[:2]
        px = np.clip((p_uv[:, 0] % 1.0) * (tw - 1), 0, tw - 1).astype(int)
        py = np.clip((1.0 - (p_uv[:, 1] % 1.0)) * (th - 1), 0, th - 1).astype(int)
        return tex[py, px]
    except Exception as e:
        print(f"  (texture sampling failed: {e})")
        return None


def render(points, res, h_ax, v_ax, d_ax, flip_h, flip_v, d_sign, lo, hi,
           colours=None):
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

    yi, xi = y.astype(int), x.astype(int)
    buf = np.full((res, res), np.inf)
    np.minimum.at(buf, (yi, xi), -depth)
    hit = np.isfinite(buf)

    if colours is None:
        img = np.zeros((res, res), np.uint8)
        if hit.any():
            d = buf[hit]
            norm = (d - d.min()) / ((d.max() - d.min()) or 1.0)
            img[hit] = (40 + (1.0 - norm) * 215).astype(np.uint8)
        return np.dstack([img] * 3)

    # Keep the colour of whichever sample actually won the depth test, then
    # shade it by depth so the form still reads.
    out = np.zeros((res, res, 3), np.uint8)
    winner = np.isclose(buf[yi, xi], -depth)
    out[yi[winner], xi[winner]] = colours[winner]
    if hit.any():
        d = buf[hit]
        norm = (d - d.min()) / ((d.max() - d.min()) or 1.0)
        shade = (0.45 + 0.55 * (1.0 - norm))[:, None]
        out[hit] = np.clip(out[hit] * shade, 0, 255).astype(np.uint8)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", type=int, default=420)
    ap.add_argument("--samples", type=int, default=400000)
    ap.add_argument("--no-texture", action="store_true",
                    help="depth shading only, even if the mesh has a texture")
    ap.add_argument("--grid", type=float, default=None,
                    help="draw gridlines every N mesh units, with labels")
    a = ap.parse_args()

    mesh = load_single_mesh(a.input)
    lo, hi = mesh.bounds
    print(f"{len(mesh.faces)} faces  bounds {np.round(lo,3)} .. {np.round(hi,3)}")

    pts, fidx = trimesh.sample.sample_surface(mesh, a.samples)
    pts = np.asarray(pts)
    cols = None if a.no_texture else sample_colours(mesh, fidx, pts)
    print("textured preview" if cols is not None else "depth-shaded preview")

    res = a.res
    sheet = Image.new("RGB", (res * len(VIEWS), res + 22), (18, 18, 20))
    draw = ImageDraw.Draw(sheet)
    span = float(np.max(hi - lo)) or 1.0
    centre = (lo + hi) / 2.0
    pad = 0.06

    for i, (name, h_ax, v_ax, d_ax, fh, fv, ds) in enumerate(VIEWS):
        g = render(pts, res, h_ax, v_ax, d_ax, fh, fv, ds, lo, hi, colours=cols)
        tile = Image.fromarray(g)
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

# NOTE: this previewer reads UVs via trimesh, which does not honour
# KHR_mesh_quantization / KHR_texture_transform. A gltfpack output will render
# as one flat texel here even though it is correct in a real glTF viewer.
# Preview the pre-decimation file instead.
