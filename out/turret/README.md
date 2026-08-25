# Turret generation run

Generated from `assets/reference/turret_orthographic_REFERENCE.png`
with **Hunyuan3D-2.0** (`hunyuan3d-dit-v2-mv`, four-view conditioning)
plus its paint pipeline for texture, on a RunPod RTX 3090.

## Folders

| folder | what it is |
|---|---|
| `00_reference/` | the view images fed to the model, background already removed |
| `01_whole_object/` | the turret as a single mesh, straight from the model |
| `02_approach_A_split_from_whole/` | that mesh cut into Base/Head/Gun **(recommended)** |
| `03_approach_C_generated_separately/` | each component generated independently, for comparison |
| `04_game_ready/` | approach A, decimated and texture-capped for the engine |

## The two approaches

**A - split from whole** generates one turret and cuts it at the
turntable ring and the mantlet. The parts fit together perfectly because
they were never apart, and the style is consistent. Cut planes were
measured from the mesh: base/head at `y=-0.2`, mantlet at
`z=0.33` within `r=0.17` of the barrel axis.

**C - generated separately** runs the model three times on cropped views.
Each part has cleaner topology, but they do not share a scale or an
origin, so assembling them is manual work.

## Animation rig (approach A)

`Turret.glb` carries the hierarchy `Base > Head > Gun`, each part
re-origined at its pivot:

| part | pivot | intended motion |
|---|---|---|
| Base | bottom centre, sits on `y=0` | static |
| Head | turntable centre | yaw about local Y |
| Gun | breech, on the barrel axis | spin about local Z, pitch about local X |

The individual `Turret_<part>.glb` files hold the same geometry with the
same origins, if you would rather assemble them yourself.

## Measurements

| file | faces | size | closed mesh |
|---|---|---|---|
| `turret_textured.glb` | 80,000 | 4,843 KB | no (32334 edges) |
| `turret_untextured.glb` | 80,000 | 1,403 KB | yes |
| `turret_raw_predecimation.glb` | 1,957,236 | 34,402 KB | no (0 edges) |
| `A/Turret.glb` | 73,978 | 4,633 KB | no (25580 edges) |
| `A/Turret_Base.glb` | 52,564 | 4,099 KB | no (18530 edges) |
| `A/Turret_Gun.glb` | 2,951 | 2,856 KB | no (1035 edges) |
| `A/Turret_Head.glb` | 18,463 | 3,240 KB | no (6015 edges) |
| `C/Base.glb` | 40,000 | 3,602 KB | no (19608 edges) |
| `C/Head.glb` | 40,000 | 3,514 KB | no (13398 edges) |
| `C/Gun.glb` | 40,000 | 3,334 KB | no (11024 edges) |
| `game/Turret_Base.glb` | 7,478 | 475 KB | no (7972 edges) |
| `game/Turret_Gun.glb` | 687 | 348 KB | no (593 edges) |
| `game/Turret_Head.glb` | 1,967 | 374 KB | no (2123 edges) |

"Closed mesh" matters because an open boundary reads as a hole when the
part rotates away from its neighbour. The cut faces are capped, so the
split parts are closed even though the cuts left them open.

## Known limitations

- The gun is a smooth cylinder rather than six resolved barrels. The
  reference sheet shows the muzzle head-on as a flat disc, so there is
  little for the model to reconstruct. A hand-made barrel cluster would
  also spin true about its axis, which matters for a minigun.
- Texture is baked colour, not PBR. Hunyuan3D-2.1 outputs
  albedo/metallic/roughness but needs a 48 GB card for its texture pass.

Regenerate with `tools/runpod/job.py turret` and re-collect with
`tools/collect_turret_run.py`.