---
name: optimize-glb-for-game
description: Simplify a high-poly GLB mesh and downscale its embedded textures so it's usable as a real-time game asset, then place it in assets/models/. Use when the user has a freshly generated GLB in their Downloads folder (typically `textured_mesh.glb` from a 3D-mesh-from-image pipeline) and asks to "put it through the same treatment", "make it usable in the game", "process the new model", or similar.
---

# Optimize a generated GLB for use in the game

The engine uses plain `GLTFLoader` (no Meshopt or Draco decoder registered — see [engine/model_cache.js](../../../engine/model_cache.js) and [engine/components/model_renderer.js](../../../engine/components/model_renderer.js)), so any optimizations have to produce a vanilla GLB. The pipeline does three things:

1. **Mesh simplification** with `gltfpack` (no compression flags).
2. **Texture downscale** to 512×512 with `@gltf-transform/cli resize` (keeps PNG/JPEG, no KTX2).
3. **Pivot to bottom-center** with `@gltf-transform/cli center --pivot below` so the lowest vertex sits at y=0 — lets the engine place models directly at terrain height with `yOffset: 0`.

All run via `npx -y` so no global install is required.

## Inputs

- **Source**: usually `C:/Users/basvi/Downloads/textured_mesh.glb` — that's what the local mesh-from-image pipeline produces. The user typically refers to it as "the new mesh" / "the model I just added".
- **Target name**: derived from the user's wording. Match the existing CamelCase convention in [assets/models/](../../../assets/models/) (e.g. `WatchTower.glb`, `AntHill.glb`, `SugarNode.glb`, `Ant.glb`).

## Steps

1. **Confirm the source.** `ls C:/Users/basvi/Downloads -t | head -3` and verify the most recent `.glb` is the intended file. The local mesh puller always names its output `textured_mesh.glb`, overwriting the previous one — so there should normally be exactly one.

2. **Run the pipeline below in PowerShell.** Always write intermediate AND final output to `$env:TEMP` first, then `Move-Item` the final result into `assets/models/`. Do **not** let `gltf-transform` write directly into `assets/models/` — a previous run deleted unrelated `.glb` files in the same directory when invoked that way.

3. **Report stats** to the user: input triangle count, output triangle count, input file size, output file size. The user cares about the reduction ratio.

4. **Delete the source** from `Downloads/` once the final asset is in place — the mesh puller reuses the same filename, so leftover files cause confusion next time. Only do this after confirming the final GLB exists at the target path.

5. **Don't auto-register the entity.** Adding the model to `ENTITY_DEFS` in [game/entities.js](../../../game/entities.js) is a separate, deliberate step the user does when they're ready to spawn it. Mention that as a follow-up but don't do it unprompted.

## Pipeline (PowerShell)

```powershell
$src   = "C:\Users\basvi\Downloads\textured_mesh.glb"
$name  = "<CamelCaseName>"   # e.g. "Ant", "SugarNode"
$step1 = "$env:TEMP\${name}_step1.glb"
$step2 = "$env:TEMP\${name}_step2.glb"
$step3 = "$env:TEMP\${name}_step3.glb"
$final = "c:\Workspace\antwars\assets\models\${name}.glb"

# Step 1: simplify mesh. -si 0.05 targets 5% of original tris;
# -slb allows border simplification so the simplifier can push past UV-seam floors.
# No -cc / -tc / -tu — those need decoders the engine doesn't register.
npx -y gltfpack -i $src -o $step1 -si 0.05 -slb -v

# Step 2: cap embedded texture at 512x512. Keeps the original PNG/JPEG codec
# (gltf-transform's resize doesn't force KTX2 the way `gltfpack -tl` does).
npx -y @gltf-transform/cli resize $step1 $step2 --width 512 --height 512

# Step 3: move the pivot to bottom-center so the model sits on the ground
# when placed at terrain.y. Lets EntityDef.yOffset stay 0 for normal cases.
npx -y @gltf-transform/cli center $step2 $step3 --pivot below

# Step 4: atomically move into assets/models. NEVER let any previous step
# write directly into c:\Workspace\antwars\assets\models — see notes below.
Move-Item $step3 $final -Force
Remove-Item $step1,$step2 -ErrorAction SilentlyContinue

Get-Item $src,$final | Select-Object Name,@{N='SizeKB';E={[int]($_.Length/1KB)}}
```

After verifying `$final` exists, delete the source: `Remove-Item $src`.

## Tuning the simplification

The `-si 0.05 -slb` defaults give good results for the asset class so far:

| Asset       | Input tris | Output tris | Reduction |
|-------------|-----------:|------------:|----------:|
| Sugar node  |     40,000 |       8,732 |    ~4.6x  |
| Ant         |     40,000 |       2,730 |    ~15x   |

The simplifier won't go below the floor imposed by UV seams and material boundaries — pushing `-si` lower than 0.05 won't help once you hit it. If the user wants a much lower count and the simplifier won't cooperate, try `-si 0.02 -slb` or fall back to manual remeshing in Blender.

For heavily instanced units (e.g. ants — many on screen at once), aim lower (~2–3k tris). For one-off props (towers, hills), 5–10k is fine.

## Why the "TEMP first, then Move-Item" rule matters

When `gltf-transform resize` was invoked with its output path pointed directly at `assets/models/Ant.glb`, two unrelated GLB files in the same directory (`AntHill.glb`, `WatchTower.glb`) were deleted as a side effect. Recovery was via `git restore`, but the safe pattern is: build the final output in `$env:TEMP`, then `Move-Item` it across. That way the `assets/models/` directory is only touched by a single atomic file move that names exactly the file you intend to write.

## What this skill does NOT do

- Does not register the entity in `ENTITY_DEFS`.
- Does not compress textures with KTX2 / Basis (would require `KTX2Loader` + `MeshoptDecoder` to be wired into the engine first).
- Does not handle skinned/animated meshes — the meshes from the local puller are static. If the input has skins or animations, stop and ask the user.
