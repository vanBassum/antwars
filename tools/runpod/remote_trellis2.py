#!/usr/bin/env python3
"""Runs ON THE POD. TRELLIS.2 image-to-3D, for the bake-off against Hunyuan3D-2.0.

Follows the repo's own example.py: Trellis2ImageTo3DPipeline -> a mesh carrying
an attribute volume -> o_voxel.postprocess.to_glb. TRELLIS.2 outputs PBR
materials, so unlike the Hunyuan3D-2.0 arm this produces a GLB with real
material channels rather than one baked colour map.

  python remote_trellis2.py --image /workspace/job/in/front.png \
      --out /workspace/job/out
"""

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

# Both must precede the torch/cv2 imports below.
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

WORK = Path("/workspace")
REPO = WORK / "TRELLIS.2"
os.environ.setdefault("HF_HOME", str(WORK / "hf"))

WEIGHTS = "microsoft/TRELLIS.2-4B"


def log(m):
    print(f"[trellis2 {time.strftime('%H:%M:%S')}] {m}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", default="/workspace/job/out")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--texture-size", type=int, default=2048)
    ap.add_argument("--decimation-target", type=int, default=200000)
    ap.add_argument("--weights", default=WEIGHTS)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO))
    os.chdir(REPO)          # example.py reads assets/ by relative path

    import torch
    from PIL import Image

    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    import o_voxel

    report = {"model": "TRELLIS.2", "weights": a.weights, "image": a.image,
              "seed": a.seed, "texture_size": a.texture_size}
    log(f"torch {torch.__version__} cuda={torch.cuda.is_available()}")

    log(f"loading {a.weights} (4B params, expect a slow first load)...")
    t_load = time.time()
    pipe = Trellis2ImageTo3DPipeline.from_pretrained(a.weights)
    pipe.cuda()
    log(f"loaded in {time.time() - t_load:.0f}s")

    img = Image.open(a.image).convert("RGBA")
    log(f"input image {img.size}")

    t0 = time.time()
    try:
        mesh = pipe.run(img, seed=a.seed)[0]
    except TypeError:
        # Older signature takes no seed kwarg.
        mesh = pipe.run(img)[0]
    except Exception as e:
        log(f"FAILED during run: {e}")
        traceback.print_exc()
        report.update({"ok": False, "error": str(e)[:600]})
        (out / "trellis2_report.json").write_text(json.dumps(report, indent=2))
        raise
    gen_sec = time.time() - t0
    peak = torch.cuda.max_memory_allocated() / 2**30
    log(f"generated in {gen_sec:.0f}s, peak VRAM {peak:.1f} GB")

    try:
        mesh.simplify(16777216)          # nvdiffrast's hard limit
    except Exception as e:
        log(f"simplify skipped ({type(e).__name__}: {str(e)[:120]})")

    n_faces = int(len(mesh.faces)) if hasattr(mesh, "faces") else None
    log(f"mesh faces before export: {n_faces:,}" if n_faces else "mesh faces: ?")

    log("baking PBR GLB...")
    t1 = time.time()
    glb = o_voxel.postprocess.to_glb(
        vertices=mesh.vertices,
        faces=mesh.faces,
        attr_volume=mesh.attrs,
        coords=mesh.coords,
        attr_layout=mesh.layout,
        voxel_size=mesh.voxel_size,
        aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
        decimation_target=a.decimation_target,
        texture_size=a.texture_size,
        remesh=True,
        remesh_band=1,
        remesh_project=0,
        verbose=True,
    )
    # extension_webp=False: the comparison tooling reads these with trimesh,
    # which does not decode webp-in-GLB.
    glb.export(str(out / "trellis2_textured.glb"), extension_webp=False)
    bake_sec = time.time() - t1
    log(f"exported in {bake_sec:.0f}s")

    report.update({"ok": True, "sec": round(gen_sec), "bake_sec": round(bake_sec),
                   "peak_vram_gb": round(peak, 2), "faces": n_faces,
                   "files": ["trellis2_textured.glb"]})
    (out / "trellis2_report.json").write_text(json.dumps(report, indent=2))
    log("done")


if __name__ == "__main__":
    main()
