#!/usr/bin/env bash
# Provision PartCrafter (NeurIPS 2025) - part-level 3D generation from ONE image.
# https://github.com/wgsxm/PartCrafter
#
# Unlike Hunyuan3D this emits N separate part meshes directly, with no
# segmentation step, which is exactly the shape of the turret problem.
set -uo pipefail

WORK=/workspace
REPO="$WORK/PartCrafter"
STAMP="$WORK/.partcrafter_ready"
LOG="$WORK/bootstrap_partcrafter.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== partcrafter bootstrap start $(date -u +%FT%TZ) ==="

if [ -f "$(dirname "$0")/arm_failsafe.sh" ]; then . "$(dirname "$0")/arm_failsafe.sh"
elif [ -f /workspace/arm_failsafe.sh ]; then . /workspace/arm_failsafe.sh
else echo "[failsafe] WARNING: arm_failsafe.sh not found; NOT armed"; fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
[ -f "$STAMP" ] && { echo "=== already provisioned ==="; exit 0; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential libegl1 libgl1 libglib2.0-0 \
  libgles2 libosmesa6 ninja-build >/dev/null

cd "$WORK"
[ -d "$REPO/.git" ] || git clone --depth 1 https://github.com/wgsxm/PartCrafter.git "$REPO"
cd "$REPO"

TORCH_VER=$(python -c "import torch;print(torch.__version__.split('+')[0])")
CU=$(python -c "import torch;print('cu'+torch.version.cuda.replace('.',''))")
echo "[env] torch=$TORCH_VER $CU"

pip install -q --upgrade pip
# torch-cluster has no source fallback worth waiting for; prebuilt wheel only.
pip install -q torch-cluster -f "https://data.pyg.org/whl/torch-${TORCH_VER}+${CU}.html" \
  || echo "[WARN] torch-cluster wheel unavailable for torch ${TORCH_VER}+${CU}"

# Its requirements.txt pins nothing for the HF stack. That is the same trap
# that silently disabled transformers' torch backend on the Hunyuan pod, so
# strip the heavy unpinned entries and install known-workable versions after.
grep -viE '^\s*(torch|torchvision|torchaudio|deepspeed|wandb|google-genai)\b' \
  settings/requirements.txt > /tmp/pc_req.txt
pip install -q -r /tmp/pc_req.txt
pip install -q "numpy==1.26.4"

check_stack() {
  python - <<'PY'
import sys
import torch, transformers, diffusers
from transformers.utils import is_torch_available
print(f"[env] torch={torch.__version__} transformers={transformers.__version__} "
      f"diffusers={diffusers.__version__}")
sys.exit(0 if is_torch_available() else 1)
PY
}

if ! check_stack; then
  # transformers >=5 requires torch >=2.5 and silently disables its whole torch
  # backend otherwise, surfacing much later as "X requires the PyTorch library
  # but it was not found". Fall back to the last 4.x line.
  echo "[WARN] transformers cannot see torch - pinning to the 4.x line"
  pip install -q "transformers==4.46.0" "diffusers==0.30.0" \
                 "huggingface_hub==0.35.1" "tokenizers<0.21"
  check_stack || { echo "FATAL: transformers still cannot see torch"; exit 1; }
fi
echo "[ok] transformers sees torch"

touch "$STAMP"
echo "=== partcrafter bootstrap done $(date -u +%FT%TZ) ==="
