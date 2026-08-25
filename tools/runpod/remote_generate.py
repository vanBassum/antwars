#!/usr/bin/env python3
"""Runs ON THE POD. Multiview image -> textured GLB via Hunyuan3D-2.0.

Usage:
  python remote_generate.py --views /workspace/job/views --out /workspace/job/out \
      --steps 50 --octree 384
Expects <views>/front.png, back.png, left.png, right.png.
Writes <out>/mesh_textured.glb (and mesh_shape.glb as a fallback).
"""
import argparse
import os
import sys
import time
import traceback
from pathlib import Path

os.environ.setdefault("HF_HOME", "/workspace/hf")
sys.path.insert(0, "/workspace/Hunyuan3D-2")

import trimesh  # noqa: E402
from PIL import Image  # noqa: E402


def log(msg):
    print(f"[gen {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=50)
    ap.add_argument("--octree", type=int, default=384)
    ap.add_argument("--guidance", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--num-chunks", type=int, default=8000)
    ap.add_argument("--no-texture", action="store_true")
    # Parameterised so the bake-off can point this at 2.1 instead of 2.0.
    # Hardcoding the 2.0 ids meant a "2.1" run silently produced a 2.0 mesh -
    # a wrong result that looks like a right one.
    ap.add_argument("--repo", default="tencent/Hunyuan3D-2mv",
                    help="HF repo id for the shape pipeline")
    ap.add_argument("--subfolder", default="hunyuan3d-dit-v2-mv",
                    help="weights subfolder within --repo")
    ap.add_argument("--target-faces", type=int, default=40000)
    a = ap.parse_args()

    views_dir, out_dir = Path(a.views), Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import (
        Hunyuan3DDiTFlowMatchingPipeline,
        FaceReducer,
        FloaterRemover,
        DegenerateFaceRemover,
    )

    # Built on first use only: constructing it loads u2net (~1 min), which is
    # pure waste when the views already carry alpha - which they do when they
    # come from tools/make_turret_views.py.
    _rembg = []

    def matte(img):
        if not _rembg:
            log("view has no alpha - loading rembg/u2net")
            _rembg.append(BackgroundRemover())
        return _rembg[0](img.convert("RGB"))

    images = {}
    for name in ("front", "back", "left", "right"):
        p = views_dir / f"{name}.png"
        if not p.exists():
            continue
        img = Image.open(p)
        if img.mode == "RGB" or img.getextrema()[3][0] == 255:
            img = matte(img)
        images[name] = img.convert("RGBA")
    log(f"rembg {'used' if _rembg else 'skipped (views already matted)'}")
    log(f"views: {sorted(images)}")
    if "front" not in images:
        raise SystemExit("front.png is required")

    log(f"loading shape pipeline ({a.repo} / {a.subfolder})...")
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        a.repo, subfolder=a.subfolder
    )
    pipe.enable_flashvdm(topk_mode="merge")

    log(f"generating shape: steps={a.steps} octree={a.octree} guidance={a.guidance}")
    t0 = time.time()
    mesh = pipe(
        image=images,
        num_inference_steps=a.steps,
        guidance_scale=a.guidance,
        octree_resolution=a.octree,
        num_chunks=a.num_chunks,
        generator=__import__("torch").manual_seed(a.seed),
        output_type="trimesh",
    )[0]
    log(f"shape done in {time.time()-t0:.0f}s: {len(mesh.faces)} faces")

    # Bank the raw result before touching it. The diffusion is the expensive
    # part; a post-processing failure must never cost us the whole run.
    raw_path = out_dir / "mesh_raw.glb"
    mesh.export(raw_path)
    log(f"wrote {raw_path} (unprocessed safety copy)")

    # Hunyuan's cleanup goes through pymeshlab, which silently loses its
    # importers when its Qt plugins cannot load (missing libOpenGL.so.0 ->
    # "Unknown format for load: ply"). Fall back to trimesh so a broken
    # pymeshlab degrades the mesh quality instead of killing the job.
    try:
        mesh = FloaterRemover()(mesh)
        mesh = DegenerateFaceRemover()(mesh)
        mesh = FaceReducer()(mesh, max_facenum=a.target_faces)
        log(f"cleaned via pymeshlab: {len(mesh.faces)} faces")
    except Exception as e:
        log(f"pymeshlab post-processing failed ({e}); falling back to trimesh")
        traceback.print_exc()
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()
        comps = mesh.split(only_watertight=False)
        if len(comps) > 1:
            biggest = max(len(c.faces) for c in comps)
            keep = [c for c in comps if len(c.faces) >= 0.02 * biggest]
            log(f"dropped {len(comps) - len(keep)} floater(s) of {len(comps)}")
            mesh = trimesh.util.concatenate(keep) if len(keep) > 1 else keep[0]
        if len(mesh.faces) > a.target_faces:
            try:
                mesh = mesh.simplify_quadric_decimation(face_count=a.target_faces)
            except Exception as e2:
                log(f"decimation unavailable ({e2}); keeping full density")
        log(f"cleaned via trimesh: {len(mesh.faces)} faces")

    shape_path = out_dir / "mesh_shape.glb"
    mesh.export(shape_path)
    log(f"wrote {shape_path}")

    if a.no_texture:
        return

    try:
        log("loading paint pipeline...")
        from hy3dgen.texgen import Hunyuan3DPaintPipeline

        paint = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
        t0 = time.time()
        textured = paint(mesh, image=images["front"])
        textured.export(out_dir / "mesh_textured.glb")
        log(f"texture done in {time.time()-t0:.0f}s -> mesh_textured.glb")
    except Exception:
        log("TEXTURE FAILED - falling back to untextured shape")
        traceback.print_exc()


if __name__ == "__main__":
    main()
