#!/usr/bin/env python3
"""Runs ON THE POD. Everything the turret job needs, in one pod session.

  1. full turret     -> Hunyuan3D-2mv from 4 whole-turret views
  2. P3-SAM          -> native part segmentation of that mesh (face ids)
  3. base/head/gun   -> three independent generations from per-component views

Stage 3 is the expensive-but-optional comparison arm; skip it with --skip-parts.
Every stage is checkpointed: an existing output is not regenerated, so a rerun
after a failure resumes instead of paying for the whole thing again.

  python remote_turret_pipeline.py --in /workspace/job/in --out /workspace/job/out
"""

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path

WORK = Path("/workspace")
PART_REPO = WORK / "Hunyuan3D-Part"
os.environ.setdefault("HF_HOME", str(WORK / "hf"))


def log(m):
    print(f"[pipe {time.strftime('%H:%M:%S')}] {m}", flush=True)


def generate(views: Path, out: Path, steps, octree, guidance, seed, faces, texture=True):
    out.mkdir(parents=True, exist_ok=True)
    done = out / ("mesh_textured.glb" if texture else "mesh_shape.glb")
    if done.exists() and done.stat().st_size > 1024:
        log(f"skip {out.name}: {done.name} already present")
        return done
    cmd = [
        sys.executable, str(WORK / "remote_generate.py"),
        "--views", str(views), "--out", str(out),
        "--steps", str(steps), "--octree", str(octree),
        "--guidance", str(guidance), "--seed", str(seed),
        "--target-faces", str(faces),
    ]
    if not texture:
        cmd.append("--no-texture")
    log(f"generating {out.name} from {views.name}")
    subprocess.run(cmd, check=True)
    return done if done.exists() else (out / "mesh_shape.glb")


def segment(mesh_path: Path, out: Path, point_num, prompt_num, seed):
    """P3-SAM automatic part segmentation -> <out>/mesh_face_ids.npy + preview."""
    out.mkdir(parents=True, exist_ok=True)
    if (out / "mesh_face_ids.npy").exists():
        log("skip p3sam: face ids already present")
        return

    sys.path.insert(0, str(PART_REPO / "P3-SAM"))
    sys.path.insert(0, str(PART_REPO / "P3-SAM" / "demo"))

    import numpy as np
    import trimesh

    from auto_mask import AutoMask, set_seed

    log("loading P3-SAM...")
    auto_mask = AutoMask(None)  # None -> pulls p3sam.safetensors from the HF hub

    mesh = trimesh.load(str(mesh_path), force="mesh")
    set_seed(seed)
    t0 = time.time()
    aabb, face_ids, seg_mesh = auto_mask.predict_aabb(
        mesh,
        save_path=str(out),
        point_num=point_num,
        prompt_num=prompt_num,
        post_process=0,
        save_mid_res=0,
        show_info=1,
        seed=seed,
        is_parallel=0,
        clean_mesh_flag=1,
    )
    log(f"p3sam done in {time.time()-t0:.0f}s: "
        f"{len(np.unique(face_ids))} segments over {len(seg_mesh.faces)} faces")

    # P3-SAM cleans the mesh, so its faces do not line up with the textured one.
    # Persist BOTH the labels and the mesh they refer to; the local step
    # transfers labels back onto the textured mesh by nearest-face lookup.
    np.save(out / "mesh_face_ids.npy", face_ids)
    np.save(out / "mesh_aabb.npy", np.asarray(aabb, dtype=object), allow_pickle=True)
    seg_mesh.export(out / "mesh_segmented_source.glb")

    colors = np.zeros((len(face_ids), 4), dtype=np.uint8)
    colors[:, 3] = 255
    rng = np.random.default_rng(0)
    for sid in np.unique(face_ids):
        colors[face_ids == sid, :3] = (
            [40, 40, 40] if sid < 0 else rng.integers(60, 256, 3)
        )
    prev = seg_mesh.copy()
    prev.visual = trimesh.visual.ColorVisuals(prev, face_colors=colors)
    prev.export(out / "mesh_segmented_preview.glb")
    log("wrote face ids + preview")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="/workspace/job/in")
    ap.add_argument("--out", dest="out", default="/workspace/job/out")
    ap.add_argument("--steps", type=int, default=50)
    ap.add_argument("--octree", type=int, default=384)
    ap.add_argument("--guidance", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--faces", type=int, default=80000)
    ap.add_argument("--part-octree", type=int, default=320)
    ap.add_argument("--part-faces", type=int, default=40000)
    ap.add_argument("--point-num", type=int, default=100000)
    ap.add_argument("--prompt-num", type=int, default=400)
    ap.add_argument("--no-texture", action="store_true")
    ap.add_argument("--skip-parts", action="store_true")
    ap.add_argument("--skip-segment", action="store_true")
    a = ap.parse_args()

    inp, out = Path(a.inp), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"stages": {}}

    # ---- 1. whole turret
    t0 = time.time()
    full = generate(inp / "views_turret", out / "full",
                    a.steps, a.octree, a.guidance, a.seed, a.faces,
                    texture=not a.no_texture)
    report["stages"]["full"] = {"ok": full.exists(), "sec": round(time.time() - t0)}
    log(f"full turret -> {full}")

    # ---- 2. P3-SAM segmentation of the whole turret
    if not a.skip_segment:
        t0 = time.time()
        try:
            segment(full, out / "p3sam", a.point_num, a.prompt_num, a.seed)
            report["stages"]["p3sam"] = {"ok": True, "sec": round(time.time() - t0)}
        except Exception as e:
            log(f"P3-SAM FAILED: {e}")
            traceback.print_exc()
            report["stages"]["p3sam"] = {"ok": False, "error": str(e)[:400]}

    # ---- 3. independent per-component generations
    if not a.skip_parts:
        for part in ("base", "head", "gun"):
            views = inp / f"views_turret_{part}"
            if not views.exists():
                log(f"no views for {part}, skipping")
                continue
            t0 = time.time()
            try:
                p = generate(views, out / f"part_{part}", a.steps, a.part_octree,
                             a.guidance, a.seed, a.part_faces,
                             texture=not a.no_texture)
                report["stages"][f"part_{part}"] = {
                    "ok": p.exists(), "sec": round(time.time() - t0)}
            except Exception as e:
                log(f"{part} FAILED: {e}")
                traceback.print_exc()
                report["stages"][f"part_{part}"] = {"ok": False, "error": str(e)[:400]}

    (out / "report.json").write_text(json.dumps(report, indent=2))
    log("=== PIPELINE DONE ===")
    log(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
