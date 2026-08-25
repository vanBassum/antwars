#!/usr/bin/env bash
# Provision Hunyuan3D-2.1 - the successor to the 2.0 pipeline this project
# currently ships. Its selling point over 2.0 is PBR output (albedo / metallic /
# roughness) instead of one baked colour map.
#
# SHAPE_ONLY=1 skips the paint pipeline. The 2.1 texture pass wants ~48GB, and
# 48GB cards are currently above the $0.60/hr budget, so shape-only is the mode
# that actually fits the cost cap on a 24GB card.
set -uo pipefail

WORK=/workspace
REPO="$WORK/Hunyuan3D-2.1"
# Exported, not just set: the weights-prefetch python block below reads it from
# the environment to decide whether to pull the paint weights.
export SHAPE_ONLY="${SHAPE_ONLY:-${SKIP_TEXGEN:-0}}"
STAMP="$WORK/.hunyuan21_ready$([ "$SHAPE_ONLY" = 1 ] && echo _shapeonly)"
LOG="$WORK/bootstrap_hunyuan21.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== hunyuan3d-2.1 bootstrap start $(date -u +%FT%TZ) (shape_only=$SHAPE_ONLY) ==="

if [ -f "$(dirname "$0")/arm_failsafe.sh" ]; then . "$(dirname "$0")/arm_failsafe.sh"
elif [ -f /workspace/arm_failsafe.sh ]; then . /workspace/arm_failsafe.sh
else echo "[failsafe] WARNING: arm_failsafe.sh not found; NOT armed"; fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
[ -f "$STAMP" ] && { echo "=== already provisioned ==="; exit 0; }

export HF_HOME="$WORK/hf"
mkdir -p "$HF_HOME"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# libopengl0 matters: without it pymeshlab's Qt plugins fail to load and it
# loses its mesh IMPORTERS, surfacing as "Unknown format for load: ply".
apt-get install -y -qq git build-essential libgl1 libopengl0 libglib2.0-0 \
  libegl1 libgles2 ninja-build >/dev/null

cd "$WORK"
[ -d "$REPO/.git" ] || git clone --depth 1 \
  https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git "$REPO"
cd "$REPO"

python -c "import torch;print('[env] torch',torch.__version__,'cuda',torch.version.cuda,torch.cuda.is_available())"

pip install -q --upgrade pip
grep -viE '^\s*(torch|torchvision|torchaudio|bpy)\b' requirements.txt > /tmp/req21.txt
# pip is all-or-nothing: ONE unresolvable pin means NOTHING in the file gets
# installed. bpy==4.0 has no wheel for py>=3.11 (only 4.2.0+), which silently
# took out einops and the rest, surfacing 35 min later as "No module named
# 'einops'" at inference. Filtered above; checked here so a future bad pin
# costs two minutes instead of a whole paid run.
if ! pip install -q -r /tmp/req21.txt; then
  echo "[warn] bulk requirements install failed - see the log for the bad pin"
  pip install -q einops omegaconf safetensors numpy scipy tqdm pyyaml opencv-python-headless scikit-image torchdiffeq || { echo "FATAL: minimal shape-gen subset failed"; exit 1; }
fi
# Belt and braces: what shape-only generation actually imports. Explicit so a
# partial requirements failure cannot hide them again.
pip install -q einops omegaconf || { echo "FATAL: einops/omegaconf unavailable"; exit 1; }
pip install -q "huggingface_hub[cli]" onnxruntime rembg pymeshlab trimesh pygltflib

# Same trap as 2.0: requirements.txt does not pin the HF stack, transformers >=5
# hard-requires torch >=2.5, and against an older torch it silently disables its
# entire PyTorch backend - surfacing much later as "Dinov2Model requires the
# PyTorch library but it was not found". Pin last so these win.
if python -c "
import torch,sys
v=tuple(int(x) for x in torch.__version__.split('+')[0].split('.')[:2])
sys.exit(0 if v < (2,5) else 1)"; then
  echo "[pin] torch <2.5 detected - pinning the 4.x transformers line"
  pip install -q "transformers==4.46.0" "diffusers==0.30.0" \
                 "huggingface_hub==0.35.1" "accelerate==1.1.1" "tokenizers<0.21"
fi

python - <<'PY'
import sys
from transformers.utils import is_torch_available
print(f"[env] transformers sees torch: {is_torch_available()}")
sys.exit(0 if is_torch_available() else 1)
PY
[ $? -ne 0 ] && { echo "FATAL: transformers cannot see torch"; exit 1; }

export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export TORCH_CUDA_ARCH_LIST="$(python -c "
import torch; c=torch.cuda.get_device_capability(); print(f'{c[0]}.{c[1]}+PTX')")"
echo "[env] CUDA_HOME=$CUDA_HOME arch=$TORCH_CUDA_ARCH_LIST"

if [ "$SHAPE_ONLY" != 1 ]; then
  # The paint pipeline's CUDA extensions. --no-build-isolation because both
  # setup.py files import torch.utils.cpp_extension, which pip's isolated build
  # env does not have.
  for d in hy3dpaint/custom_rasterizer hy3dpaint/DifferentiableRenderer; do
    if [ -d "$d" ]; then
      echo "[build] $d"
      ( cd "$d" && pip install -q --no-build-isolation -e . ) \
        || { echo "FATAL: $d failed to build"; exit 1; }
    fi
  done
  # Import torch FIRST: custom_rasterizer links against libc10.so and fails with
  # "libc10.so: cannot open shared object file" if imported standalone.
  python -c "
import torch, custom_rasterizer
print('[ok] custom_rasterizer built against torch', torch.__version__)" \
    || { echo "FATAL: custom_rasterizer unimportable"; exit 1; }
fi

# Pre-fetch weights so the paid run does not start with a download.
python - <<'PY'
import os
from huggingface_hub import snapshot_download
shape_only = os.environ.get("SHAPE_ONLY") == "1"
pats = ["hunyuan3d-dit-v2-1/**"] if shape_only else ["**"]
p = snapshot_download(repo_id="tencent/Hunyuan3D-2.1", allow_patterns=pats)
print("[ok] weights:", p)
PY

touch "$STAMP"
echo "=== hunyuan3d-2.1 bootstrap done $(date -u +%FT%TZ) ==="
