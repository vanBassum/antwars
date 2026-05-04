---
name: split-reference-sheet
description: Split a 2×2 orthographic reference sheet from Downloads into front/back/left/right images under assets/reference/. Use when the user says they have a new image with four views of a model (e.g. "I have a new image of the anthill, cut it like before") for use as 3D modeling reference in this game.
---

# Split orthographic reference sheet

This repo uses ChatGPT-generated 2×2 view sheets (front/back/left/right) as reference art for the GLB models in [assets/models/](../../../assets/models/). The split images live in [assets/reference/](../../../assets/reference/).

## Inputs

- **Source image**: usually the most recent `ChatGPT Image *.png` in `C:/Users/basvi/Downloads/`. The user typically refers to it as "the image I just added" / "the new <thing> picture".
- **Subject name**: derived from the user's wording (e.g. "ant hill" → `anthill`, "sugar node" → `sugar_node`, "watch tower" → `watchtower`). Match the snake_case convention already used in `assets/reference/`.

## Steps

1. **Locate the image.** `ls C:/Users/basvi/Downloads -t | head -5` and pick the most recent ChatGPT-generated PNG. Confirm with the Read tool that it's a 2×2 grid of orthographic views before splitting.

2. **Copy the original** to `assets/reference/<subject>_orthographic_REFERENCE.png`. The `_REFERENCE` suffix flags it as source art for 3D modeling, not a runtime asset.

3. **Split into four quadrants** using PowerShell + `System.Drawing` (no extra dependencies). Width and height come from the source image; quadrants are width/2 × height/2. Output filenames: `<subject>_front.png`, `<subject>_back.png`, `<subject>_left.png`, `<subject>_right.png`.

4. **Map quadrants to view names.** Default mapping is row-major:
   - top-left → front
   - top-right → back
   - bottom-left → left
   - bottom-right → right

   When the subject is directional (e.g. has an obvious face, door, or asymmetric feature), inspect the quadrants and override the mapping based on what's visible — e.g. an ant facing the viewer's left exposes its right side, so that quadrant becomes `*_right.png`. Tell the user which mapping you used and offer to rename if it doesn't match their modeling axes.

## Reference PowerShell snippet

```powershell
$src = "<absolute path to source PNG>"
$dstDir = "c:\Workspace\antwars\assets\reference"
$subject = "<snake_case_name>"
Copy-Item $src "$dstDir\${subject}_orthographic_REFERENCE.png" -Force

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($src)
$w = $img.Width / 2
$h = $img.Height / 2

$quadrants = @(
    @{ name = "${subject}_front.png"; x = 0;  y = 0  },
    @{ name = "${subject}_back.png";  x = $w; y = 0  },
    @{ name = "${subject}_left.png";  x = 0;  y = $h },
    @{ name = "${subject}_right.png"; x = $w; y = $h }
)
foreach ($q in $quadrants) {
    $bmp = New-Object System.Drawing.Bitmap ([int]$w), ([int]$h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $srcRect = New-Object System.Drawing.Rectangle ([int]$q.x), ([int]$q.y), ([int]$w), ([int]$h)
    $dstRect = New-Object System.Drawing.Rectangle 0, 0, ([int]$w), ([int]$h)
    $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $bmp.Save("$dstDir\$($q.name)", [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}
$img.Dispose()
```

## Notes

- Don't delete the source from Downloads unless the user asks — they may want it for other purposes.
- If the source isn't a 2×2 grid (e.g. ChatGPT produced a single view or a 1×4 strip), stop and ask the user how to handle it.
- Source images so far have all been 1254×1254, but read dimensions from the file rather than hardcoding.
