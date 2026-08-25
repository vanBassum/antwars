#!/usr/bin/env python3
"""Runs ON THE POD. TRELLIS image-to-3D, for the bake-off against Hunyuan3D-2.0.

TRELLIS.2's published pipeline class name has moved around between the paper,
the repo and the HF weights, so the pipeline and the weights repo are both
resolved by probing rather than hardcoded - a wrong guess would otherwise waste
the whole paid run on an AttributeError. Whatever it resolves is recorded in
the report so the result is attributable to a specific model.

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

WORK = Path("/workspace")
REPO = WORK / "TRELLIS2"
os.environ.setdefault("HF_HOME", str(WORK / "hf"))
# TRELLIS picks its sparse/attention backends from env at import time.
os.environ.setdefault("ATTN_BACKEND", "flash-attn")
os.environ.setdefault("SPCONV_ALGO", "native")


def log(m):
    print(f"[trellis {time.strftime('%H:%M:%S')}] {m}", flush=True)


PIPELINE_CANDIDATES = [
    ("trellis.pipelines", "Trellis2ImageTo3DPipeline"),
    ("trellis.pipelines", "TrellisImageTo3DPipeline"),
    ("trellis2.pipelines", "Trellis2ImageTo3DPipeline"),
]
WEIGHT_CANDIDATES = [
    "microsoft/TRELLIS.2",
    "microsoft/TRELLIS-2",
    "microsoft/TRELLIS-image-large",
]


def resolve_pipeline():
    """First (module, class) pair that imports. Returns (cls, name)."""
    errs = []
    for mod, cls in PIPELINE_CANDIDATES:
        try:
            m = __import__(mod, fromlist=[cls])
            return getattr(m, cls), f"{mod}.{cls}"
        except Exception as e:
            errs.append(f"{mod}.{cls}: {type(e).__name__}: {str(e)[:120]}")
    raise SystemExit("no TRELLIS pipeline class resolved:\n  " + "\n  ".join(errs))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", default="/workspace/job/out")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--simplify", type=float, default=0.95)
    ap.add_argument("--texture-size", type=int, default=1024)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO))

    import torch
    from PIL import Image

    report = {"image": a.image, "seed": a.seed}
    log(f"torch {torch.__version__} cuda={torch.cuda.is_available()}")

    cls, name = resolve_pipeline()
    log(f"pipeline class: {name}")
    report["pipeline_class"] = name

    pipe, used = None, None
    for repo_id in WEIGHT_CANDIDATES:
        try:
            log(f"loading weights {repo_id}...")
            pipe = cls.from_pretrained(repo_id)
            used = repo_id
            break
        except Exception as e:
            log(f"  {repo_id} failed: {type(e).__name__}: {str(e)[:160]}")
    if pipe is None:
        raise SystemExit("no TRELLIS weights could be loaded")
    log(f"loaded {used}")
    report["weights"] = used

    pipe.cuda()
    img = Image.open(a.image).convert("RGBA")
    log(f"input image {img.size}")

    t0 = time.time()
    try:
        outputs = pipe.run(img, seed=a.seed)
    except Exception as e:
        log(f"FAILED during run: {e}")
        traceback.print_exc()
        report.update({"ok": False, "error": str(e)[:600]})
        (out / "trellis_report.json").write_text(json.dumps(report, indent=2))
        raise
    gen_sec = time.time() - t0
    log(f"generation done in {gen_sec:.0f}s; keys: {list(outputs.keys())}")

    peak = torch.cuda.max_memory_allocated() / 2**30
    log(f"peak VRAM {peak:.1f} GB")

    # to_glb wants a gaussian (for colour) plus the mesh. Export whatever this
    # build actually produced rather than assuming both are present.
    from trellis.utils import postprocessing_utils

    wrote = []
    try:
        mesh = outputs["mesh"][0]
        appearance = (outputs.get("gaussian") or outputs.get("radiance_field"))[0]
        glb = postprocessing_utils.to_glb(
            appearance, mesh, simplify=a.simplify, texture_size=a.texture_size)
        glb.export(str(out / "trellis_textured.glb"))
        wrote.append("trellis_textured.glb")
    except Exception as e:
        log(f"to_glb failed: {type(e).__name__}: {str(e)[:200]}")
        traceback.print_exc()

    # Bank the bare geometry too - a failed texture bake should not cost us the
    # shape, which is the half the bake-off is actually comparing.
    try:
        import trimesh
        m = outputs["mesh"][0]
        v = m.vertices.detach().cpu().numpy() if hasattr(m, "vertices") else None
        f = m.faces.detach().cpu().numpy() if hasattr(m, "faces") else None
        if v is not None and f is not None:
            trimesh.Trimesh(v, f).export(str(out / "trellis_shape.glb"))
            wrote.append("trellis_shape.glb")
            report["faces"] = int(len(f))
    except Exception as e:
        log(f"shape export failed: {type(e).__name__}: {str(e)[:200]}")

    if not wrote:
        report.update({"ok": False, "error": "generation succeeded but nothing exported"})
        (out / "trellis_report.json").write_text(json.dumps(report, indent=2))
        raise SystemExit("nothing exported")

    report.update({"ok": True, "sec": round(gen_sec), "peak_vram_gb": round(peak, 2),
                   "files": wrote})
    (out / "trellis_report.json").write_text(json.dumps(report, indent=2))
    log(f"wrote {', '.join(wrote)}")


if __name__ == "__main__":
    main()
