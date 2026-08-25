# Turret 3D generation — handoff

State as of **2026-08-25 16:30 local**. Everything below is in git; nothing
needed to continue lives only on the machine this was started from.

## What is finished and delivered

**Hunyuan3D-2.0** produced the turret that is actually usable today. Results are
in [`out/turret/`](out/turret/) with their own README:

| folder | what it is |
|---|---|
| `00_reference/` | the matted view images fed to the model |
| `01_whole_object/` | the turret as one mesh, textured and untextured |
| `02_approach_A_split_from_whole/` | cut into Base/Head/Gun **(recommended)** |
| `03_approach_C_generated_separately/` | each component generated independently |
| `04_game_ready/` | approach A, decimated + texture-capped |

Numbers: 1,957,236 faces at octree 384 in 48s, decimated to 80k, textured in
17-23s with a 2048px baseColorTexture. Game-ready set is 7,478 / 1,967 / 687
faces at 475 / 374 / 348 KB. Run cost ≈ $0.32.

`turret_raw_predecimation.glb` (35 MB) is deliberately **not** committed. It is
regenerable and not worth versioning.

## What was in flight when this session ended

Four bake-off pods were running. **They do not survive this session.** The pod
writes to `/workspace/job/out` and the *local* python process downloads it, so
losing the local process loses the result even though the pod ran fine. Expect
to relaunch all of these from scratch.

| model | state at cutoff | verdict |
|---|---|---|
| Hunyuan3D-2.1 | bootstrapping, furthest along | closest to a result |
| P3-SAM | cycling through hosts on the CUDA gate | fast once it starts |
| PartCrafter | fresh pod, slow pip resolve (~15 min) | needs ~40 min total |
| TRELLIS.2 | compiling 5 CUDA extensions | needs ~60-90 min |

Spend on the whole session so far ≈ **$0.55**, nearly all provisioning and
dependency installs rather than inference.

## Relaunching the bake-off

`assets/reference/` is gitignored, so on a fresh clone restore it first from the
copy committed with the results — otherwise every command below has no input:

```bash
mkdir -p assets/reference && cp -r out/turret/00_reference/* assets/reference/
```

Each run is then one command. They are independent; run one or all.

```bash
# P3-SAM — segments the turret we ALREADY have, no regeneration
python -u tools/runpod/job.py run \
  --name bakeoff-p3sam --attempts 8 \
  --bootstrap tools/runpod/bootstrap_p3sam.sh \
  --script tools/runpod/remote_p3sam.py \
  --upload out/turret/01_whole_object/turret_untextured.glb \
  --cmd "PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True python /workspace/remote_p3sam.py --mesh /workspace/job/in/turret_untextured.glb --out /workspace/job/out --point-num 50000 --prompt-num 200" \
  --out out/bakeoff/p3sam --max-runtime 3600 --volume 60

# PartCrafter — generates 3 parts natively from one image
python -u tools/runpod/job.py run \
  --name bakeoff-partcrafter --attempts 8 \
  --image "runpod/pytorch:1.1.0-cu1281-torch260-ubuntu2204" \
  --bootstrap tools/runpod/bootstrap_partcrafter.sh \
  --upload assets/reference/views_turret/front.png \
  --cmd "cd /workspace/PartCrafter && python scripts/inference_partcrafter.py --image_path /workspace/job/in/front.png --num_parts 3 --tag turret --output_dir /workspace/job/out --num_inference_steps 50" \
  --out out/bakeoff/partcrafter --max-runtime 4200 --volume 60

# TRELLIS.2 — 4B, PBR materials. SLOW to provision.
python -u tools/runpod/job.py run \
  --name bakeoff-trellis2 --attempts 8 \
  --image "runpod/pytorch:1.1.0-cu1281-torch260-ubuntu2204" \
  --bootstrap tools/runpod/bootstrap_trellis2.sh \
  --script tools/runpod/remote_trellis2.py \
  --upload assets/reference/views_turret/front.png \
  --cmd "python /workspace/remote_trellis2.py --image /workspace/job/in/front.png --out /workspace/job/out" \
  --out out/bakeoff/trellis2 --max-runtime 5400 --volume 100

# Hunyuan3D-2.1 — shape only (see the 48GB note below)
python -u tools/runpod/job.py run \
  --name bakeoff-hunyuan21 --attempts 8 --shape-only \
  --bootstrap tools/runpod/bootstrap_hunyuan21.sh \
  --script tools/runpod/remote_hunyuan21.py \
  --upload assets/reference/views_turret/front.png \
  --cmd "python /workspace/remote_hunyuan21.py --image /workspace/job/in/front.png --out /workspace/job/out --no-texture --octree 384 --target-faces 80000" \
  --out out/bakeoff/hunyuan21 --max-runtime 2700 --volume 80
```

Then build the comparison table (it reads the confirmed billing rate and wall
clock out of the job logs, so the cost column is what was really paid):

```bash
python tools/collect_bakeoff.py --raw out/bakeoff --out out/bakeoff --logs <dir-with-the-job-logs>
```

## Setup on a new machine

1. `RUNPOD_API_KEY` in the environment, or the key in `~/.runpod/api_key`.
2. An SSH keypair at `~/.ssh/runpod_ed25519` — `job.py` generates one on first
   run if absent, so nothing to copy across.
3. `python -u tools/runpod/job.py status` should list pods (probably none).
4. `assets/reference/` is **gitignored** — restore it from `out/turret/00_reference/`
   (see the Relaunching section), or regenerate from the original sheet with
   `python tools/make_turret_views.py`. Without it the bake-off relaunches
   have no input images.

## Safety model — read before running anything

Three independent layers stop a pod outliving its job:

1. `PodSession` terminates on every exit path, including an exception during
   provisioning (fixed in `0ced8da` — Python does not call `__exit__` when
   `__enter__` raises, which leaked a billing pod).
2. A **detached local watchdog** DELETEs the pod after `--max-runtime`.
   Survives the launching process dying. **Does not survive the machine going
   away.**
3. The pod arms its **own** kill timer in `arm_failsafe.sh`, run the moment SSH
   becomes reachable (`5971c5d`). Survives everything except the pod losing
   network — including the controlling machine going away entirely.

Layer 3 used to be armed at the top of each bootstrap, which left a window where
a pod cycling in the CUDA gate had only the local watchdog protecting it. That
is closed, but it is still worth checking before you walk away — a pod that
never got as far as SSH has no layer 3. **Before shutting a machine down:**

```bash
python -u tools/runpod/job.py status     # see what is live
python -u tools/runpod/job.py kill-all   # stop everything
```

## Cost limits in force

`$0.60/hr` per GPU, `$2.00` per job, community cloud only. `job.py` checks the
**confirmed** rate after creation, not the estimate, and terminates immediately
if it is over. Running four pods at once was explicitly approved and lands
around $1.10-1.40/hr aggregate.

## Known constraints and open work

- **48 GB is currently unaffordable.** Hunyuan3D-2.1's PBR texture pass needs
  ~48 GB. The cheapest 48 GB community card right now is an **L40 at $0.690/hr**,
  above the cap; A40 shows no stock. So 2.1 runs shape-only. This was previously
  noted as "A6000 at ~$0.33/hr" — that is no longer true of the catalogue.
- **P3-SAM does not fit on 24 GB, and the obvious knobs do not help.** It OOMs
  in `predict_aabb` with ~19.6 GB already resident when it asks for another
  6.10 GB. Halving both `--point-num` (100k -> 50k) and `--prompt-num`
  (400 -> 200) changed the failure *not at all*: two runs, one at full settings
  and one at half, failed with 19.67/6.10 GB and 19.57/6.10 GB respectively.
  The 6.10 GB request is a fixed-size allocation that those arguments do not
  influence, so tuning them is a dead end — do not spend another run on it.
  `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` was set for the second
  attempt and also made no difference.

  Untried, in rough order of promise:
  1. Feed it a **smaller mesh**. Both attempts used the 80k-face turret. If the
     allocation scales with face or vertex count, a 20k-face decimation may fit,
     and the labels transfer back onto the full mesh anyway — that is exactly
     what `tools/apply_p3sam_parts.py` does, by nearest-face-centroid.
  2. Check whether `AutoMask` honours these arguments at all, or whether it
     carries its own internal defaults. Read `P3-SAM/demo/auto_mask.py` before
     the next paid run rather than after it.
  3. A 48 GB card — blocked on price, see the note above.
- **Cut planes do not generalise.** `split_turret_parts.py` assumes the joint is
  a plane perpendicular to a world axis and each part is contiguous in its
  half-space. That already broke on this model — `--gun-radius` exists only
  because the antenna and ammo hose reach past the mantlet. It will not work on
  a tank with two tracks or anything with left/right symmetry. P3-SAM and
  PartCrafter are the general replacements; neither gives a *rig*, only unnamed
  segments.
- **Cut seams are not capped.** `fill_holes()` only closes small simple loops;
  a plane cut leaves long irregular boundaries it will not touch. The code
  reports this honestly rather than claiming success. Real fix needs boundary
  triangulation.
- **`38.65.239.x` hands out dead GPUs.** They pass `nvidia-smi` but fail CUDA
  init. The gate catches it in 75s and rotates; use `--attempts 8` so three
  rotations cannot exhaust themselves inside one bad cluster.
- **Deferred:** a frontend that uploads images to an already-warm pod and
  downloads results, closing the pod when done. Keeping the model resident saves
  ~50s per generation.

## Home machine (RTX 4070 12 GB / 16 GB RAM / 2 TB NVMe)

Measured on a 3090, so treat as indicative:

| stage | peak VRAM | peak RAM | fits? |
|---|---|---|---|
| shape gen (octree 384) | 8.4 GB | 16.3 GB | VRAM yes, RAM over |
| texture | 13.1 GB | 14.6 GB | over by ~1.1 GB |

Octree 256 (791k faces) roughly halves RAM. Weights are 34 GB on disk — a
non-issue on 2 TB. Untested CPU-offload modes might bring texture under 12 GB.
