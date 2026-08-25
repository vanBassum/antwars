#!/usr/bin/env bash
# Provision TRELLIS.2 (Microsoft) - image-to-3D, 4B params, O-Voxel sparse
# structure, PBR material output.
#
#   repo:    github.com/microsoft/TRELLIS.2   (NOT microsoft/TRELLIS, which is v1
#                                              and has a completely different API)
#   weights: microsoft/TRELLIS.2-4B
#   python:  trellis2 + o_voxel
#
# Installation goes through the repo's own setup.sh rather than a hand-written
# package list. A hand-rolled list was tried first and was wrong in four
# separate ways (missing transformers, missing huggingface_hub, an unpinned
# utils3d that cannot resolve, and a vox2seq path that does not exist in this
# repo). setup.sh is the tested path; use it.
set -uo pipefail

WORK=/workspace
REPO="$WORK/TRELLIS.2"
STAMP="$WORK/.trellis2_ready"
LOG="$WORK/bootstrap_trellis2.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== trellis2 bootstrap start $(date -u +%FT%TZ) ==="

if [ -f "$(dirname "$0")/arm_failsafe.sh" ]; then . "$(dirname "$0")/arm_failsafe.sh"
elif [ -f /workspace/arm_failsafe.sh ]; then . /workspace/arm_failsafe.sh
else echo "[failsafe] WARNING: arm_failsafe.sh not found; NOT armed"; fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
[ -f "$STAMP" ] && { echo "=== already provisioned ==="; exit 0; }

export HF_HOME="$WORK/hf"
mkdir -p "$HF_HOME"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential libgl1 libglib2.0-0 libegl1 \
  libgles2 libosmesa6 ninja-build cmake >/dev/null

cd "$WORK"
[ -d "$REPO/.git" ] || git clone --recurse-submodules \
  https://github.com/microsoft/TRELLIS.2.git "$REPO"
cd "$REPO"
git submodule update --init --recursive 2>/dev/null || true

TORCH_VER=$(python -c "import torch;print(torch.__version__.split('+')[0])" 2>/dev/null || echo none)
CU=$(python -c "import torch;print('cu'+torch.version.cuda.replace('.',''))" 2>/dev/null || echo none)
PY=$(python -c "import sys;print(f'cp{sys.version_info.major}{sys.version_info.minor}')")
echo "[env] torch=$TORCH_VER $CU $PY"

export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export TORCH_CUDA_ARCH_LIST="$(python -c "
import torch; c=torch.cuda.get_device_capability(); print(f'{c[0]}.{c[1]}+PTX')" 2>/dev/null || echo '8.9+PTX')"
export MAX_JOBS="${MAX_JOBS:-$(nproc)}"
echo "[env] CUDA_HOME=$CUDA_HOME arch=$TORCH_CUDA_ARCH_LIST jobs=$MAX_JOBS"

# setup.sh --flash-attn does `pip install flash-attn==2.7.3`, which falls back to
# a source build costing 30+ min of billed GPU time. Land a prebuilt wheel first
# so pip sees the requirement already satisfied.
if ! python -c "import flash_attn" 2>/dev/null; then
  TORCH_MM=$(python -c "import torch;print('.'.join(torch.__version__.split('+')[0].split('.')[:2]))")
  WHL="flash_attn-2.7.4.post1+cu12torch${TORCH_MM}cxx11abiFALSE-${PY}-${PY}-linux_x86_64.whl"
  URL="https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/${WHL}"
  echo "[flash-attn] trying prebuilt $WHL"
  pip install -q "$URL" || echo "[WARN] no prebuilt flash-attn; setup.sh may build from source"
fi

echo "[setup] running the repo's own installer (this compiles several CUDA extensions)"
bash setup.sh --basic --flash-attn --cumesh --o-voxel --flexgemm --nvdiffrast --nvdiffrec
echo "[setup] setup.sh exited $?"

# setup.sh does not install huggingface_hub explicitly; from_pretrained needs it.
pip install -q huggingface_hub

echo "--- import check ---"
python - <<'PY'
import importlib, sys
need = ["torch", "transformers", "huggingface_hub", "trellis2", "o_voxel"]
bad = []
for m in need:
    try:
        importlib.import_module(m)
        print(f"  ok   {m}")
    except Exception as e:
        print(f"  MISS {m}: {type(e).__name__}: {str(e)[:140]}")
        bad.append(m)
# Optional accelerators - report but do not fail on them.
for m in ("flash_attn", "nvdiffrast", "cumesh", "flexgemm"):
    try:
        importlib.import_module(m); print(f"  ok   {m} (optional)")
    except Exception as e:
        print(f"  --   {m} unavailable ({type(e).__name__})")
sys.exit(1 if bad else 0)
PY
[ $? -ne 0 ] && { echo "FATAL: required imports missing - see $LOG"; exit 1; }

# Pre-fetch the 4B weights so the paid run does not open with a download.
python - <<'PY'
from huggingface_hub import snapshot_download
p = snapshot_download(repo_id="microsoft/TRELLIS.2-4B")
print("[ok] weights:", p)
PY

touch "$STAMP"
echo "=== trellis2 bootstrap done $(date -u +%FT%TZ) ==="
