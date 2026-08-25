#!/usr/bin/env python3
"""Shared plumbing for turning a labelled turret mesh into animatable parts.

Used by both split methods:
  - tools/split_turret_parts.py  (axis-aligned cut planes)
  - tools/apply_p3sam_parts.py   (P3-SAM native segmentation)

Both end in the same place: three face groups -> three meshes, each re-origined
at its animation pivot, exported individually and as one hierarchical GLB
(Base -> Head -> Gun).
"""

import json

import numpy as np
import trimesh

AXIS = {"x": 0, "y": 1, "z": 2}
PART_ORDER = ("Base", "Head", "Gun")


def load_single_mesh(path) -> trimesh.Trimesh:
    """Load a GLB as one Trimesh, with node transforms baked and UVs intact.

    Walk graph.nodes_geometry rather than geometry.items(): a node's name and
    the geometry it points at are different things, and tools like gltfpack
    rename nodes freely. Keying the transform lookup on the geometry name works
    only for files we wrote ourselves.
    """
    obj = trimesh.load(str(path), process=False, force="scene")
    if not isinstance(obj, trimesh.Scene):
        return obj
    meshes = []
    for node in obj.graph.nodes_geometry:
        transform, geom_name = obj.graph[node]
        g = obj.geometry[geom_name].copy()
        g.apply_transform(transform)
        meshes.append(g)
    if not meshes:
        raise ValueError(f"{path} contains no geometry")
    return trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]


def describe(mesh, label="mesh"):
    lo, hi = mesh.bounds
    vis = type(mesh.visual).__name__
    uv = getattr(mesh.visual, "uv", None)
    print(f"[{label}] {len(mesh.faces)} faces  {len(mesh.vertices)} verts  "
          f"{vis}{' +uv' if uv is not None else ''}")
    print(f"[{label}] x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] "
          f"z[{lo[2]:+.3f},{hi[2]:+.3f}]  extents {np.round(mesh.extents, 3)}")


def submesh_by_faces(mesh, face_mask):
    """Whole-face submesh. Keeps TextureVisuals + UVs; never splits a triangle."""
    idx = np.flatnonzero(face_mask)
    if idx.size == 0:
        raise ValueError("empty part - the labels or cut planes are wrong")
    return mesh.submesh([idx], append=True, repair=False)


def largest_components(mesh, min_frac=0.02):
    """Drop stray islands that a cut or a mislabelled segment left behind.

    Connectivity is computed on a position-welded copy. A textured mesh
    duplicates vertices along every UV seam, so splitting it directly reports
    hundreds of "islands" across what is physically one continuous surface -
    and a size filter then deletes most of the part. Welding is only used to
    decide which faces belong together; the faces returned are the original
    ones, so UVs survive.
    """
    welded = mesh.copy()
    try:
        welded.merge_vertices()          # positional weld, face order preserved
    except Exception:
        pass
    if len(welded.faces) != len(mesh.faces):
        return mesh                      # cannot map labels back safely

    labels = trimesh.graph.connected_component_labels(
        welded.face_adjacency, node_count=len(welded.faces))
    ids, counts = np.unique(labels, return_counts=True)
    if len(ids) <= 1:
        return mesh

    biggest = counts.max()
    keep_ids = ids[counts >= min_frac * biggest]
    dropped = len(ids) - len(keep_ids)
    face_mask = np.isin(labels, keep_ids)
    if dropped:
        print(f"    dropped {dropped} island(s) < {min_frac:.0%} of the largest "
              f"({int((~face_mask).sum())} faces of {len(mesh.faces)})")
    if face_mask.all():
        return mesh
    return mesh.submesh([np.flatnonzero(face_mask)], append=True, repair=False)


def part_pivot(name, part_mesh, up, fwd, fwd_sign, base_top, gun_front):
    """Where the part rotates about, in the original mesh's coordinates.

    Base : bottom centre    -> sits on terrain at y=0
    Head : turntable centre -> yaw about local +up
    Gun  : breech centre on the barrel axis -> spin about the barrel axis,
                                               pitch about the local side axis
    """
    lo, hi = part_mesh.bounds
    pivot = (lo + hi) / 2.0
    if name == "Base":
        pivot[up] = lo[up]
    elif name == "Head":
        pivot[up] = base_top
    else:
        pivot[fwd] = gun_front * fwd_sign
    return pivot


def build_and_export(parts, pivots, out_dir, name, meta_extra=None):
    """Write <name>_<Part>.glb for each part plus a hierarchical <name>.glb."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for part_name, mesh in parts.items():
        mesh.export(out_dir / f"{name}_{part_name}.glb")

    scene = trimesh.Scene()
    scene.add_geometry(parts["Base"], node_name="Base", geom_name="Base")
    head_off = pivots["Head"] - pivots["Base"]
    scene.add_geometry(
        parts["Head"], node_name="Head", geom_name="Head",
        parent_node_name="Base",
        transform=trimesh.transformations.translation_matrix(head_off))
    gun_off = pivots["Gun"] - pivots["Head"]
    scene.add_geometry(
        parts["Gun"], node_name="Gun", geom_name="Gun",
        parent_node_name="Head",
        transform=trimesh.transformations.translation_matrix(gun_off))
    combined = out_dir / f"{name}.glb"
    scene.export(combined)

    meta = {
        "name": name,
        "hierarchy": "Base > Head > Gun",
        "pivots_world": {k: [round(float(x), 5) for x in v] for k, v in pivots.items()},
        "local_offsets": {
            "Head_from_Base": [round(float(x), 5) for x in head_off],
            "Gun_from_Head": [round(float(x), 5) for x in gun_off],
        },
        "faces": {k: int(len(v.faces)) for k, v in parts.items()},
        **(meta_extra or {}),
    }
    (out_dir / f"{name}_parts.json").write_text(json.dumps(meta, indent=2))
    print(f"\nwrote {combined} + {len(parts)} part GLBs to {out_dir}")
    return combined


def cap_cuts(mesh, label=""):
    """Close the openings a cut leaves behind.

    Splitting by whole faces leaves each part open where it met its neighbour
    (base open on top, head open at the mantlet, gun open at the breech). Those
    are hidden in the assembled turret, but the head yaws and the gun spins, so
    a seam can swing into view - and an open boundary reads as a hole to
    anything doing backface culling.
    """
    before = boundary_edge_count(mesh)
    if not before:
        return mesh
    filled = mesh.copy()
    try:
        filled.fill_holes()
    except Exception as e:
        print(f"    cap failed on {label}: {e}")
        return mesh
    after = boundary_edge_count(filled)
    if after >= before:
        # trimesh's fill_holes only closes small simple loops; a plane cut
        # leaves long irregular boundaries it will not touch. Report honestly
        # rather than printing "capped" over an unchanged mesh.
        print(f"    cap had no effect on {label}: {before} boundary edges remain "
              f"(cut rims are too irregular for fill_holes)")
        return mesh
    print(f"    capped {label}: boundary edges {before} -> {after}"
          f"{'  (watertight)' if filled.is_watertight else ''}")
    return filled


def boundary_edge_count(mesh) -> int:
    """Edges used by exactly one face, i.e. the rim of a hole."""
    _, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return int((counts == 1).sum())


def finish_parts(mesh, masks, out_dir, name, up, fwd, fwd_sign,
                 base_top, gun_front, meta_extra=None, cap=False):
    """masks: {'Base': bool[nfaces], 'Head': ..., 'Gun': ...} -> exported GLBs."""
    parts, pivots = {}, {}
    for part_name in PART_ORDER:
        mask = masks[part_name]
        print(f"\n[{part_name}] {int(mask.sum())} faces ({mask.mean():.1%})")
        p = largest_components(submesh_by_faces(mesh, mask))
        if cap:
            p = cap_cuts(p, part_name)
        pivot = part_pivot(part_name, p, up, fwd, fwd_sign, base_top, gun_front)
        p.apply_translation(-pivot)
        parts[part_name], pivots[part_name] = p, pivot
        describe(p, part_name)
    return build_and_export(parts, pivots, out_dir, name, meta_extra)
