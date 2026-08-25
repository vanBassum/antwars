#!/usr/bin/env bash
# Provision Hunyuan3D-Part (P3-SAM) for native 3D part segmentation.
# Self-contained: runs either alongside bootstrap_hunyuan3d.sh on a shared pod,
# or on a pod of its own against a mesh generated in some earlier run.
set -uo pipefail

WORK=/workspace
REPO="$WORK/Hunyuan3D-Part"
STAMP="$WORK/.p3sam_ready"
LOG="$WORK/bootstrap_p3sam.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== p3sam bootstrap start $(date -u +%FT%TZ) ==="

# Arm the self-destruct here too. This used to rely on bootstrap_hunyuan3d.sh
# having armed it earlier on a shared pod; on its own pod that never happens and
# a stall would leave the GPU billing with nothing to stop it.
if [ -f "$(dirname "$0")/arm_failsafe.sh" ]; then . "$(dirname "$0")/arm_failsafe.sh"
elif [ -f /workspace/arm_failsafe.sh ]; then . /workspace/arm_failsafe.sh
else echo "[failsafe] WARNING: arm_failsafe.sh not found; NOT armed"; fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

if [ -f "$STAMP" ]; then
  echo "=== already provisioned, skipping ==="
  exit 0
fi

export HF_HOME="$WORK/hf"
mkdir -p "$HF_HOME"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential libgl1 libglib2.0-0 ninja-build >/dev/null

TORCH_VER=$(python -c "import torch;print(torch.__version__.split('+')[0])")
CU=$(python -c "import torch;print('cu'+torch.version.cuda.replace('.',''))")
PY=$(python -c "import sys;print(f'cp{sys.version_info.major}{sys.version_info.minor}')")
echo "[env] torch=$TORCH_VER $CU $PY"

cd "$WORK"
[ -d "$REPO/.git" ] || git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-Part.git "$REPO"

pip install -q viser fpsample numba timm addict easydict scikit-image scikit-learn \
  omegaconf trimesh "numpy<2"

# spconv + torch_scatter: sonata's backbone needs both. Prebuilt wheels only.
pip install -q "spconv-${CU}" || pip install -q spconv-cu124 || echo "[WARN] spconv"
pip install -q torch_scatter torch_cluster \
  -f "https://data.pyg.org/whl/torch-${TORCH_VER}+${CU}.html" || echo "[WARN] torch_scatter"

# flash-attn: sonata asserts on it when enable_flash=True. Prebuilt wheel only -
# a source build costs 30+ min of GPU time we are paying for.
if ! python -c "import flash_attn" 2>/dev/null; then
  TORCH_MM=$(python -c "import torch;print('.'.join(torch.__version__.split('+')[0].split('.')[:2]))")
  WHL="flash_attn-2.7.4.post1+cu12torch${TORCH_MM}cxx11abiFALSE-${PY}-${PY}-linux_x86_64.whl"
  URL="https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/${WHL}"
  echo "[flash-attn] trying $WHL"
  pip install -q "$URL" || echo "[WARN] no prebuilt flash-attn; will fall back to enable_flash=False"
fi
python -c "import flash_attn;print('[ok] flash_attn',flash_attn.__version__)" 2>/dev/null \
  || echo "[info] flash_attn unavailable"

# chamfer3D is only used by the interactive app, not by auto_mask - best effort.
( cd "$REPO/P3-SAM/utils/chamfer3D" && pip install -q -e . ) >/dev/null 2>&1 \
  && echo "[ok] chamfer3D" || echo "[info] chamfer3D skipped (not needed for auto_mask)"

# Pre-fetch weights: p3sam checkpoint + the sonata backbone.
python - <<'PY'
import os
from huggingface_hub import hf_hub_download
p = hf_hub_download(repo_id="tencent/Hunyuan3D-Part", filename="p3sam/p3sam.safetensors")
print("[ok] p3sam weights:", p)
PY

# Check the import we actually use (auto_mask), not just the model module, and
# hard-fail on it: a bootstrap that "succeeds" into an unimportable env just
# moves the failure to the paid part of the run.
python -c "
import sys; sys.path.insert(0,'$REPO/P3-SAM'); sys.path.insert(0,'$REPO/P3-SAM/demo')
import torch
from auto_mask import AutoMask, set_seed
print('[ok] auto_mask imports resolve; torch', torch.__version__)
" || { echo "FATAL: P3-SAM import failed - see $LOG"; exit 1; }

touch "$STAMP"
echo "=== p3sam bootstrap done $(date -u +%FT%TZ) ==="
