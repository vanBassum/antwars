#!/usr/bin/env python3
"""Split a generated turret mesh into Base / Head / Gun with cut planes.

The generated mesh is one welded shell, so parts are separated at the turret's
real mechanical joints:

  Base : below the turntable ring        (up < base_top)
  Gun  : forward of the mantlet, inside a tube around the barrel axis
  Head : everything left over            (the rotating housing)

Faces are assigned whole, by centroid, so UVs and the texture survive
untouched. Seams sit inside the joints where the neighbouring part covers them.

  # 1. look at the geometry first
  python tools/split_turret_parts.py --input mesh_textured.glb --inspect

  # 2. cut
  python tools/split_turret_parts.py --input mesh_textured.glb \\
      --out-dir out/a_planes --base-top -0.10 --gun-front 0.12 --gun-radius 0.18
"""

import argparse
from pathlib import Path

import numpy as np

from turret_assemble import AXIS, describe, finish_parts, load_single_mesh


def profile(mesh, bins=20):
    """Face-count histogram along each axis - shows where the joints are."""
    c = mesh.triangles_center
    print(f"\n--- face distribution ({bins} slabs per axis) ---")
    for ax, nm in enumerate("xyz"):
        lo, hi = mesh.bounds[0][ax], mesh.bounds[1][ax]
        edges = np.linspace(lo, hi, bins + 1)
        counts, _ = np.histogram(c[:, ax], bins=edges)
        print(f"{nm}: " + "  ".join(f"{edges[i]:+.3f}:{counts[i]}"
                                    for i in range(bins)))


def split_masks(mesh, up, fwd, fwd_sign, base_top, gun_front,
                gun_radius=None, gun_axis_height=None):
    c = mesh.triangles_center
    base = c[:, up] < base_top
    gun = (~base) & (c[:, fwd] * fwd_sign > gun_front)

    if gun_radius is not None:
        # Keep the gun to a tube around the barrel axis, so side pods, the
        # ammo hose and the antenna stay with the head even where they reach
        # past the mantlet plane.
        others = [i for i in range(3) if i != fwd]
        h = gun_axis_height if gun_axis_height is not None else mesh.centroid[up]
        centre = np.array([h if others[0] == up else mesh.centroid[others[0]],
                           h if others[1] == up else mesh.centroid[others[1]]])
        gun &= np.linalg.norm(c[:, others] - centre, axis=1) < gun_radius

    return {"Base": base, "Head": ~(base | gun), "Gun": gun}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--name", default="Turret")
    ap.add_argument("--up", default="y", choices=list(AXIS))
    ap.add_argument("--forward", default="+z",
                    help="axis the gun points along, e.g. +z or -x")
    ap.add_argument("--base-top", type=float, default=None,
                    help="height of the turntable ring, in mesh units")
    ap.add_argument("--gun-front", type=float, default=None,
                    help="mantlet plane along forward")
    ap.add_argument("--gun-radius", type=float, default=None,
                    help="tube radius around the barrel axis")
    ap.add_argument("--gun-axis-height", type=float, default=None,
                    help="height of the barrel axis (default: mesh centroid)")
    ap.add_argument("--cap", action="store_true",
                    help="close the openings left by the cuts")
    ap.add_argument("--inspect", action="store_true",
                    help="print geometry stats and exit")
    a = ap.parse_args()

    mesh = load_single_mesh(a.input)
    describe(mesh, "input")

    if a.inspect or a.out_dir is None or a.base_top is None or a.gun_front is None:
        profile(mesh)
        print("\nRe-run with --out-dir, --base-top and --gun-front once you have "
              "picked the planes.")
        return

    up = AXIS[a.up]
    fwd_sign = -1.0 if a.forward.startswith("-") else 1.0
    fwd = AXIS[a.forward[-1]]

    masks = split_masks(mesh, up, fwd, fwd_sign, a.base_top, a.gun_front,
                        a.gun_radius, a.gun_axis_height)
    finish_parts(mesh, masks, Path(a.out_dir), a.name, up, fwd, fwd_sign,
                 a.base_top, a.gun_front,
                 cap=a.cap,
                 meta_extra={"method": "cut-planes",
                             "cuts": {"base_top": a.base_top,
                                      "gun_front": a.gun_front,
                                      "gun_radius": a.gun_radius,
                                      "up": a.up, "forward": a.forward}})


if __name__ == "__main__":
    main()
