#!/usr/bin/env python3
"""Shrink a raw generated image into a small WebP for the Lab.

  python3 scripts/lab-art/fit.py <raw.png> <src/lab/art/name.webp> <max side px> [quality=60]

Keep every file well under 100 KB and under about 1000 px a side: decoded pixels, not file size, are what
run an iPhone out of memory (the painted mats were reverted for that, PR #134).
"""
import os, sys
from PIL import Image

raw, out, side = sys.argv[1], sys.argv[2], int(sys.argv[3])
q = int(sys.argv[4]) if len(sys.argv) > 4 else 60
im = Image.open(raw).convert('RGB')
im.thumbnail((side, side), Image.LANCZOS)
im.save(out, 'WEBP', quality=q, method=6)
print(out, im.size, f'{os.path.getsize(out) / 1024:.0f} KB')
