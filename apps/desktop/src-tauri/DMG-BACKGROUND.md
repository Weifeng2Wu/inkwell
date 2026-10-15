# DMG Background Image

## Overview

`dmg-background.png` is the background of the macOS DMG installer window. It marks where
the app icon and the Applications folder appear, and shows the drag direction between them.

## Specifications

- **Dimensions**: 660x400 px
- **Format**: PNG
- **Style**: modern minimal — flat surface, hairline dot texture, single accent arrow
- **Colours**: the `light` theme tokens from `apps/desktop/src/styles/themes.css`

| Element | Token | Value |
| --- | --- | --- |
| Surface | `--surface` | `#f8fafc` |
| Instruction text | `--foreground-secondary` | `#334155` |
| Arrow and mark | `--accent` | `#4f46e5` |
| Wordmark | `--muted-foreground` | `#94a3b8` |
| Dot texture, icon guides | derived | `#eef2f7` |

## Design Elements

1. **Dot texture** — 16px grid of 1px dots, barely visible, so the flat area does not read
   as empty.
2. **Icon guides** — faint 52px-radius rings marking the two icon positions.
3. **Arrow** — 5px accent shaft with a 16px triangular head, from the app icon to the
   Applications folder.
4. **Instruction** — "Drag to Applications" in sentence case, sans-serif, centred.
5. **Brand lockup** — the Inkwell teardrop mark plus the "Inkwell" wordmark, centred near
   the bottom edge.

## Icon Positions

Configured in `tauri.conf.json`; the constants in the generator must match.

| Item | Position |
| --- | --- |
| App icon | x=180, y=220 |
| Applications folder | x=480, y=220 |

## Regenerating

```bash
# From the repository root
python3 scripts/generate-dmg-background.py
```

Requires Pillow:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install Pillow
python3 scripts/generate-dmg-background.py
```

The script uses the first available of `SFNS.ttf`, `Helvetica.ttc`, `Arial.ttf`, falling
back to Pillow's bitmap font. Run it on macOS for the intended typography.

## Configuration

`tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "dmg": {
        "background": "dmg-background.png",
        "windowSize": { "width": 660, "height": 400 },
        "appPosition": { "x": 180, "y": 220 },
        "applicationFolderPosition": { "x": 480, "y": 220 }
      }
    }
  }
}
```

The `background` path is resolved relative to the Tauri config directory
(`apps/desktop/src-tauri`), so it is `dmg-background.png` with no extra prefix.

## Design System Compliance

The installer follows `docs/DESIGN.md`: tokens only, no hardcoded palette, no offset
shadows, no corner brackets, no all-caps labels. See the design system for the full token
reference.
