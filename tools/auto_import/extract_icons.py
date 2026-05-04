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

import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = PROJECT_ROOT / "assets" / "models"
REFERENCE_DIR = PROJECT_ROOT / "assets" / "reference"
ICONS_DIR = PROJECT_ROOT / "assets" / "icons"

ICON_SIZE = 256
BG_TOLERANCE = 28   # RGB-distance below this is fully background (alpha=0)
BG_FEATHER   = 18   # soft cutoff width past tolerance — produces clean edges


def camel_to_snake(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def remove_background(img: Image.Image,
                      tolerance: int = BG_TOLERANCE,
                      feather: int = BG_FEATHER) -> Image.Image:
    """Remove the studio-render background by sampling corner pixels.

    Pixels close to the corner-median color become transparent; pixels
    further away stay opaque. A soft feather range produces anti-aliased
    edges instead of a jagged binary cutout.
    """
    arr = np.array(img.convert("RGBA"), dtype=np.int32)
    h, w = arr.shape[:2]

    # Background color = median of the four corners (robust to one bad corner).
    corners = np.array([arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]])
    bg = np.median(corners[:, :3], axis=0)

    diff = arr[:, :, :3] - bg
    dist = np.sqrt((diff ** 2).sum(axis=2))

    # 0 at dist=tolerance, 255 at dist=tolerance+feather, clipped.
    alpha = np.clip((dist - tolerance) * (255.0 / feather), 0, 255)
    # Combine with any existing alpha (don't promote already-transparent pixels).
    new_alpha = np.minimum(arr[:, :, 3], alpha).astype(np.uint8)

    out = arr.astype(np.uint8)
    out[:, :, 3] = new_alpha
    return Image.fromarray(out, "RGBA")


def extract_icon(ref_path: Path, name: str, out_dir: Path) -> Path:
    """Crop front view from a 2x2 reference sheet, drop the background,
    trim, square, resize, and save."""
    img = Image.open(ref_path).convert("RGBA")
    w, h = img.size
    # Front view is the top-left quadrant.
    front = img.crop((0, 0, w // 2, h // 2))

    # Now actually remove the background colour.
    front = remove_background(front)

    # Trim the transparent padding the bg-removal just introduced.
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
