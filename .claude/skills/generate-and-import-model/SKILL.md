---
name: generate-and-import-model
description: Generate a 3D model from a 2×2 orthographic reference image (front/back/left/right) using the local Hunyuan-3D-2.0 server and import it as a game-ready GLB. Use when the user has placed a new reference sheet in their Downloads folder and asks to make/generate/import a model from it (e.g. "make me a crown model", "generate the watchtower from this image", "import the new image as a barrel").
---

# Generate-and-import a model from one reference image

End-to-end replacement for the manual Hunyuan UI workflow:

```
Downloads/<sheet>.png  ──▶  split into 4 views
                       ──▶  POST to local Hunyuan-3D-2.0 (/generation_all)
                       ──▶  download textured GLB
                       ──▶  optimize-glb-for-game pipeline
                       ──▶  assets/models/<Name>.glb
                            assets/reference/<name>_orthographic_REFERENCE.png
```

The orchestrator script lives at [tools/auto_import/generate_and_import.py](../../../tools/auto_import/generate_and_import.py).

## Prerequisites (one-time, already set up on the user's machine)

- Hunyuan-3D-2.0 Gradio server running locally — default `http://127.0.0.1:42003`. Verify with `curl -s http://127.0.0.1:42003/config` (returns JSON with `"title":"Hunyuan-3D-2.0"`).
- Python with `gradio_client` and `Pillow` (`pip install gradio_client pillow`).
- Node + `npx` for `gltfpack` and `@gltf-transform/cli` (the optimize-glb-for-game skill already uses these).

If the Gradio server isn't responding, stop and tell the user — don't retry; they need to start it manually.

## Inputs

- **Source sheet**: typically the most recent `ChatGPT Image *.png` in `C:/Users/basvi/Downloads/`. Confirm with `ls C:/Users/basvi/Downloads -t | head -3` and Read it to verify it's a 2×2 grid before running. Each quadrant becomes a view.
- **Model name**: derived from the user's wording. Use CamelCase, matching existing entries in [assets/models/](../../../assets/models/) (e.g. `WatchTower`, `AntHill`, `SugarNode`, `SugarBlob`, `Egg`, `Ant`, `Crown`).

## Steps

1. **Confirm** the latest Downloads PNG is what the user means and that it's a 2×2 grid. If the layout differs (e.g. ChatGPT produced a 1×4 strip or a single view), stop and ask.

2. **Run the orchestrator** with absolute paths:

   ```powershell
   python c:\Workspace\antwars\tools\auto_import\generate_and_import.py `
     --input "C:\Users\basvi\Downloads\<filename>.png" `
     --name <CamelCaseName>
   ```

   Generation typically takes 1–5 minutes (mostly the Hunyuan diffusion + texturing). Don't poll or interrupt — Gradio streams progress events; let the script run to completion.

3. **Verify** the script printed `=== DONE ===` and the listed file sizes look sane (a few hundred KB for a typical small prop). Then `git -C c:\Workspace\antwars status assets/models/` to confirm only the intended file changed (defense against the side-effect-deletion bug noted in the optimize-glb-for-game skill).

4. **Don't auto-register** the entity. Adding it to `ENTITY_DEFS` in [engine/entity_registry.js](../../../engine/entity_registry.js) is a separate, deliberate step.

## What the script does

- Splits the 2×2 sheet in row-major order: top-left=front, top-right=back, bottom-left=left, bottom-right=right. Hunyuan handles modest mismatches in axis labeling — for highly directional subjects (visible front feature like a face or gem), the user can fix orientation by editing the input or rotating the GLB in the editor afterwards.
- Calls `/generation_all` with these defaults: `steps=30`, `guidance=5.0`, `octree=256`, `num_chunks=8000`, `randomize_seed=True`, `remove_background=True`. Override via `--steps`, `--octree`, `--num-chunks`, `--guidance`.
- Runs the same three-step optimize pipeline as the [optimize-glb-for-game](../optimize-glb-for-game/SKILL.md) skill: `gltfpack -si 0.05 -slb`, `gltf-transform resize 512`, `gltf-transform center --pivot below`.
- Writes the final GLB to `assets/models/<Name>.glb` and copies the original sheet to `assets/reference/<name>_orthographic_REFERENCE.png` (snake_case derived from the CamelCase name). The temp split images are discarded.
- Does **not** delete the source PNG from Downloads — the user may want to keep it for revisions or re-runs.

## Tunables (when defaults aren't enough)

| Issue | Try |
|---|---|
| Model is blobby or missing detail | `--octree 384` or `--steps 50` |
| Looks great but very slow | `--octree 192` |
| Run out of GPU memory | `--num-chunks 4000` |
| Texture color is off | regenerate; the diffusion is stochastic when `randomize_seed=True` |

## Failure modes

- **`Connection refused`** at 127.0.0.1:42003 — the Hunyuan server isn't running. Stop and ask the user to start it.
- **`predict` hangs or times out** — Hunyuan generation can legitimately take 5+ minutes on a slow GPU. Wait. If it really hangs (>10 min with no progress), check the Gradio app's terminal for errors.
- **Output GLB has flipped axes** — the row-major split assumed wrong views. Either rotate in the editor or have the user regenerate the source image with views in the expected positions.
- **`gltf-transform` deletes other files in `assets/models/`** — known intermittent bug from earlier sessions. The script writes through TEMP and uses an explicit `Move-Item`-equivalent (`shutil.move`) for the final step, so this should not recur. If it does, recover with `git restore assets/models/<deleted>.glb`.
