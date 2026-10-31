#!/usr/bin/env python3
"""掉落物图标的客观检查（只读，不写盘）。

输出每项的：像素尺寸、字节数、RGB 极值、RGB/亮度标准差、四角背景色、
非背景像素占比（与四角背景差 > 40 的像素比例）、中心区域亮度标准差。

用法：
  tools/art/venv/Scripts/python.exe tools/art/scripts/analyze_icon.py drop-potion drop-silver
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageStat

ART_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ART_ROOT / "out"
BG_DIFF_THRESHOLD = 40


def corner_background(px, width: int, height: int) -> tuple[float, float, float]:
    points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    channels: list[list[int]] = [[], [], []]
    for x, y in points:
        r, g, b = px[x, y][:3]
        channels[0].append(r)
        channels[1].append(g)
        channels[2].append(b)
    return tuple(sum(ch) / len(ch) for ch in channels)  # type: ignore[return-value]


def analyze(path: Path) -> dict:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    px = image.load()
    rgb_std = ImageStat.Stat(image).stddev
    luma_std = ImageStat.Stat(image.convert("L")).stddev[0]
    bg = corner_background(px, width, height)

    non_bg = 0
    for y in range(height):
        for x in range(width):
            r, g, b = px[x, y]
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) > BG_DIFF_THRESHOLD:
                non_bg += 1

    cw, ch = max(1, width // 2), max(1, height // 2)
    box = ((width - cw) // 2, (height - ch) // 2, (width + cw) // 2, (height + ch) // 2)
    center_std = ImageStat.Stat(image.crop(box).convert("L")).stddev[0]

    extrema = {c: ImageStat.Stat(image.getchannel(c)).extrema[0] for c in range(3)}
    return {
        "file": path.relative_to(ART_ROOT).as_posix(),
        "size": [width, height],
        "bytes": path.stat().st_size,
        "rgb_extrema": {k: list(v) for k, v in extrema.items()},
        "rgb_std": [round(v, 2) for v in rgb_std],
        "luma_std": round(luma_std, 2),
        "corner_bg": [int(round(v)) for v in bg],
        "non_bg_ratio": round(non_bg / (width * height), 3),
        "center_luma_std": round(center_std, 2),
    }


def main(argv: list[str]) -> int:
    ids = argv or ["drop-potion", "drop-silver"]
    for asset_id in ids:
        path = OUT_DIR / f"{asset_id}.png"
        if not path.is_file():
            print(json.dumps({"id": asset_id, "error": "文件不存在"}, ensure_ascii=False))
            continue
        row = {"id": asset_id, **analyze(path)}
        print(json.dumps(row, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
