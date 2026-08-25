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

    rembg = BackgroundRemover()
    images = {}
    for name in ("front", "back", "left", "right"):
        p = views_dir / f"{name}.png"
        if not p.exists():
            continue
        img = Image.open(p)
        if img.mode == "RGB" or img.getextrema()[3][0] == 255:
            img = rembg(img.convert("RGB"))
        images[name] = img.convert("RGBA")
    log(f"views: {sorted(images)}")
    if "front" not in images:
        raise SystemExit("front.png is required")

    log("loading shape pipeline (Hunyuan3D-2mv)...")
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        "tencent/Hunyuan3D-2mv", subfolder="hunyuan3d-dit-v2-mv"
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

    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=a.target_faces)
    log(f"cleaned: {len(mesh.faces)} faces")

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
