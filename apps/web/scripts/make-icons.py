"""Draws the PamojaHome app icons into apps/web/public/icons.

Run from apps/web:  python scripts/make-icons.py   (needs Pillow)

The mark is a white house outline with a yellow sun on the brand violet. Each icon is
drawn at 4x and scaled down for smooth edges. The maskable icon keeps the mark inside
the central safe zone so Android can crop it to any shape.
"""
from pathlib import Path
from PIL import Image, ImageDraw

BRAND = (109, 40, 217)   # --color-brand  #6d28d9
SUN = (255, 210, 63)     # --color-sun    #ffd23f
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def draw(size: int, *, rounded: bool, mark_scale: float) -> Image.Image:
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=BRAND)
    else:
        d.rectangle([0, 0, s, s], fill=BRAND)

    # House on a 24-unit grid (same shape as the app's Home icon), centred.
    u = s * mark_scale / 24
    ox = oy = (s - 24 * u) / 2
    p = lambda x, y: (ox + x * u, oy + y * u)
    w = max(1, int(u * 2.1))
    outline = [p(3, 10.5), p(12, 3.5), p(21, 10.5), p(21, 20.5), p(3, 20.5), p(3, 10.5)]
    d.line(outline, fill=WHITE, width=w, joint="curve")
    for pt in outline:  # round the corners
        d.ellipse([pt[0] - w / 2, pt[1] - w / 2, pt[0] + w / 2, pt[1] + w / 2], fill=WHITE)
    door = [p(9.5, 20.5), p(9.5, 15), p(14.5, 15), p(14.5, 20.5)]
    d.line(door, fill=WHITE, width=w, joint="curve")
    for pt in door:
        d.ellipse([pt[0] - w / 2, pt[1] - w / 2, pt[0] + w / 2, pt[1] + w / 2], fill=WHITE)
    # Sun inside the roof.
    cx, cy = p(12, 10.6)
    r = 1.9 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=SUN)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192, rounded=True, mark_scale=0.72).save(OUT / "icon-192.png")
    draw(512, rounded=True, mark_scale=0.72).save(OUT / "icon-512.png")
    draw(512, rounded=False, mark_scale=0.56).save(OUT / "icon-maskable-512.png")
    draw(180, rounded=False, mark_scale=0.66).convert("RGB").save(OUT / "apple-touch-icon.png")
    print("wrote", ", ".join(sorted(f.name for f in OUT.iterdir())))


if __name__ == "__main__":
    main()
