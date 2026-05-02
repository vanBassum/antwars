#!/usr/bin/env python3
"""End-to-end: 2x2 orthographic reference PNG -> textured GLB in assets/models/.

Pipeline:
  1. Split the input PNG into front/back/left/right quadrants (in temp).
  2. Call the local Hunyuan-3D-2.0 Gradio app's /generation_all endpoint
     with the four views; receive a textured GLB.
  3. Run the optimize-glb-for-game pipeline:
       gltfpack simplify -> gltf-transform resize 512 -> gltf-transform center --pivot below
  4. Move the optimized GLB to assets/models/<Name>.glb.
  5. Copy the input sheet to assets/reference/<name_snake>_orthographic_REFERENCE.png.

Dependencies (user-installed, global): gradio_client, Pillow, Node+npx for gltfpack/gltf-transform.
"""

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image
from gradio_client import Client, handle_file

from extract_icons import extract_icon


PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "assets" / "models"
REFERENCE_DIR = PROJECT_ROOT / "assets" / "reference"
ICONS_DIR = PROJECT_ROOT / "assets" / "icons"
DEFAULT_SERVER = "http://127.0.0.1:42003"

NPX = shutil.which("npx") or "npx"


def camel_to_snake(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def split_2x2(src: Path, out_dir: Path) -> dict:
    img = Image.open(src).convert("RGBA")
    w, h = img.size
    qw, qh = w // 2, h // 2
    layout = {
        "front": (0, 0),
        "back": (qw, 0),
        "left": (0, qh),
        "right": (qw, qh),
    }
    out = {}
    for name, (x, y) in layout.items():
        crop = img.crop((x, y, x + qw, y + qh))
        path = out_dir / f"{name}.png"
        crop.save(path)
        out[name] = path
    return out


def generate_via_hunyuan(views: dict, server: str, work: Path,
                         steps: int, octree: int, num_chunks: int,
                         guidance: float) -> Path:
    print(f"[hunyuan] connecting to {server}...", flush=True)
    client = Client(server)
    print(f"[hunyuan] calling /generation_all (steps={steps}, octree={octree}, "
          f"num_chunks={num_chunks}); this typically takes a few minutes...", flush=True)
    result = client.predict(
        caption=None,
        image=None,
        mv_image_front=handle_file(str(views["front"])),
        mv_image_back=handle_file(str(views["back"])),
        mv_image_left=handle_file(str(views["left"])),
        mv_image_right=handle_file(str(views["right"])),
        steps=steps,
        guidance_scale=guidance,
        seed=1234,
        octree_resolution=octree,
        check_box_rembg=True,
        num_chunks=num_chunks,
        randomize_seed=True,
        api_name="/generation_all",
    )
    # Schema: (file_shape, file_textured, output_html, mesh_stats, seed)
    # Both file outputs are FileData dicts of the form {'value': '<abs path>', '__type__': 'update'}.
    def _coerce_to_path(item):
        if item is None:
            return None
        if isinstance(item, str):
            return Path(item) if item else None
        if isinstance(item, dict):
            for key in ("value", "path", "url", "name", "orig_name"):
                v = item.get(key)
                if v:
                    return Path(v)
            return None
        if isinstance(item, (list, tuple)) and item:
            return _coerce_to_path(item[0])
        return None

    # Pick the first output that resolves to an existing GLB. Prefer index 1 (textured),
    # fall back to index 0 (untextured shape).
    textured = None
    for idx in (1, 0):
        candidate = _coerce_to_path(result[idx]) if idx < len(result) else None
        if candidate and candidate.exists() and candidate.suffix.lower() in (".glb", ".gltf"):
            textured = candidate
            print(f"[hunyuan] using result[{idx}]: {textured}", flush=True)
            break
    if textured is None:
        raise RuntimeError(
            f"Hunyuan returned no usable GLB.\nFull result: {result!r}"
        )
    raw = work / "raw.glb"
    shutil.copy(textured, raw)
    print(f"[hunyuan] textured GLB received: {raw.stat().st_size / 1024:.0f} KB", flush=True)
    return raw


def run(cmd: list) -> None:
    print(f"  $ {' '.join(str(c) for c in cmd)}", flush=True)
    subprocess.run(cmd, check=True)


def optimize(raw: Path, work: Path) -> Path:
    s1, s2, s3 = work / "step1.glb", work / "step2.glb", work / "step3.glb"
    print("[optimize] simplify mesh (gltfpack -si 0.05 -slb)...", flush=True)
    run([NPX, "-y", "gltfpack", "-i", str(raw), "-o", str(s1), "-si", "0.05", "-slb"])
    print("[optimize] resize textures to 512...", flush=True)
    run([NPX, "-y", "@gltf-transform/cli", "resize", str(s1), str(s2),
         "--width", "512", "--height", "512"])
    print("[optimize] pivot to bottom-center...", flush=True)
    run([NPX, "-y", "@gltf-transform/cli", "center", str(s2), str(s3),
         "--pivot", "below"])
    return s3


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--input", required=True, type=Path,
                    help="Path to 2x2 orthographic reference PNG")
    ap.add_argument("--name", required=True,
                    help="CamelCase model name, e.g. Crown, SugarBlob")
    ap.add_argument("--server", default=DEFAULT_SERVER,
                    help=f"Hunyuan Gradio server URL (default: {DEFAULT_SERVER})")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--octree", type=int, default=256)
    ap.add_argument("--num-chunks", type=int, default=8000)
    ap.add_argument("--guidance", type=float, default=5.0)
    args = ap.parse_args()

    if not args.input.exists():
        sys.exit(f"Input not found: {args.input}")
    if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", args.name):
        sys.exit(f"--name must be CamelCase, got: {args.name}")

    final_glb = MODELS_DIR / f"{args.name}.glb"
    snake = camel_to_snake(args.name)
    final_ref = REFERENCE_DIR / f"{snake}_orthographic_REFERENCE.png"

    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        work = Path(td)
        views_dir = work / "views"; views_dir.mkdir()

        print(f"[split] {args.input.name} -> 4 quadrants", flush=True)
        views = split_2x2(args.input, views_dir)

        raw = generate_via_hunyuan(
            views, args.server, work,
            steps=args.steps, octree=args.octree,
            num_chunks=args.num_chunks, guidance=args.guidance,
        )
        optimized = optimize(raw, work)
        shutil.move(str(optimized), final_glb)
        if final_ref.exists() and args.input.resolve() == final_ref.resolve():
            print(f"[reference] input is already at {final_ref}, skipping copy", flush=True)
        else:
            shutil.copy(args.input, final_ref)

    # Extract a UI icon from the reference sheet.
    icon_src = final_ref if final_ref.exists() else args.input
    final_icon = extract_icon(icon_src, args.name, ICONS_DIR)

    print()
    print("=== DONE ===", flush=True)
    print(f"  model:     {final_glb} ({final_glb.stat().st_size / 1024:.0f} KB)", flush=True)
    print(f"  reference: {final_ref}", flush=True)
    print(f"  icon:      {final_icon}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
