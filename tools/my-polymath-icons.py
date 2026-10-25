#!/usr/bin/env python3
"""📲 My Polymath — the install icons, cut from the official Polymath logo (My Polymath v1.3.0).

The student dashboard (student/, polymathlc.com.sg/student) is installable as
"My Polymath". Until v1.2.0 its icon was a grid of four coloured squares drawn
by the install kit's make-icons.mjs; from v1.3.0 it is the Polymath Learning
Centre logo itself — the supplied sticker artwork in
assets/branding/polymath-learning-centre.png, UNCHANGED (never redrawn, never
re-lettered, aspect ratio kept), set on a tile in the logo's own two teals.

Why the whole sticker and not just the M mark:
  * the Science portal (the repository root) already installs with the bare M
    mark on white (assets/app-icons/), and a student who installs both would
    otherwise get two identical icons side by side on the home screen;
  * the white sticker on the teal tile reads as "Polymath" at a glance, and the
    wordmark is large enough to read at home-screen size (about 120 px and up).
The 32 px browser-tab icon is the exception: no wordmark survives 32 px, so the
favicon is the M mark alone, cut from the same artwork.

Files written into student/assets/app-icons/ (the names the kit and the
manifest already use, so nothing else has to move):
    icon-192.png, icon-512.png          purpose "any"      sticker on the teal tile
    maskable-192.png, maskable-512.png  purpose "maskable" the same, with EVERY visible
                                                           pixel of the sticker inside
                                                           the 80 % safe circle
    apple-touch-icon.png (180)          iPhone / iPad      opaque (iOS paints alpha black)
    favicon-32.png                      browser tab        the M mark on transparent
and the offline page's inline icon (student/offline.html, a data: URI, because
the kit's service worker answers page loads only — an icon FILE could never
arrive with no connection) is replaced with the new 192 px icon, byte for byte.

Run from anywhere after changing the logo or the tile colours:

    python3 tools/my-polymath-icons.py

then run  node --test tools/pwa-install-tests.mjs tools/student-dashboard-tests.mjs
The dashboard test decodes these PNGs itself and holds them to this file's
rules: the right sizes, opaque where they must be, the teal tile in the
corners, the logo's white sticker and its magenta in the middle, nothing but
tile outside a maskable icon's safe circle, and the offline page carrying the
very same picture as icon-192.png.

Needs Pillow, NumPy and SciPy (pip install --break-system-packages pillow numpy scipy).
"""
from __future__ import annotations

import base64
import io
import re
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
    from scipy import ndimage
except ImportError as error:  # pragma: no cover - a setup problem, not a logic one
    sys.exit('my-polymath-icons.py needs Pillow, NumPy and SciPy: ' + str(error))

REPO = Path(__file__).resolve().parent.parent
LOGO = REPO / 'assets' / 'branding' / 'polymath-learning-centre.png'
STUDENT = REPO / 'student'
OUT = STUDENT / 'assets' / 'app-icons'
OFFLINE = STUDENT / 'offline.html'

# The tile: a diagonal blend between the logo's own two teals — the light face
# of the M (#57C4D0) at the top left, its shaded top face (#2E9CA6) at the
# bottom right. No colour outside the identity is introduced.
# tools/student-dashboard-tests.mjs repeats these two colours and the blend; keep them in step.
TEAL_LIGHT = (0x57, 0xC4, 0xD0)
TEAL_DEEP = (0x2E, 0x9C, 0xA6)
BLEND_DOWN = 0.6      # share of the blend that runs top → bottom
BLEND_ACROSS = 0.4    # share that runs left → right

# How much of the tile the sticker spans (its wider side) on an "any" icon.
# Browsers draw an "any" icon as it is and iOS only rounds its corners, so the
# sticker just has to keep clear of the rounding.
ANY_SPAN = 0.88
# A maskable icon may be cut to any shape that contains the centred circle of
# radius 40 % of the side (the W3C safe zone); the sticker, shadow included,
# stays entirely inside it.
SAFE_RADIUS = 0.40
# The favicon's M mark spans this much of the 32 px square.
FAVICON_SPAN = 0.96

# Everything is drawn at WORK px and shrunk in one LANCZOS step per size.
WORK = 1024

# "Colourful" = the logo's teals and magentas, as opposed to the sticker's white
# body and its grey shadow. Max − min channel; the palest logo colour (#57C4D0)
# scores 121, the sticker's white 0, its shadow 0.
COLOURFUL = 60


def load_logo() -> Image.Image:
    """The sticker exactly as supplied, cropped to its own visible pixels."""
    logo = Image.open(LOGO).convert('RGBA')
    box = logo.getbbox()
    if not box:
        sys.exit('the logo is empty: ' + str(LOGO))
    return logo.crop(box)


def cut_mark(logo: Image.Image) -> Image.Image:
    """The M mark alone, for the 32 px favicon.

    The mark is the one connected block of colour that holds the logo's bright
    magenta face (#EC008C) — the lettering is separate blocks, and its magenta
    ("LEARNING CENTRE") is the darker #B5196A, so it can never be the seed.
    Faces of the mark meet along anti-aliased seams, so the colour mask is
    closed by two pixels before it is labelled; the cut keeps the ORIGINAL
    pixels, with the white body faded out by colourfulness so the edge stays smooth.
    """
    pixels = np.array(logo)
    rgb = pixels[..., :3].astype(np.int16)
    alpha = pixels[..., 3]
    spread = rgb.max(axis=-1) - rgb.min(axis=-1)
    colourful = (alpha > 200) & (spread > COLOURFUL)
    joined = ndimage.binary_closing(colourful, structure=np.ones((5, 5), bool))
    labels, count = ndimage.label(joined, structure=np.ones((3, 3), bool))
    bright_magenta = colourful & (rgb[..., 0] > 210) & (rgb[..., 1] < 50) & (rgb[..., 2] > 100) & (rgb[..., 2] < 190)
    seeds = labels[bright_magenta]
    seeds = seeds[seeds > 0]
    if count == 0 or seeds.size == 0:
        sys.exit('could not find the M mark (no bright magenta face) in ' + str(LOGO))
    mark_label = int(np.bincount(seeds).argmax())
    region = ndimage.binary_dilation(labels == mark_label, iterations=2)
    ys, xs = np.where(region)
    top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = pixels[top:bottom, left:right].copy()
    fade = np.clip(spread[top:bottom, left:right] / COLOURFUL, 0.0, 1.0)
    crop[..., 3] = np.where(region[top:bottom, left:right], np.round(alpha[top:bottom, left:right] * fade), 0).astype(np.uint8)
    return Image.fromarray(crop, 'RGBA')


def teal_tile(size: int) -> Image.Image:
    """The tile: an opaque diagonal blend between the logo's two teals."""
    ramp = np.linspace(0.0, 1.0, size, dtype=np.float64)
    t = ramp[:, None] * BLEND_DOWN + ramp[None, :] * BLEND_ACROSS
    tile = np.empty((size, size, 4), dtype=np.uint8)
    for channel in range(3):
        tile[..., channel] = np.round(TEAL_LIGHT[channel] * (1 - t) + TEAL_DEEP[channel] * t).astype(np.uint8)
    tile[..., 3] = 255
    return Image.fromarray(tile, 'RGBA')


def scaled(image: Image.Image, scale: float) -> Image.Image:
    width, height = image.size
    return image.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)


def centred(canvas: Image.Image, image: Image.Image) -> Image.Image:
    out = canvas.copy()
    out.alpha_composite(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2))
    return out


def fit_span(image: Image.Image, span: float, size: int) -> float:
    """The scale at which the image's wider side is span × size."""
    return span * size / max(image.size)


def farthest_visible(image: Image.Image) -> float:
    """Distance from the image's centre to its farthest visible pixel's far corner."""
    alpha = np.array(image)[..., 3]
    ys, xs = np.where(alpha > 0)
    cx = image.width / 2
    cy = image.height / 2
    # Measure to the pixel corner farthest from the centre, not its middle.
    dx = np.maximum(np.abs(xs - cx), np.abs(xs + 1 - cx))
    dy = np.maximum(np.abs(ys - cy), np.abs(ys + 1 - cy))
    return float(np.sqrt(dx * dx + dy * dy).max())


def fit_circle(image: Image.Image, radius: float, size: int) -> float:
    """The largest scale at which every visible pixel (shadow included) lies inside the centred circle.

    Measured on the artwork's own pixels: the sticker's outline is irregular, so
    the corners of its bounding box are mostly empty and would waste the safe zone.
    A 2 % margin covers LANCZOS's soft edge when the result is shrunk.
    """
    return radius * size / farthest_visible(image) * 0.98


def render(logo: Image.Image, size: int, maskable: bool) -> Image.Image:
    tile = teal_tile(WORK)
    scale = fit_circle(logo, SAFE_RADIUS, WORK) if maskable else fit_span(logo, ANY_SPAN, WORK)
    big = centred(tile, scaled(logo, scale))
    # Opaque everywhere: iOS paints alpha black, and a maskable icon must be full-bleed.
    return big.resize((size, size), Image.LANCZOS).convert('RGB')


def render_favicon(mark: Image.Image, size: int = 32) -> Image.Image:
    canvas = Image.new('RGBA', (WORK, WORK), (0, 0, 0, 0))
    big = centred(canvas, scaled(mark, fit_span(mark, FAVICON_SPAN, WORK)))
    return big.resize((size, size), Image.LANCZOS)


def png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def write(name: str, image: Image.Image) -> bytes:
    data = png_bytes(image)
    (OUT / name).write_bytes(data)
    print(f'  {name:22s} {image.width}x{image.height}  {len(data):>7,d} bytes')
    return data


def inline_offline_icon(icon192: bytes) -> None:
    """Swap the offline page's inline icon for the new 192 px one (same <img>, same size attributes)."""
    page = OFFLINE.read_text(encoding='utf-8')
    pattern = re.compile(r'(<img src=")data:image/png;base64,[A-Za-z0-9+/=]+(")')
    found = pattern.findall(page)
    if len(found) != 1:
        sys.exit(f'offline.html: expected exactly one inline PNG icon, found {len(found)}')
    uri = 'data:image/png;base64,' + base64.b64encode(icon192).decode('ascii')
    OFFLINE.write_text(pattern.sub(lambda match: match.group(1) + uri + match.group(2), page), encoding='utf-8')
    print(f'  offline.html           inline icon replaced ({len(uri):,d} characters)')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    logo = load_logo()
    mark = cut_mark(logo)
    print(f'logo {logo.width}x{logo.height}, M mark {mark.width}x{mark.height}')
    icon192 = write('icon-192.png', render(logo, 192, maskable=False))
    write('icon-512.png', render(logo, 512, maskable=False))
    write('maskable-192.png', render(logo, 192, maskable=True))
    write('maskable-512.png', render(logo, 512, maskable=True))
    write('apple-touch-icon.png', render(logo, 180, maskable=False))
    write('favicon-32.png', render_favicon(mark))
    inline_offline_icon(icon192)


if __name__ == '__main__':
    main()
