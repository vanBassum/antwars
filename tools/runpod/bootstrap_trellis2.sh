#!/usr/bin/env bash
# Provision TRELLIS.2 (Microsoft) - image-to-3D via an O-Voxel sparse structure,
# 4B params, outputs PBR materials rather than a single baked colour map.
# https://github.com/microsoft/TRELLIS
set -uo pipefail

WORK=/workspace
REPO="$WORK/TRELLIS2"
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
  libgles2 libosmesa6 ninja-build >/dev/null

TORCH_VER=$(python -c "import torch;print(torch.__version__.split('+')[0])")
CU=$(python -c "import torch;print('cu'+torch.version.cuda.replace('.',''))")
echo "[env] torch=$TORCH_VER $CU"

cd "$WORK"
[ -d "$REPO/.git" ] || git clone --recurse-submodules \
  https://github.com/microsoft/TRELLIS.git "$REPO"
cd "$REPO"

pip install -q --upgrade pip
pip install -q pillow imageio imageio-ffmpeg tqdm easydict opencv-python-headless \
  scipy rembg onnxruntime trimesh xatlas pyvista pymeshfix igraph "numpy<2"

# TRELLIS' sparse backend: it can use either spconv or its own flash attention
# path. spconv is the one with prebuilt wheels for every cuda line, so prefer it
# and tell the runtime explicitly rather than letting it probe and guess.
pip install -q "spconv-${CU}" || pip install -q spconv-cu124 || echo "[WARN] spconv"
pip install -q utils3d || echo "[WARN] utils3d"

# The rasteriser and voxeliser are CUDA extensions. --no-build-isolation because
# both setup.py files import torch.utils.cpp_extension, which the isolated build
# env does not have (the same trap that broke Hunyuan's texgen build).
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
export TORCH_CUDA_ARCH_LIST="$(python -c "
import torch; c=torch.cuda.get_device_capability(); print(f'{c[0]}.{c[1]}+PTX')")"
echo "[env] CUDA_HOME=$CUDA_HOME arch=$TORCH_CUDA_ARCH_LIST"

for ext in extensions/vox2seq; do
  if [ -d "$ext" ]; then
    echo "[build] $ext"
    pip install -q --no-build-isolation -e "$ext" || echo "[WARN] $ext failed"
  fi
done

pip install -q --no-build-isolation \
  git+https://github.com/NVlabs/nvdiffrast.git || echo "[WARN] nvdiffrast"
pip install -q --no-build-isolation \
  git+https://github.com/JeffreyXiang/diffoctreerast.git || echo "[WARN] diffoctreerast"

# Pre-fetch weights so the paid run does not spend its first minutes downloading.
python - <<'PY'
from huggingface_hub import snapshot_download
for repo in ("microsoft/TRELLIS.2", "microsoft/TRELLIS-image-large"):
    try:
        p = snapshot_download(repo_id=repo, allow_patterns=["**"])
        print(f"[ok] weights {repo}: {p}")
        break
    except Exception as e:
        print(f"[info] {repo} unavailable: {str(e)[:200]}")
PY

python -c "
import sys; sys.path.insert(0,'$REPO')
import torch, trimesh
print('[ok] torch', torch.__version__, 'cuda', torch.cuda.is_available())
" || { echo "FATAL: base stack broken - see $LOG"; exit 1; }

touch "$STAMP"
echo "=== trellis2 bootstrap done $(date -u +%FT%TZ) ==="
