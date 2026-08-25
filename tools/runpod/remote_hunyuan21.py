#!/usr/bin/env python3
"""Runs ON THE POD. Hunyuan3D-2.1 shape generation, for the bake-off.

Kept separate from remote_generate.py rather than folded into it. 2.1 renamed
its package (hy3dgen -> hy3dshape) and takes a single conditioning image where
2.0's multiview variant takes four, so sharing one script would mean two
divergent code paths through the one thing in this repo that is known to work.

The import path and weights subfolder are resolved by probing, and whatever
resolves is written into the report - a bake-off result is worthless if you
cannot say which model produced it.

  python remote_hunyuan21.py --image /workspace/job/in/front.png \
      --out /workspace/job/out --no-texture
"""

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

WORK = Path("/workspace")
REPO = WORK / "Hunyuan3D-2.1"
os.environ.setdefault("HF_HOME", str(WORK / "hf"))


def log(m):
    print(f"[hy21 {time.strftime('%H:%M:%S')}] {m}", flush=True)


# (module, class) pairs, most-likely-for-2.1 first.
PIPELINE_CANDIDATES = [
    ("hy3dshape.pipelines", "Hunyuan3DDiTFlowMatchingPipeline"),
    ("hy3dshape", "Hunyuan3DDiTFlowMatchingPipeline"),
    ("hy3dgen.shapegen", "Hunyuan3DDiTFlowMatchingPipeline"),
]
# (repo_id, subfolder-or-None)
WEIGHT_CANDIDATES = [
    ("tencent/Hunyuan3D-2.1", "hunyuan3d-dit-v2-1"),
    ("tencent/Hunyuan3D-2.1", None),
]


def resolve_pipeline():
    errs = []
    for mod, cls in PIPELINE_CANDIDATES:
        try:
            m = __import__(mod, fromlist=[cls])
            return getattr(m, cls), f"{mod}.{cls}"
        except Exception as e:
            errs.append(f"{mod}.{cls}: {type(e).__name__}: {str(e)[:140]}")
    raise SystemExit("no Hunyuan3D-2.1 pipeline class resolved:\n  "
                     + "\n  ".join(errs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", default="/workspace/job/out")
    ap.add_argument("--steps", type=int, default=50)
    ap.add_argument("--octree", type=int, default=384)
    ap.add_argument("--guidance", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--target-faces", type=int, default=80000)
    ap.add_argument("--no-texture", action="store_true")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for p in (REPO, REPO / "hy3dshape", REPO / "hy3dpaint"):
        if p.exists():
            sys.path.insert(0, str(p))

    import torch
    import trimesh
    from PIL import Image

    report = {"model": "Hunyuan3D-2.1", "image": a.image, "seed": a.seed,
              "octree": a.octree, "steps": a.steps}
    log(f"torch {torch.__version__} cuda={torch.cuda.is_available()}")

    cls, name = resolve_pipeline()
    log(f"pipeline class: {name}")
    report["pipeline_class"] = name

    pipe, used = None, None
    for repo_id, sub in WEIGHT_CANDIDATES:
        try:
            log(f"loading weights {repo_id}" + (f" / {sub}" if sub else ""))
            pipe = (cls.from_pretrained(repo_id, subfolder=sub) if sub
                    else cls.from_pretrained(repo_id))
            used = f"{repo_id}" + (f"/{sub}" if sub else "")
            break
        except Exception as e:
            log(f"  failed: {type(e).__name__}: {str(e)[:180]}")
    if pipe is None:
        raise SystemExit("no Hunyuan3D-2.1 weights could be loaded")
    log(f"loaded {used}")
    report["weights"] = used

    try:
        pipe.enable_flashvdm(topk_mode="merge")
        log("flashvdm enabled")
    except Exception as e:
        log(f"flashvdm unavailable ({type(e).__name__}), continuing without")

    img = Image.open(a.image).convert("RGBA")
    log(f"input image {img.size}")

    t0 = time.time()
    try:
        result = pipe(image=img, num_inference_steps=a.steps,
                      guidance_scale=a.guidance, octree_resolution=a.octree,
                      generator=torch.manual_seed(a.seed))
        mesh = result[0] if isinstance(result, (list, tuple)) else result
    except Exception as e:
        log(f"FAILED during generation: {e}")
        traceback.print_exc()
        report.update({"ok": False, "error": str(e)[:600]})
        (out / "hunyuan21_report.json").write_text(json.dumps(report, indent=2))
        raise
    gen_sec = time.time() - t0
    peak = torch.cuda.max_memory_allocated() / 2**30
    log(f"generated in {gen_sec:.0f}s, peak VRAM {peak:.1f} GB")

    # Bank the raw mesh before any post-processing can fail on it.
    raw = out / "mesh_raw.glb"
    mesh.export(str(raw))
    log(f"banked {raw.name}: {len(mesh.faces):,} faces")
    report["raw_faces"] = int(len(mesh.faces))

    if a.target_faces and len(mesh.faces) > a.target_faces:
        try:
            m = trimesh.Trimesh(mesh.vertices, mesh.faces)
            m = m.simplify_quadric_decimation(face_count=a.target_faces)
            m.export(str(out / "mesh_shape.glb"))
            log(f"decimated to {len(m.faces):,} faces")
            report["faces"] = int(len(m.faces))
        except Exception as e:
            log(f"decimation failed ({type(e).__name__}), keeping raw: "
                f"{str(e)[:160]}")
            mesh.export(str(out / "mesh_shape.glb"))
            report["faces"] = int(len(mesh.faces))
    else:
        mesh.export(str(out / "mesh_shape.glb"))
        report["faces"] = int(len(mesh.faces))

    report.update({"ok": True, "sec": round(gen_sec), "peak_vram_gb": round(peak, 2),
                   "textured": False})
    (out / "hunyuan21_report.json").write_text(json.dumps(report, indent=2))
    log("done")


if __name__ == "__main__":
    main()
