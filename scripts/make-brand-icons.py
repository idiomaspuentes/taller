"""
Draws the app icons (public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png) from the
shapes of the Taller isotype (public/brand/taller-isotipo-*.svg): an arch, a circle and a door, on the brand blue.

    python scripts/make-brand-icons.py

The shapes are the SVG path written out as geometry (it uses only arcs and straight lines), drawn at 4x and
scaled down for smooth edges. Needs Pillow.
"""
from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (0x1C, 0x6F, 0xE5)
WHITE = (255, 255, 255)
PUBLIC = Path(__file__).resolve().parent.parent / "public"
SUPER = 4  # supersampling


def mark_mask(size: int) -> Image.Image:
    """The white isotype on a transparent square of `size` px, centered the way the icon SVG does (scale 0.4)."""
    big = size * SUPER
    scale = 0.4 * big / 1024
    cx, cy = 512 * big / 1024, 470.9 * big / 1024

    def pt(x, y):
        return (cx + x * scale, cy + y * scale)

    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)

    def disk(x, y, r, fill):
        (x0, y0), (x1, y1) = pt(x - r, y - r), pt(x + r, y + r)
        d.ellipse([x0, y0, x1, y1], fill=fill)

    def rect(x0, y0, x1, y1, fill):
        d.rectangle([*pt(x0, y0), *pt(x1, y1)], fill=fill)

    def arch(r, fill):
        # Half disk above y=240.5 plus the straight sides down to y=692.
        disk(0, 240.5, r, fill)
        rect(-r - 1, 240.5, r + 1, 2000, 0)  # clear the lower half of the disk (it reaches far below 692)
        rect(-r, 240.5, r, 692, fill)

    arch(727, 255)  # outer
    arch(560, 0)  # inner: leaves a band
    disk(0, 0, 152.5, 255)  # the circle
    # The door: a half disk on a rectangle.
    disk(0, 472, 152.5, 255)
    rect(-153, 472, 153, 692.5, 0)
    rect(-152.5, 472, 152.5, 692, 255)
    # Re-draw the door's rounded top (the clear above removed its lower half only).
    return mask.resize((size, size), Image.LANCZOS)


def icon(size: int, rounded: bool) -> Image.Image:
    big = size * SUPER
    base = Image.new("RGBA", (big, big), BLUE + (255,))
    if rounded:
        corner = Image.new("L", (big, big), 0)
        ImageDraw.Draw(corner).rounded_rectangle([0, 0, big - 1, big - 1], radius=round(230 / 1024 * big), fill=255)
        base.putalpha(corner)
    base = base.resize((size, size), Image.LANCZOS)
    mark = mark_mask(size)
    white = Image.new("RGBA", (size, size), WHITE + (255,))
    base.paste(white, (0, 0), mark)
    return base


if __name__ == "__main__":
    outputs = {
        "icon-192.png": icon(192, rounded=True),
        "icon-512.png": icon(512, rounded=True),
        # Maskable and Apple icons are full-bleed squares: the system cuts and rounds them.
        "icon-maskable-512.png": icon(512, rounded=False),
        "apple-touch-icon.png": icon(180, rounded=False),
    }
    for name, image in outputs.items():
        image.save(PUBLIC / name, optimize=True)
        print("wrote", name, image.size)
