#!/usr/bin/env python3
"""Compare the bake-off models on one table, including what each run cost.

Every arm of the bake-off drops a different shape of output - PartCrafter emits
N part meshes, TRELLIS.2 one PBR GLB, Hunyuan3D-2.1 a bare shape, P3-SAM face
labels rather than a mesh at all - so this normalises them to the things worth
comparing: does it split natively, does it have a texture, is it PBR, how many
faces, how long did it take and what did that cost.

Cost comes from the job logs (the confirmed billing rate, not the estimate) and
the run's own wall clock, so the price column reflects what was actually paid.

  python tools/collect_bakeoff.py --raw out/bakeoff --out out/bakeoff \
      --logs "$SCRATCH"
"""

import argparse
import json
import re
from pathlib import Path

from turret_assemble import boundary_edge_count, load_single_mesh

# raw subdir -> (display name, what the model is for)
MODELS = {
    "partcrafter": ("PartCrafter", "generates N parts directly from one image"),
    "trellis2": ("TRELLIS.2", "4B, O-Voxel, PBR materials"),
    "hunyuan21": ("Hunyuan3D-2.1", "shape only (PBR texture needs 48GB)"),
    "p3sam": ("P3-SAM", "segments an existing mesh into parts"),
}
# raw subdir -> the job log that recorded its rate and timings
LOGS = {"partcrafter": "pc.log", "trellis2": "trellis.log",
        "hunyuan21": "hy21.log", "p3sam": "p3sam.log"}


def parse_log(path: Path):
    """(rate $/hr, gpu, wall-clock seconds of the successful attempt)."""
    if not path or not path.exists():
        return {}
    txt = path.read_text(encoding="utf-8", errors="replace")
    out = {}
    rates = re.findall(r"confirmed billing rate \$([\d.]+)/hr", txt)
    if rates:
        out["rate"] = float(rates[-1])
    # The candidate list is printed before creation; the chosen GPU is the one
    # whose price matches the confirmed rate.
    if "rate" in out:
        for price, vram, gpu in re.findall(
                r"\$([\d.]+)/hr\s+(\d+)GB\s+\S+\s+(.+)", txt):
            if abs(float(price) - out["rate"]) < 1e-6:
                out["gpu"] = gpu.strip()
                out["vram"] = int(vram)
                break
    # Wall clock: first "created pod" of the last attempt -> last timestamped line.
    stamps = re.findall(r"\[job (\d\d:\d\d:\d\d)\]", txt)
    created = re.findall(r"\[job (\d\d:\d\d:\d\d)\] created pod", txt)
    if created and stamps:
        def secs(t):
            h, m, s = (int(x) for x in t.split(":"))
            return h * 3600 + m * 60 + s
        span = secs(stamps[-1]) - secs(created[-1])
        if span >= 0:
            out["wall_sec"] = span
    return out


def mesh_stats(p: Path):
    try:
        m = load_single_mesh(p)
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:80]}"}
    vis = getattr(m, "visual", None)
    mat = getattr(vis, "material", None)
    tex = getattr(mat, "baseColorTexture", None) if mat is not None else None
    pbr = any(getattr(mat, k, None) is not None
              for k in ("metallicRoughnessTexture", "normalTexture",
                        "emissiveTexture")) if mat is not None else False
    return {
        "faces": len(m.faces),
        "kb": round(p.stat().st_size / 1024),
        "textured": tex is not None,
        "texture_px": max(tex.size) if tex is not None else None,
        "pbr": bool(pbr),
        "boundary": boundary_edge_count(m),
        "extents": [round(float(x), 3) for x in m.extents],
    }


def collect(raw: Path, logs: Path):
    rows = {}
    for key, (name, blurb) in MODELS.items():
        d = raw / key
        row = {"name": name, "note": blurb, "files": [], "parts": 0,
               "meshes": {}, "status": "no output"}
        row.update(parse_log(logs / LOGS[key] if logs else None))

        if d.exists():
            for rep in sorted(d.rglob("*report*.json")) + sorted(d.rglob("manifest.json")):
                try:
                    row["report"] = json.loads(rep.read_text())
                except Exception:
                    pass
            globs = sorted(d.rglob("*.glb")) + sorted(d.rglob("*.ply"))
            row["files"] = [str(p.relative_to(d)) for p in globs]
            # PartCrafter names its outputs part_00.glb, part_01.glb, ...
            row["parts"] = len([p for p in globs
                                if re.match(r"part_\d+", p.name)])
            for p in globs[:8]:
                row["meshes"][p.name] = mesh_stats(p)
            if globs:
                row["status"] = "ok"
        if row.get("rate") and row.get("wall_sec"):
            row["cost"] = round(row["rate"] * row["wall_sec"] / 3600, 3)
        rows[key] = row
    return rows


def money(v):
    return f"${v:.3f}" if isinstance(v, (int, float)) else "–"


def render(rows):
    L = ["# Bake-off: image-to-3D models for the turret",
         "",
         "All arms were given the same reference view and run on RunPod",
         "community GPUs under a $0.60/hr cap. Hunyuan3D-2.0 is the incumbent",
         "this project already ships; see `out/turret/` for its full results.",
         "",
         "## Summary",
         "",
         "| model | native parts | texture | faces | GPU | time | cost |",
         "|---|---|---|---|---|---|---|"]
    for key, r in rows.items():
        if r["status"] != "ok":
            L.append(f"| **{r['name']}** | – | – | – | "
                     f"{r.get('gpu', '–')} | – | {money(r.get('cost'))} "
                     f"| _{r['status']}_ |".replace(" |  |", " |"))
            continue
        biggest = max(r["meshes"].values(),
                      key=lambda m: m.get("faces", 0), default={})
        tex = ("PBR" if biggest.get("pbr")
               else f"{biggest.get('texture_px')}px" if biggest.get("textured")
               else "none")
        t = r.get("wall_sec")
        L.append(
            f"| **{r['name']}** | {r['parts'] or '–'} | {tex} | "
            f"{biggest.get('faces', 0):,} | {r.get('gpu', '–')} | "
            f"{f'{t//60}m{t%60:02d}s' if t else '–'} | {money(r.get('cost'))} |")

    L += ["", "## Per-model detail", ""]
    for key, r in rows.items():
        L += [f"### {r['name']}", "", f"_{r['note']}_", ""]
        if r.get("gpu"):
            L.append(f"- GPU: {r['gpu']} ({r.get('vram', '?')} GB) at "
                     f"${r.get('rate', 0):.2f}/hr")
        if r.get("cost") is not None:
            L.append(f"- Run cost: {money(r['cost'])}")
        if r["status"] != "ok":
            L += [f"- **Status: {r['status']}**", ""]
            continue
        for fname, m in r["meshes"].items():
            if "error" in m:
                L.append(f"- `{fname}`: unreadable ({m['error']})")
            else:
                L.append(
                    f"- `{fname}`: {m['faces']:,} faces, {m['kb']:,} KB, "
                    f"texture {'PBR' if m['pbr'] else (str(m['texture_px']) + 'px' if m['textured'] else 'none')}, "
                    f"{'closed' if not m['boundary'] else str(m['boundary']) + ' boundary edges'}")
        L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="out/bakeoff")
    ap.add_argument("--out", default="out/bakeoff")
    ap.add_argument("--logs", default=None,
                    help="dir holding pc.log / trellis.log / hy21.log / p3sam.log")
    a = ap.parse_args()

    rows = collect(Path(a.raw), Path(a.logs) if a.logs else None)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "COMPARISON.md").write_text(render(rows), encoding="utf-8")
    (out / "comparison.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"wrote {out/'COMPARISON.md'}")
    for k, r in rows.items():
        print(f"  {r['name']:<16} {r['status']:<12} "
              f"parts={r['parts']} cost={money(r.get('cost'))}")


if __name__ == "__main__":
    main()
