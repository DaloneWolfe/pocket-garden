#!/usr/bin/env python3
"""Generate PWA PNG icons from the same mark used in the favicon."""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"


def draw_mark(size: int, padding: int = 0) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Soft paper circle
    inset = padding
    draw.ellipse((inset, inset, size - 1 - inset, size - 1 - inset), fill=(232, 220, 196, 255))

    cx = cy = size / 2
    leaf_color = (63, 107, 78, 255)
    bloom = (232, 160, 184, 255)

    pot = (196, 107, 74, 255)
    pot_edge = (168, 90, 62, 255)
    leaf_w = size * 0.28
    leaf_top = padding + size * 0.14
    pot_top = cy + size * 0.08
    pot_bot = size - padding - size * 0.14
    draw.ellipse(
        (cx - leaf_w * 0.5, cy - size * 0.12, cx + leaf_w * 0.5, pot_top + size * 0.04),
        fill=leaf_color,
    )
    draw.ellipse(
        (cx - leaf_w, leaf_top + size * 0.08, cx + leaf_w, cy + size * 0.1),
        fill=leaf_color,
    )
    r = size * 0.08
    draw.ellipse((cx - r, leaf_top + size * 0.01, cx + r, leaf_top + size * 0.01 + r * 2), fill=bloom)
    rim_h = size * 0.045
    draw.rounded_rectangle(
        (cx - size * 0.2, pot_top, cx + size * 0.2, pot_bot),
        radius=size * 0.03,
        fill=pot,
    )
    draw.rounded_rectangle(
        (cx - size * 0.23, pot_top - rim_h * 0.2, cx + size * 0.23, pot_top + rim_h),
        radius=size * 0.02,
        fill=pot_edge,
    )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size, name, pad in (
        (192, "icon-192.png", 0),
        (512, "icon-512.png", 0),
        (512, "icon-maskable-512.png", 70),
        (180, "apple-touch-icon.png", 0),
    ):
        draw_mark(size, padding=pad).save(OUT / name, "PNG")
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
