#!/usr/bin/env python3
"""verify.py 的自测（不参与真实生成，不写 MANIFEST.json 真源）。

在 tools/art/.selftest/ 下按提示词尺寸生成纯色合成 PNG，再调用 verify.main 校验
ok 回填路径是否正常。真实出图仍必须由 generate.py 用 Qwen-Image-2.1 生成。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "prompts"
OUT = ROOT / ".selftest" / "out"
MANIFEST = ROOT / ".selftest" / "MANIFEST.json"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in sorted(PROMPTS.glob("*.md")):
        spec = verify.parse_front_matter(path)
        Image.new("RGB", (spec["width"], spec["height"]), (36, 40, 38)).save(
            OUT / spec["output"], format="PNG"
        )
        count += 1
    print(f"[selftest] 合成 {count} 张测试图 -> {OUT}", flush=True)
    return verify.main(["--manifest", str(MANIFEST), "--out-dir", str(OUT)])


if __name__ == "__main__":
    raise SystemExit(main())
