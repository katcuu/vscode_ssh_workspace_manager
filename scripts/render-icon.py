"""Raster export of the simple server/folder mark in media/icon.svg (requires Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw


scale = 4
image = Image.new("RGBA", (128 * scale, 128 * scale))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 128 * scale - 1, 128 * scale - 1), radius=26 * scale, fill="#142D3B")
color = "#88D6CD"
stroke = round(1.6 * 4 * scale)


def point(x, y):
    return ((16 + 4 * x) * scale, (16 + 4 * y) * scale)


def line(points):
    transformed = [point(x, y) for x, y in points]
    draw.line(transformed, fill=color, width=stroke, joint="curve")
    for x, y in transformed:
        radius = stroke / 2
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


# The rounded rectangle is drawn inside an expanded box to keep its SVG centerline.
x1, y1 = point(4, 3)
x2, y2 = point(20, 9)
half = stroke / 2
draw.rounded_rectangle((x1 - half, y1 - half, x2 + half, y2 + half), radius=(1.5 + .8) * 4 * scale, fill=color)
draw.rounded_rectangle((x1 + half, y1 + half, x2 - half, y2 - half), radius=(1.5 - .8) * 4 * scale, fill="#142D3B")
line([(11, 6), (16, 6)])
x, y = point(7.5, 6)
radius = .9 * 4 * scale
draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
line([(3.5, 12.5), (9.5, 12.5), (11.5, 14.5), (20.5, 14.5), (20.5, 20.5), (3.5, 20.5), (3.5, 12.5)])
image.resize((128, 128), Image.Resampling.LANCZOS).save(Path(__file__).resolve().parents[1] / "media/icon.png")
