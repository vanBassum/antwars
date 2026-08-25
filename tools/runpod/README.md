# RunPod GPU jobs

On-demand GPU backend for asset generation. Pods are disposable; the
`/workspace` volume keeps the Hunyuan3D install and HF weights so re-runs skip
the ~15 min bootstrap.

## Credentials

`runpod_api.py` reads the key from, in order:

1. `RUNPOD_API_KEY` environment variable
2. `~/.runpod/api_key` (a single line, no quotes)

Create one at <https://console.runpod.io/user/settings> → API Keys (needs
read/write on Pods).

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.runpod" | Out-Null
Set-Content -Encoding ascii "$env:USERPROFILE\.runpod\api_key" "rpa_XXXXXXXX"
```

## Usage

```bash
# what's available and cheap right now (>=24GB, <=$0.60/hr)
python tools/runpod/runpod_api.py gpus

# full job: provision -> install -> generate -> download -> terminate
python tools/runpod/job.py generate \
  --views assets/reference/views_turret --out out/turret --name Turret \
  --steps 50 --octree 384

# safety net
python tools/runpod/job.py status
python tools/runpod/job.py kill-all
```

`--views` must contain `front.png`, `back.png`, `left.png`, `right.png`.

## Cost guards

| Guard | Value | Enforced by |
|---|---|---|
| GPU price | ≤ $0.60/hr | `pick_gpu()` filter, refuses if nothing qualifies |
| Job cost | ≤ $2.00 | worst-case estimate checked before the pod is created |
| Runtime | ≤ 2h | pod-side self-destruct + `finally: terminate_pod()` |
| Concurrency | 1 GPU | `gpuCount: 1`, one pod per job |

The **pod-side self-destruct** is the guard that matters: `bootstrap.sh` arms a
detached `sleep MAX_RUNTIME_SEC && DELETE /pods/$RUNPOD_POD_ID` before doing any
work. A Claude crash, a closed terminal or a dead network cannot leave GPU
compute billing past that window. It requires `RUNPOD_API_KEY` in the pod env,
which `job.py` sets — the key is visible inside your own pod, so use a key you
are willing to rotate.

## Notes

- Image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`. `devel` is
  required — the Hunyuan texture pipeline compiles CUDA extensions
  (`custom_rasterizer`, `differentiable_renderer`) and needs `nvcc`.
- Model: `tencent/Hunyuan3D-2mv` for shape (accepts four view conditioning
  images) + the `tencent/Hunyuan3D-2` paint pipeline for texture.
- If texturing fails the job still returns `mesh_shape.glb` so the run isn't
  wasted; check the log before re-running.
- `--pod-id <id>` attaches to a pod that is already up instead of creating one
  (useful when iterating after a failure — combine with `--keep`).
