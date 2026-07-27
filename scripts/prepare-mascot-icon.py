#!/usr/bin/env python3
"""Flatten mascot icon-source for macOS: remove baked-in matte outside the squircle.

Design exports are often JPEG with gray/white checkerboard or black corners outside
the squircle. macOS applies its own squircle mask to app icons, so those pixels must
become the same mint fill as the icon interior (opaque full-bleed square).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print('prepare-mascot-icon.py requires pillow and numpy', file=sys.stderr)
    sys.exit(1)

MINT = np.array([240, 250, 239], dtype=np.uint8)


def is_outside_pixel(r: int, g: int, b: int) -> bool:
    """Pixels outside the squircle from JPEG exports (checkerboard or black matte)."""
    if r == 0 and g == 0 and b == 0:
        return True
    if min(r, g, b) > 200 and max(r, g, b) - min(r, g, b) < 20:
        return True
    return False


def flatten_icon_source(src: Path, out: Path, size: int = 1024) -> None:
    im = Image.open(src).convert('RGB')
    if im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.LANCZOS)

    arr = np.array(im)
    mask = np.zeros(arr.shape[:2], dtype=bool)
    for y in range(arr.shape[0]):
        for x in range(arr.shape[1]):
            r, g, b = arr[y, x]
            if is_outside_pixel(int(r), int(g), int(b)):
                mask[y, x] = True

    arr[mask] = MINT
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(out, format='PNG', optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--size', type=int, default=1024)
    args = parser.parse_args()
    flatten_icon_source(args.source, args.output, args.size)


if __name__ == '__main__':
    main()
