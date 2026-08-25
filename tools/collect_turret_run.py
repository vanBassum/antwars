#!/usr/bin/env python3
"""Organise a raw turret run into labelled folders and write a README.

A generation run drops a pile of similarly-named GLBs across several folders,
where the difference between two files is which stage produced them. This sorts
them into numbered directories, derives the split and game-ready variants, and
writes a README.md carrying measured numbers (face counts, sizes, whether the
mesh is closed) so the folder explains itself later.

  python tools/collect_turret_run.py --raw out/textured --out out/turret \
      --base-top -0.22 --gun-front 0.28 --gun-radius 0.17 --gun-axis-height 0.328
"""

import argparse
import json
import shutil
import subprocess
import sys
import os
from pathlib import Path

import numpy as np
from PIL import Image

from turret_assemble import boundary_edge_count, load_single_mesh

NPX = shutil.which("npx") or "npx"


def is_quantised(path: Path) -> bool:
    """True if the GLB uses KHR_mesh_quantization (a gltfpack output)."""
    try:
        import struct
        with open(path, "rb") as f:
            f.read(12)
            clen, _ = struct.unpack("<II", f.read(8))
            js = json.loads(f.read(clen).decode("utf-8"))
        return "KHR_mesh_quantization" in (js.get("extensionsUsed") or [])
    except Exception:
        return False


def stat(path: Path):
    """(faces, KB, closed?) for a GLB, or None if unreadable."""
    try:
        m = load_single_mesh(path)
    except Exception:
        return None
    return {
        "faces": len(m.faces),
        "kb": path.stat().st_size / 1024,
        "boundary": boundary_edge_count(m),
        "watertight": bool(m.is_watertight),
        "extents": [round(float(x), 3) for x in m.extents],
        "quantised": is_quantised(path),
    }


def shrink_texture(path: Path, px: int) -> bool:
    """Downscale the embedded baseColorTexture in place, via PIL.

    The repo's usual `gltf-transform resize` step cannot read Hunyuan's 2048px
    textures - libvips rejects them with "colourspace: parameter space not set"
    - so do the resize in Python, where the image is already decoded by the
    loader anyway.
    """
    try:
        mesh = load_single_mesh(path)
        mat = getattr(mesh.visual, "material", None)
        img = getattr(mat, "baseColorTexture", None) if mat else None
        if img is None or max(img.size) <= px:
            return True
        mat.baseColorTexture = img.resize((px, px), Image.LANCZOS)
        mesh.export(path)
        return True
    except Exception as e:
        print(f"  texture resize failed for {path.name}: {e}")
        return False


def decimate(src: Path, dst: Path, ratio=0.05, texture_px=512):
    """Shrink the texture first, THEN gltfpack. Order matters.

    gltfpack emits KHR_mesh_quantization + KHR_texture_transform: UVs become
    normalised uint16 with a dequantisation transform on the node. trimesh does
    not honour those extensions, so loading a packed GLB and re-exporting it
    writes the raw integers back as floats - UVs land in [0, 65534] and the
    model renders as one flat texel. So nothing may round-trip through trimesh
    after gltfpack; the texture resize has to happen on the un-packed source.

    Written via TEMP then moved: gltf-transform has previously deleted
    unrelated GLBs when pointed straight at a populated output directory.
    """
    tmpdir = Path(os.environ.get("TEMP", "/tmp"))
    pre = tmpdir / f"_pre_{dst.stem}.glb"
    packed = tmpdir / f"_dec_{dst.stem}.glb"
    try:
        shutil.copy2(src, pre)
        shrink_texture(pre, texture_px)          # safe: source has plain float UVs
        r = subprocess.run([NPX, "-y", "gltfpack", "-i", str(pre), "-o", str(packed),
                            "-si", str(ratio), "-slb"], capture_output=True)
        if r.returncode != 0 or not packed.exists():
            print(f"  gltfpack failed for {src.name}: "
                  f"{(r.stderr or b'').decode()[-200:]}")
            return False
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(packed), str(dst))       # nothing touches it after this
        return True
    finally:
        for f in (pre, packed):
            f.unlink(missing_ok=True)


def row(label, s):
    if not s:
        return f"| {label} | – | – | – |"
    closed = "yes" if s["watertight"] else f"no ({s['boundary']} edges)"
    return f"| {label} | {s['faces']:,} | {s['kb']:,.0f} KB | {closed} |"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, help="downloaded pod output dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--base-top", type=float, required=True)
    ap.add_argument("--gun-front", type=float, required=True)
    ap.add_argument("--gun-radius", type=float, default=None)
    ap.add_argument("--gun-axis-height", type=float, default=None)
    ap.add_argument("--reference", default="assets/reference")
    ap.add_argument("--skip-decimate", action="store_true")
    a = ap.parse_args()

    raw, out = Path(a.raw), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stats = {}

    # ---- 00 reference -------------------------------------------------------
    ref = out / "00_reference"
    ref.mkdir(exist_ok=True)
    for d in sorted(Path(a.reference).glob("views_turret*")):
        if d.is_dir():
            shutil.copytree(d, ref / d.name, dirs_exist_ok=True)

    # ---- 01 whole object, straight from the model ---------------------------
    whole = out / "01_whole_object"
    whole.mkdir(exist_ok=True)
    best_whole = None
    for src, dst in (("mesh_textured.glb", "turret_textured.glb"),
                     ("mesh_shape.glb", "turret_untextured.glb"),
                     ("mesh_raw.glb", "turret_raw_predecimation.glb")):
        p = raw / "full" / src
        if p.exists():
            shutil.copy2(p, whole / dst)
            stats[dst] = stat(whole / dst)
            if src != "mesh_raw.glb" and best_whole is None:
                best_whole = whole / dst

    # ---- 02 approach A: split the whole object ------------------------------
    if best_whole:
        split = out / "02_approach_A_split_from_whole"
        cmd = [sys.executable, str(Path(__file__).parent / "split_turret_parts.py"),
               "--input", str(best_whole), "--out-dir", str(split),
               "--name", "Turret", "--base-top", str(a.base_top),
               "--gun-front", str(a.gun_front), "--cap"]
        if a.gun_radius is not None:
            cmd += ["--gun-radius", str(a.gun_radius)]
        if a.gun_axis_height is not None:
            cmd += ["--gun-axis-height", str(a.gun_axis_height)]
        print("splitting whole object...")
        subprocess.run(cmd, check=True)
        for p in sorted(split.glob("*.glb")):
            stats[f"A/{p.name}"] = stat(p)

    # ---- 03 approach C: independently generated parts -----------------------
    sep = out / "03_approach_C_generated_separately"
    sep.mkdir(exist_ok=True)
    for part in ("base", "head", "gun"):
        d = raw / f"part_{part}"
        for src, suffix in (("mesh_textured.glb", ""),
                            ("mesh_shape.glb", "_untextured")):
            p = d / src
            if p.exists():
                dst = sep / f"{part.capitalize()}{suffix}.glb"
                shutil.copy2(p, dst)
                stats[f"C/{dst.name}"] = stat(dst)
                break

    # ---- 04 game-ready ------------------------------------------------------
    game = out / "04_game_ready"
    if not a.skip_decimate:
        game.mkdir(exist_ok=True)
        src_dir = out / "02_approach_A_split_from_whole"
        print("decimating for game use...")
        for p in sorted(src_dir.glob("Turret_*.glb")):
            if decimate(p, game / p.name):
                stats[f"game/{p.name}"] = stat(game / p.name)

    # ---- README -------------------------------------------------------------
    lines = [
        "# Turret generation run",
        "",
        "Generated from `assets/reference/turret_orthographic_REFERENCE.png`",
        "with **Hunyuan3D-2.0** (`hunyuan3d-dit-v2-mv`, four-view conditioning)",
        "plus its paint pipeline for texture, on a RunPod RTX 3090.",
        "",
        "## Folders",
        "",
        "| folder | what it is |",
        "|---|---|",
        "| `00_reference/` | the view images fed to the model, background already removed |",
        "| `01_whole_object/` | the turret as a single mesh, straight from the model |",
        "| `02_approach_A_split_from_whole/` | that mesh cut into Base/Head/Gun **(recommended)** |",
        "| `03_approach_C_generated_separately/` | each component generated independently, for comparison |",
        "| `04_game_ready/` | approach A, decimated and texture-capped for the engine |",
        "",
        "## The two approaches",
        "",
        "**A - split from whole** generates one turret and cuts it at the",
        "turntable ring and the mantlet. The parts fit together perfectly because",
        "they were never apart, and the style is consistent. Cut planes were",
        f"measured from the mesh: base/head at `y={a.base_top}`, mantlet at",
        f"`z={a.gun_front}`"
        + (f" within `r={a.gun_radius}` of the barrel axis." if a.gun_radius else "."),
        "",
        "**C - generated separately** runs the model three times on cropped views.",
        "Each part has cleaner topology, but they do not share a scale or an",
        "origin, so assembling them is manual work.",
        "",
        "## Animation rig (approach A)",
        "",
        "`Turret.glb` carries the hierarchy `Base > Head > Gun`, each part",
        "re-origined at its pivot:",
        "",
        "| part | pivot | intended motion |",
        "|---|---|---|",
        "| Base | bottom centre, sits on `y=0` | static |",
        "| Head | turntable centre | yaw about local Y |",
        "| Gun | breech, on the barrel axis | spin about local Z, pitch about local X |",
        "",
        "The individual `Turret_<part>.glb` files hold the same geometry with the",
        "same origins, if you would rather assemble them yourself.",
        "",
        "## Measurements",
        "",
        "| file | faces | size | closed mesh |",
        "|---|---|---|---|",
    ]
    for k, v in stats.items():
        lines.append(row(f"`{k}`", v))
    lines += [
        "",
        "\"Closed mesh\" matters because an open boundary reads as a hole when the",
        "part rotates away from its neighbour. The cut faces are capped, so the",
        "split parts are closed even though the cuts left them open.",
        "",
        "## Known limitations",
        "",
        "- The gun is a smooth cylinder rather than six resolved barrels. The",
        "  reference sheet shows the muzzle head-on as a flat disc, so there is",
        "  little for the model to reconstruct. A hand-made barrel cluster would",
        "  also spin true about its axis, which matters for a minigun.",
        "- Texture is baked colour, not PBR. Hunyuan3D-2.1 outputs",
        "  albedo/metallic/roughness but needs a 48 GB card for its texture pass.",
        "",
        "Regenerate with `tools/runpod/job.py turret` and re-collect with",
        "`tools/collect_turret_run.py`.",
    ]
    (out / "README.md").write_text("\n".join(lines), encoding="utf-8")
    (out / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(f"\nwrote {out/'README.md'}")
    for k, v in stats.items():
        if v:
            print(f"  {k:44} {v['faces']:>8,} f  {v['kb']:>8,.0f} KB")


if __name__ == "__main__":
    main()
