#!/usr/bin/env python3
"""Runs ON THE POD. Paint an EXISTING mesh - no shape regeneration.

Splitting the paint stage out matters because the two halves fail for different
reasons: shape needs only torch, texture needs the CUDA rasterizer extensions.
When texturing fails (or the extensions land after a run started), this repaints
the mesh already on disk instead of paying for the diffusion again.

  python remote_texture.py --mesh out/full/mesh_shape.glb \
      --image job/in/views_turret/front.png --out out/full/mesh_textured.glb
"""

import argparse
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HOME", "/workspace/hf")
sys.path.insert(0, "/workspace/Hunyuan3D-2")

# torch before anything that pulls in the compiled kernels: they link against
# libc10.so, which only resolves once torch has been loaded.
import torch  # noqa: F401,E402
import trimesh  # noqa: E402
from PIL import Image  # noqa: E402


def log(m):
    print(f"[tex {time.strftime('%H:%M:%S')}] {m}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--image", required=True, help="conditioning view (front)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    try:
        import custom_rasterizer  # noqa: F401
    except Exception as e:
        raise SystemExit(
            f"custom_rasterizer unimportable ({e}) - texturing cannot run. "
            "Build it with: CUDA_HOME=/usr/local/cuda pip install "
            "--no-build-isolation -e hy3dgen/texgen/custom_rasterizer"
        )

    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    mesh = trimesh.load(a.mesh, force="mesh")
    log(f"loaded {a.mesh}: {len(mesh.faces)} faces")

    img = Image.open(a.image)
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    log("loading paint pipeline...")
    paint = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")

    t0 = time.time()
    textured = paint(mesh, image=img)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    textured.export(a.out)
    log(f"textured in {time.time()-t0:.0f}s -> {a.out} "
        f"({Path(a.out).stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
