#!/usr/bin/env python3
"""Runs ON THE POD. P3-SAM native part segmentation of an existing mesh.

The same segmentation stage as remote_turret_pipeline.py, but standing alone so
it can run against a mesh that was generated on some earlier pod - there is no
reason to pay to regenerate a turret we already have just to segment it.

P3-SAM cleans the mesh before segmenting, so its face ids index ITS mesh, not
the one uploaded. Both are written out; tools/apply_p3sam_parts.py transfers the
labels back onto the textured mesh locally.

  python remote_p3sam.py --mesh /workspace/job/in/turret_untextured.glb \
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
PART_REPO = WORK / "Hunyuan3D-Part"
os.environ.setdefault("HF_HOME", str(WORK / "hf"))


def log(m):
    print(f"[p3sam {time.strftime('%H:%M:%S')}] {m}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--out", default="/workspace/job/out")
    ap.add_argument("--point-num", type=int, default=100000)
    ap.add_argument("--prompt-num", type=int, default=400)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"mesh": a.mesh, "point_num": a.point_num, "prompt_num": a.prompt_num}

    sys.path.insert(0, str(PART_REPO / "P3-SAM"))
    sys.path.insert(0, str(PART_REPO / "P3-SAM" / "demo"))

    import numpy as np
    import torch
    import trimesh

    from auto_mask import AutoMask, set_seed

    log(f"torch {torch.__version__} cuda={torch.cuda.is_available()}")
    mesh = trimesh.load(a.mesh, force="mesh")
    log(f"input mesh: {len(mesh.faces)} faces")

    log("loading P3-SAM...")
    auto_mask = AutoMask(None)  # None -> pulls p3sam.safetensors from the HF hub
    set_seed(a.seed)

    t0 = time.time()
    try:
        aabb, face_ids, seg_mesh = auto_mask.predict_aabb(
            mesh,
            save_path=str(out),
            point_num=a.point_num,
            prompt_num=a.prompt_num,
            post_process=0,
            save_mid_res=0,
            show_info=1,
            seed=a.seed,
            is_parallel=0,
            clean_mesh_flag=1,
        )
    except Exception as e:
        log(f"FAILED: {e}")
        traceback.print_exc()
        report["ok"] = False
        report["error"] = str(e)[:600]
        (out / "p3sam_report.json").write_text(json.dumps(report, indent=2))
        raise

    sec = time.time() - t0
    segs = sorted(int(s) for s in np.unique(face_ids))
    log(f"done in {sec:.0f}s: {len(segs)} segments over {len(seg_mesh.faces)} faces")

    np.save(out / "mesh_face_ids.npy", face_ids)
    np.save(out / "mesh_aabb.npy", np.asarray(aabb, dtype=object), allow_pickle=True)
    seg_mesh.export(out / "mesh_segmented_source.glb")

    # Per-segment sizes, so the merge step can be reasoned about before the
    # files are even downloaded.
    sizes = {int(s): int((face_ids == s).sum()) for s in segs}
    for s, n in sorted(sizes.items(), key=lambda kv: -kv[1]):
        log(f"  segment {s:>3}: {n:>7,} faces ({n/len(face_ids):.1%})")

    colors = np.zeros((len(face_ids), 4), dtype=np.uint8)
    colors[:, 3] = 255
    rng = np.random.default_rng(0)
    for sid in segs:
        colors[face_ids == sid, :3] = (
            [40, 40, 40] if sid < 0 else rng.integers(60, 256, 3)
        )
    prev = seg_mesh.copy()
    prev.visual = trimesh.visual.ColorVisuals(prev, face_colors=colors)
    prev.export(out / "mesh_segmented_preview.glb")

    report.update({"ok": True, "sec": round(sec), "segments": len(segs),
                   "seg_faces": len(seg_mesh.faces), "sizes": sizes})
    (out / "p3sam_report.json").write_text(json.dumps(report, indent=2))
    log("wrote face ids + coloured preview")


if __name__ == "__main__":
    main()
