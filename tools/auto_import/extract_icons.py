#!/usr/bin/env python3
"""Extract UI icons from orthographic reference sheets.

For each reference sheet, crops the front view (top-left quadrant),
trims transparent padding, and resizes to a square icon PNG.

Usage:
  # Batch — all reference sheets whose model exists:
  python extract_icons.py

  # Single — explicit reference + name:
  python extract_icons.py --input path/to/ref.png --name SugarNode
"""

import argparse
import re
import sys
from pathlib import Path

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "assets" / "models"
REFERENCE_DIR = PROJECT_ROOT / "assets" / "reference"
ICONS_DIR = PROJECT_ROOT / "assets" / "icons"

ICON_SIZE = 256


def camel_to_snake(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def extract_icon(ref_path: Path, name: str, out_dir: Path) -> Path:
    """Crop front view from a 2x2 reference sheet, trim, resize, and save."""
    img = Image.open(ref_path).convert("RGBA")
    w, h = img.size
    # Front view is the top-left quadrant.
    front = img.crop((0, 0, w // 2, h // 2))

    # Trim transparent padding.
    bbox = front.getbbox()
    if bbox:
        front = front.crop(bbox)

    # Pad to square, then resize.
    side = max(front.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - front.width) // 2
    oy = (side - front.height) // 2
    square.paste(front, (ox, oy))
    icon = square.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{name}.png"
    icon.save(out_path, "PNG")
    return out_path


def _find_reference(name: str, ref_dir: Path) -> Path | None:
    """Find the reference sheet for a CamelCase model name.

    Tries the underscored form first (e.g. AntHill -> ant_hill), then falls
    back to the collapsed form (anthill) to handle compound-word filenames.
    """
    snake = camel_to_snake(name)
    for candidate in (snake, snake.replace("_", "")):
        ref = ref_dir / f"{candidate}_orthographic_REFERENCE.png"
        if ref.exists():
            return ref
    return None


def batch(out_dir: Path, ref_dir: Path | None = None) -> int:
    """Extract icons for every model that has a matching reference sheet."""
    ref_dir = ref_dir or REFERENCE_DIR
    count = 0
    for glb in sorted(MODELS_DIR.glob("*.glb")):
        name = glb.stem  # CamelCase, e.g. "SugarNode"
        ref = _find_reference(name, ref_dir)
        if not ref:
            print(f"  skip {name} (no reference sheet)", flush=True)
            continue
        out = extract_icon(ref, name, out_dir)
        print(f"  {name}: {out}", flush=True)
        count += 1
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--input", type=Path, help="Single reference PNG")
    ap.add_argument("--name", help="CamelCase model name (required with --input)")
    ap.add_argument("--out-dir", type=Path, default=ICONS_DIR,
                    help=f"Output directory (default: {ICONS_DIR})")
    ap.add_argument("--ref-dir", type=Path, default=REFERENCE_DIR,
                    help=f"Reference sheet directory (default: {REFERENCE_DIR})")
    args = ap.parse_args()

    if args.input:
        if not args.name:
            sys.exit("--name is required with --input")
        if not args.input.exists():
            sys.exit(f"Input not found: {args.input}")
        out = extract_icon(args.input, args.name, args.out_dir)
        print(f"Icon saved: {out}", flush=True)
    else:
        print(f"Batch extracting icons to {args.out_dir}...", flush=True)
        n = batch(args.out_dir, args.ref_dir)
        print(f"\nDone — {n} icons extracted.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
