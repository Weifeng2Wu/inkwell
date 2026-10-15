#!/usr/bin/env python3
"""
Generate the macOS DMG installer background for Inkwell.

Style: modern minimal. Flat surface, hairline dot texture, a single accent-coloured
arrow, and sans-serif type. Colours mirror the `light` theme in
`apps/desktop/src/styles/themes.css`.

Run from the repository root:

    python3 scripts/generate-dmg-background.py
"""

import os

from PIL import Image, ImageDraw, ImageFont

# Dimensions — must match bundle.macOS.dmg.windowSize in tauri.conf.json
WIDTH = 660
HEIGHT = 400

# Colors (light theme tokens)
SURFACE = (248, 250, 252)  # --surface
FOREGROUND = (15, 23, 42)  # --foreground
FOREGROUND_SECONDARY = (51, 65, 85)  # --foreground-secondary
MUTED_FOREGROUND = (148, 163, 184)  # --muted-foreground
ACCENT = (79, 70, 229)  # --accent
DOT = (238, 242, 247)  # hairline texture

# Icon positions — must match appPosition / applicationFolderPosition in tauri.conf.json
APP_ICON = (180, 220)
APPS_FOLDER = (480, 220)

FONT_CANDIDATES = (
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
)


def load_font(size):
    """Return the first available system font at the given size."""
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_dot_texture(draw):
    """Barely-visible dot grid, to keep a large flat area from reading as empty."""
    spacing = 16
    for y in range(spacing // 2, HEIGHT, spacing):
        for x in range(spacing // 2, WIDTH, spacing):
            draw.ellipse([x, y, x + 1, y + 1], fill=DOT)


def draw_icon_guides(draw):
    """Faint rings marking where the app icon and Applications folder land."""
    radius = 52
    for cx, cy in (APP_ICON, APPS_FOLDER):
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            outline=DOT,
            width=1,
        )


def draw_arrow(draw):
    """Accent arrow from the app icon to the Applications folder."""
    arrow_y = APP_ICON[1]
    start_x = APP_ICON[0] + 74
    end_x = APPS_FOLDER[0] - 74
    shaft = 5
    head = 16

    draw.rectangle(
        [start_x, arrow_y - shaft // 2, end_x - head, arrow_y + shaft // 2],
        fill=ACCENT,
    )
    draw.polygon(
        [
            (end_x, arrow_y),
            (end_x - head, arrow_y - head),
            (end_x - head, arrow_y + head),
        ],
        fill=ACCENT,
    )


def draw_droplet(draw, cx, cy, radius):
    """Inkwell mark: a teardrop built from a circle plus tangent lines to an apex."""
    apex_y = cy - radius * 1.9
    # Tangent points for an apex 1.9r above the circle centre.
    tangent_dx = radius * 0.851
    tangent_y = cy - radius * 0.526

    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=ACCENT)
    draw.polygon(
        [
            (cx, apex_y),
            (cx - tangent_dx, tangent_y),
            (cx + tangent_dx, tangent_y),
        ],
        fill=ACCENT,
    )


def draw_text(draw, text, font, fill, y):
    """Draw text horizontally centred, with `y` as the top of the text box."""
    bbox = draw.textbbox((0, 0), text, font=font)
    width = bbox[2] - bbox[0]
    draw.text(((WIDTH - width) // 2 - bbox[0], y), text, fill=fill, font=font)
    return width


def generate_dmg_background(output_path):
    img = Image.new("RGB", (WIDTH, HEIGHT), SURFACE)
    draw = ImageDraw.Draw(img)

    draw_dot_texture(draw)
    draw_icon_guides(draw)
    draw_arrow(draw)

    instruction_font = load_font(21)
    draw_text(draw, "Drag to Applications", instruction_font, FOREGROUND_SECONDARY, 88)

    # Brand lockup: mark plus wordmark, centred near the bottom edge.
    brand_font = load_font(16)
    bbox = draw.textbbox((0, 0), "Inkwell", font=brand_font)
    text_width = bbox[2] - bbox[0]
    mark_radius = 5
    mark_width = mark_radius * 2.6
    gap = 9
    total = mark_width + gap + text_width
    start_x = (WIDTH - total) // 2
    brand_y = HEIGHT - 54

    draw_droplet(draw, int(start_x + mark_width / 2), brand_y + 9, mark_radius)
    draw.text(
        (start_x + mark_width + gap - bbox[0], brand_y),
        "Inkwell",
        fill=MUTED_FOREGROUND,
        font=brand_font,
    )

    img.save(output_path, "PNG")
    return output_path


if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    output_path = os.path.join(project_root, "apps/desktop/src-tauri/dmg-background.png")

    result = generate_dmg_background(output_path)

    print(f"DMG background saved to: {result}")
    print(f"  Dimensions: {WIDTH}x{HEIGHT}")
    print("  Style: modern minimal (light theme tokens)")
