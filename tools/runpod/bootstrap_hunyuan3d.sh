#!/usr/bin/env bash
# Provision a RunPod pod with Hunyuan3D-2.0 (multiview shape + paint texture).
# Idempotent: safe to re-run; skips work already done on the persistent volume.
set -uo pipefail

WORK=/workspace
REPO="$WORK/Hunyuan3D-2"
STAMP="$WORK/.hunyuan3d_ready${SKIP_TEXGEN:+_shapeonly}"
LOG="$WORK/bootstrap.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== bootstrap start $(date -u +%FT%TZ) ==="

# --- failsafe: self-terminate after MAX_RUNTIME_SEC no matter what ----------
if [ -f "$(dirname "$0")/arm_failsafe.sh" ]; then
  . "$(dirname "$0")/arm_failsafe.sh"
elif [ -f /workspace/arm_failsafe.sh ]; then
  . /workspace/arm_failsafe.sh
else
  echo "[failsafe] WARNING: arm_failsafe.sh not found; NOT armed"
fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

if [ -f "$STAMP" ]; then
  echo "=== already provisioned (found $STAMP), skipping install ==="
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential libgl1 libopengl0 libglib2.0-0 libegl1 libgles2 ninja-build >/dev/null

cd "$WORK"
if [ ! -d "$REPO/.git" ]; then
  git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git "$REPO"
fi
cd "$REPO"

python -c "import torch;print('torch',torch.__version__,'cuda',torch.version.cuda,torch.cuda.is_available())"

pip install -q --upgrade pip
# Install repo deps WITHOUT letting them clobber the image's torch build.
grep -viE '^\s*(torch|torchvision|torchaudio)\b' requirements.txt > /tmp/req.txt
pip install -q -r /tmp/req.txt
pip install -q "huggingface_hub[cli]" onnxruntime rembg pymeshlab trimesh pygltflib

# Hunyuan3D-2's requirements.txt does not pin the HF stack, so pip resolves to
# current releases - and transformers >=5 hard-requires torch >=2.5. This image
# ships torch 2.4.1, so transformers silently DISABLES its whole PyTorch
# backend, and the run dies much later with the very misleading
# "Dinov2Model requires the PyTorch library but it was not found".
# These are the versions the model's own HF Space pins. Install them last so
# they win over whatever requirements.txt pulled in.
pip install -q "transformers==4.46.0" "diffusers==0.30.0" \
               "huggingface_hub==0.35.1" "accelerate==1.1.1" "tokenizers<0.21"
python - <<'PY'
import sys
from transformers.utils import is_torch_available
if not is_torch_available():
    sys.exit("FATAL: transformers cannot see torch - check the version pins above")
print("[ok] transformers sees torch")
PY

# Rasterizer + differentiable renderer are only used by the texture (paint)
# pipeline, and they compile CUDA - the slowest step here by a wide margin.
# SKIP_TEXGEN=1 brings a shape-only pod up in a fraction of the time.
if [ "${SKIP_TEXGEN:-0}" = "1" ]; then
  echo "[skip] texgen CUDA extensions (SKIP_TEXGEN=1)"
else
  ( cd hy3dgen/texgen/custom_rasterizer && pip install -q -e . ) \
    && echo "[ok] custom_rasterizer" || echo "[WARN] custom_rasterizer build failed"
  ( cd hy3dgen/texgen/differentiable_renderer && pip install -q -e . ) \
    && echo "[ok] differentiable_renderer" || echo "[WARN] differentiable_renderer build failed"
fi

# Pre-fetch weights onto the volume so re-runs are instant.
export HF_HOME="$WORK/hf"
mkdir -p "$HF_HOME"
python - <<'PY'
import os
from huggingface_hub import snapshot_download
# multiview shape model (front/back/left/right conditioning)
snapshot_download("tencent/Hunyuan3D-2mv", allow_patterns=["hunyuan3d-dit-v2-mv/*", "*.json", "*.yaml"])
# texture paint pipeline lives in the base 2.0 repo
if os.environ.get("SKIP_TEXGEN") == "1":
    print("skipping paint weights (SKIP_TEXGEN=1)")
else:
    snapshot_download("tencent/Hunyuan3D-2", allow_patterns=["hunyuan3d-paint-v2-0-turbo/*", "hunyuan3d-delight-v2-0/*", "*.json", "*.yaml"])
print("weights ready")
PY

touch "$STAMP"
echo "=== bootstrap done $(date -u +%FT%TZ) ==="
