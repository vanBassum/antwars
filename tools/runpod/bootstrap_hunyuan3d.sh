#!/usr/bin/env bash
# Provision a RunPod pod with Hunyuan3D-2.0 (multiview shape + paint texture).
# Idempotent: safe to re-run; skips work already done on the persistent volume.
set -uo pipefail

WORK=/workspace
REPO="$WORK/Hunyuan3D-2"
STAMP="$WORK/.hunyuan3d_ready"
LOG="$WORK/bootstrap.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== bootstrap start $(date -u +%FT%TZ) ==="

# --- failsafe: self-terminate the pod after MAX_RUNTIME_SEC no matter what ----
# Independent of the controlling Claude/ssh process. Survives disconnects.
if [ -n "${RUNPOD_API_KEY:-}" ] && [ -n "${RUNPOD_POD_ID:-}" ]; then
  if [ ! -f /tmp/.selfdestruct_armed ]; then
    touch /tmp/.selfdestruct_armed
    setsid nohup bash -c "
      sleep ${MAX_RUNTIME_SEC:-7200}
      echo 'FAILSAFE: max runtime reached, terminating pod' >> $LOG
      curl -s -X DELETE -H 'Authorization: Bearer ${RUNPOD_API_KEY}'         https://rest.runpod.io/v1/pods/${RUNPOD_POD_ID}
    " >/dev/null 2>&1 < /dev/null &
    disown || true
    echo "[failsafe] self-destruct armed: ${MAX_RUNTIME_SEC:-7200}s from now"
  else
    echo "[failsafe] already armed"
  fi
else
  echo "[failsafe] WARNING: RUNPOD_API_KEY/RUNPOD_POD_ID not set in pod env; no self-destruct"
fi

nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

if [ -f "$STAMP" ]; then
  echo "=== already provisioned (found $STAMP), skipping install ==="
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git build-essential libgl1 libglib2.0-0 libegl1 libgles2 ninja-build >/dev/null

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

# Rasterizer + differentiable renderer are needed by the texture (paint) pipeline.
( cd hy3dgen/texgen/custom_rasterizer && pip install -q -e . ) \
  && echo "[ok] custom_rasterizer" || echo "[WARN] custom_rasterizer build failed"
( cd hy3dgen/texgen/differentiable_renderer && pip install -q -e . ) \
  && echo "[ok] differentiable_renderer" || echo "[WARN] differentiable_renderer build failed"

# Pre-fetch weights onto the volume so re-runs are instant.
export HF_HOME="$WORK/hf"
mkdir -p "$HF_HOME"
python - <<'PY'
from huggingface_hub import snapshot_download
# multiview shape model (front/back/left/right conditioning)
snapshot_download("tencent/Hunyuan3D-2mv", allow_patterns=["hunyuan3d-dit-v2-mv/*", "*.json", "*.yaml"])
# texture paint pipeline lives in the base 2.0 repo
snapshot_download("tencent/Hunyuan3D-2", allow_patterns=["hunyuan3d-paint-v2-0-turbo/*", "hunyuan3d-delight-v2-0/*", "*.json", "*.yaml"])
print("weights ready")
PY

touch "$STAMP"
echo "=== bootstrap done $(date -u +%FT%TZ) ==="
