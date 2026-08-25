#!/usr/bin/env python3
"""Turn P3-SAM's native segmentation into Base / Head / Gun.

P3-SAM returns per-face segment ids for a *cleaned* copy of the mesh, so the
labels do not line up with the textured mesh face-for-face. This transfers them
by nearest-face-centroid lookup, which is exact enough at these face counts and
keeps the textured mesh (and its UVs) completely untouched.

P3-SAM finds mechanical parts, not the three groups a turret needs to animate,
so its segments are then merged. `--list` prints every segment with its extent
so you can decide; without an explicit `--assign`, segments are grouped
geometrically (below the turntable -> Base, forward of the mantlet and near the
barrel axis -> Gun, rest -> Head).

  python tools/apply_p3sam_parts.py --mesh full/mesh_textured.glb \\
      --seg-mesh p3sam/mesh_segmented_source.glb \\
      --face-ids p3sam/mesh_face_ids.npy --list

  python tools/apply_p3sam_parts.py ... --out-dir out/b_p3sam \\
      --base-top -0.10 --gun-front 0.12 --assign "Base=0,4,7;Head=1,2,5;Gun=3"
"""

import argparse
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

from turret_assemble import AXIS, PART_ORDER, describe, finish_parts, load_single_mesh


def transfer_labels(target_mesh, seg_mesh, face_ids):
    """Nearest-face-centroid label transfer from seg_mesh onto target_mesh."""
    if len(face_ids) != len(seg_mesh.faces):
        raise SystemExit(
            f"face_ids ({len(face_ids)}) does not match seg mesh "
            f"({len(seg_mesh.faces)} faces) - wrong pair of files?"
        )
    tree = cKDTree(seg_mesh.triangles_center)
    dist, idx = tree.query(target_mesh.triangles_center, k=1)
    labels = np.asarray(face_ids)[idx]
    scale = float(np.linalg.norm(target_mesh.extents))
    print(f"[transfer] median offset {np.median(dist) / scale:.4f} of diagonal, "
          f"max {dist.max() / scale:.4f}")
    return labels


def segment_table(mesh, labels):
    rows = []
    for sid in sorted(np.unique(labels)):
        m = labels == sid
        sub = mesh.triangles_center[m]
        lo, hi = sub.min(0), sub.max(0)
        rows.append({
            "id": int(sid), "faces": int(m.sum()), "frac": float(m.mean()),
            "centre": (lo + hi) / 2, "extent": hi - lo, "lo": lo, "hi": hi,
        })
    return rows


def auto_assign(rows, up, fwd, fwd_sign, base_top, gun_front, gun_radius, mesh):
    """Group segments by where their centre sits relative to the joint planes."""
    assign = {}
    others = [i for i in range(3) if i != fwd]
    axis_centre = np.array([mesh.centroid[others[0]], mesh.centroid[others[1]]])
    for r in rows:
        c = r["centre"]
        if c[up] < base_top:
            assign[r["id"]] = "Base"
            continue
        along = c[fwd] * fwd_sign
        radial = np.linalg.norm(c[others] - axis_centre)
        if along > gun_front and (gun_radius is None or radial < gun_radius):
            assign[r["id"]] = "Gun"
        else:
            assign[r["id"]] = "Head"
    return assign


def parse_assign(spec):
    out = {}
    for chunk in spec.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        part, ids = chunk.split("=")
        part = part.strip().capitalize()
        if part not in PART_ORDER:
            raise SystemExit(f"unknown part {part!r}; expected one of {PART_ORDER}")
        for i in ids.split(","):
            if i.strip():
                out[int(i)] = part
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True, help="textured mesh to actually cut")
    ap.add_argument("--seg-mesh", required=True, help="mesh P3-SAM labelled")
    ap.add_argument("--face-ids", required=True, help="mesh_face_ids.npy")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--name", default="Turret")
    ap.add_argument("--up", default="y", choices=list(AXIS))
    ap.add_argument("--forward", default="+z")
    ap.add_argument("--base-top", type=float, default=None)
    ap.add_argument("--gun-front", type=float, default=None)
    ap.add_argument("--gun-radius", type=float, default=None)
    ap.add_argument("--assign", default=None,
                    help='explicit grouping, e.g. "Base=0,4;Head=1,2;Gun=3"')
    ap.add_argument("--list", action="store_true",
                    help="print the segment table and exit")
    a = ap.parse_args()

    mesh = load_single_mesh(a.mesh)
    seg_mesh = load_single_mesh(a.seg_mesh)
    face_ids = np.load(a.face_ids)
    describe(mesh, "textured")
    describe(seg_mesh, "segmented")

    labels = transfer_labels(mesh, seg_mesh, face_ids)
    rows = segment_table(mesh, labels)

    up = AXIS[a.up]
    fwd_sign = -1.0 if a.forward.startswith("-") else 1.0
    fwd = AXIS[a.forward[-1]]

    print(f"\n{len(rows)} segments (axes: up={a.up}, forward={a.forward})")
    print(f"{'id':>4} {'faces':>7} {'%':>6}   centre (x,y,z)          extent (x,y,z)")
    for r in rows:
        print(f"{r['id']:>4} {r['faces']:>7} {r['frac']:>5.1%}   "
              f"{np.round(r['centre'], 3)}   {np.round(r['extent'], 3)}")

    if a.list or a.out_dir is None:
        print("\nRe-run with --out-dir (and --base-top/--gun-front, or --assign) "
              "to export.")
        return

    if a.assign:
        mapping = parse_assign(a.assign)
        missing = [r["id"] for r in rows if r["id"] not in mapping]
        if missing:
            raise SystemExit(f"segments not assigned to any part: {missing}")
    else:
        if a.base_top is None or a.gun_front is None:
            raise SystemExit("need --assign, or both --base-top and --gun-front")
        mapping = auto_assign(rows, up, fwd, fwd_sign, a.base_top, a.gun_front,
                              a.gun_radius, mesh)
        print("\nauto grouping:")
        for part in PART_ORDER:
            ids = sorted(k for k, v in mapping.items() if v == part)
            print(f"  {part:<5} <- segments {ids}")

    masks = {p: np.zeros(len(mesh.faces), dtype=bool) for p in PART_ORDER}
    for sid, part in mapping.items():
        masks[part] |= labels == sid
    for part in PART_ORDER:
        if not masks[part].any():
            raise SystemExit(f"{part} ended up empty - adjust --assign")

    # Fall back to the mesh's own mid-planes when only --assign was given, so
    # pivots still land somewhere sane.
    base_top = a.base_top if a.base_top is not None else float(
        mesh.triangles_center[masks["Base"]][:, up].max())
    gun_front = a.gun_front if a.gun_front is not None else float(
        (mesh.triangles_center[masks["Gun"]][:, fwd] * fwd_sign).min())

    finish_parts(mesh, masks, Path(a.out_dir), a.name, up, fwd, fwd_sign,
                 base_top, gun_front,
                 meta_extra={"method": "p3sam",
                             "segments": {str(k): v for k, v in sorted(mapping.items())}})


if __name__ == "__main__":
    main()
