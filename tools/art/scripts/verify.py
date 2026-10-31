#!/usr/bin/env python3
"""江湖夜雨 · 素材校验与 MANIFEST 回填（art-pipeline，非运行时模块）。

校验每个资产的 out/*.png 是否存在、尺寸是否与提示词一致、能否被 Pillow 解码；
把真实结果回填到 tools/art/MANIFEST.json 的 status/reason（ok|failed）。

示例：
  tools/art/venv/Scripts/python.exe tools/art/scripts/verify.py
  tools/art/venv/Scripts/python.exe tools/art/scripts/verify.py --strict
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ART_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPTS = ART_ROOT / "prompts"
DEFAULT_OUT = ART_ROOT / "out"
DEFAULT_MANIFEST = ART_ROOT / "MANIFEST.json"
FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
REASON_LIMIT = 800


def _utf8_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def rel(path: Path) -> str:
    return path.resolve().relative_to(ART_ROOT).as_posix()


def parse_front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        raise ValueError("缺少前置元数据")
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, sep, value = line.partition(":")
        if sep:
            meta[key.strip()] = value.strip()
    for field in ("id", "width", "height", "seed"):
        if field not in meta:
            raise ValueError(f"缺少 {field}")
    return {
        "id": meta["id"],
        "width": int(meta["width"]),
        "height": int(meta["height"]),
        "seed": int(meta["seed"]),
        "output": meta.get("output", f"{meta['id']}.png"),
        "prompt_file": rel(path),
    }


def load_specs(prompts_dir: Path) -> dict[str, dict]:
    specs: dict[str, dict] = {}
    for path in sorted(prompts_dir.glob("*.md")):
        spec = parse_front_matter(path)
        specs[spec["id"]] = spec
    return specs


def load_manifest(path: Path) -> dict:
    if not path.is_file():
        return {"model": "Qwen/Qwen-Image-2.1", "snapshot": "", "generatedAt": "", "assets": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("assets"), list):
        raise ValueError("MANIFEST 结构不是 {assets:[...]}")
    return data


def write_manifest(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def check_image(path: Path, width: int, height: int) -> tuple[bool, str]:
    try:
        from PIL import Image
    except Exception as exc:
        return False, f"依赖缺失：无法导入 Pillow（{type(exc).__name__}: {exc}）"
    if not path.is_file():
        return False, f"文件缺失：{rel(path) if path.is_relative_to(ART_ROOT) else path}"
    try:
        with Image.open(path) as image:
            image.load()
            actual = image.size
            fmt = image.format
    except Exception as exc:
        return False, f"文件无法解码（{type(exc).__name__}: {exc}）"
    if fmt != "PNG":
        return False, f"格式不是 PNG（实际 {fmt}）"
    if actual != (width, height):
        return False, f"尺寸不符：期望 {width}x{height}，实际 {actual[0]}x{actual[1]}"
    return True, ""


def main(argv: list[str] | None = None) -> int:
    _utf8_stdout()
    parser = argparse.ArgumentParser(description="校验 tools/art/out 并回填 MANIFEST")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--prompts-dir", type=Path, default=DEFAULT_PROMPTS)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--strict", action="store_true", help="存在 failed 时以退出码 2 结束")
    args = parser.parse_args(argv)

    if not args.prompts_dir.is_dir():
        print(f"[fatal] 提示词目录不存在：{args.prompts_dir}", flush=True)
        return 1
    specs = load_specs(args.prompts_dir)
    if not specs:
        print(f"[fatal] 提示词目录为空：{args.prompts_dir}", flush=True)
        return 1

    try:
        manifest = load_manifest(args.manifest)
    except Exception as exc:
        print(f"[fatal] MANIFEST 无法读取：{exc}", flush=True)
        return 1

    entries = {
        item["id"]: item
        for item in manifest.get("assets", [])
        if isinstance(item, dict) and "id" in item
    }
    ok_count = 0
    failed: list[tuple[str, str]] = []

    for asset_id, spec in sorted(specs.items()):
        out_path = args.out_dir / spec["output"]
        entry = entries.get(asset_id)
        if entry is None:
            entry = {
                "id": asset_id,
                "file": rel(out_path) if out_path.is_relative_to(ART_ROOT) else str(out_path),
                "promptFile": spec["prompt_file"],
                "seed": spec["seed"],
                "status": "failed",
                "reason": "MANIFEST 无记录，verify 补登记",
                "ms": 0,
            }
            entries[asset_id] = entry
        else:
            entry.setdefault("file", rel(out_path) if out_path.is_relative_to(ART_ROOT) else str(out_path))
            entry.setdefault("promptFile", spec["prompt_file"])
            entry.setdefault("seed", spec["seed"])
            entry.setdefault("ms", 0)

        valid, reason = check_image(out_path, spec["width"], spec["height"])
        old_reason = str(entry.get("reason") or "").strip()
        if valid:
            entry["status"] = "ok"
            entry["reason"] = ""
            ok_count += 1
        else:
            marker = "原生成记录原因："
            base_reason = old_reason.split(marker, 1)[1].strip() if marker in old_reason else old_reason
            if base_reason and base_reason not in reason:
                reason = f"{reason}；{marker}{base_reason}"
            entry["status"] = "failed"
            entry["reason"] = reason[:REASON_LIMIT]
            failed.append((asset_id, entry["reason"]))

    known_ids = set(specs)
    for asset_id, entry in entries.items():
        if asset_id not in known_ids and entry.get("status") == "ok":
            entry["status"] = "failed"
            entry["reason"] = "MANIFEST 记录无对应提示词文件"
            failed.append((asset_id, entry["reason"]))

    manifest["assets"] = [entries[key] for key in sorted(entries)]
    if not manifest.get("generatedAt"):
        manifest["generatedAt"] = now_iso()
    write_manifest(args.manifest, manifest)

    total = len(specs)
    print(f"[verify] 共 {total} 项：ok={ok_count} failed={len(failed)}", flush=True)
    for asset_id, reason in failed:
        print(f"  failed {asset_id}: {reason}", flush=True)
    print(f"[verify] MANIFEST 已回填：{args.manifest}", flush=True)
    if failed and args.strict:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
