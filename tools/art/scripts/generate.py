#!/usr/bin/env python3
"""江湖夜雨 · AI 美术离线生成流水线（art-pipeline，非运行时模块）。

流程：
  tools/art/prompts/<id>.md  ->  QwenImage21Pipeline（本地 HF 缓存）
  ->  tools/art/out/<id>.png  ->  tools/art/MANIFEST.json

约束（架构契约 wuxia-rogue-v2 §4.9 / §6）：
  * 离线生成：默认 HF_HUB_OFFLINE=1 + local_files_only=True，不联网拉模型；
  * 24 GB 显存：enable_model_cpu_offload() + float16；
  * 失败如实记录：status=failed + reason，绝不把占位或空文件伪装成 ok；
  * MANIFEST.json 是唯一生成记录真源。

示例：
  tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py
  tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py --only player drop-xp
  tools/art/venv/Scripts/python.exe tools/art/scripts/generate.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ART_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROMPTS = ART_ROOT / "prompts"
DEFAULT_OUT = ART_ROOT / "out"
DEFAULT_MANIFEST = ART_ROOT / "MANIFEST.json"
MODEL_ID = "Qwen/Qwen-Image-2.1"
DEFAULT_SNAPSHOT = "d26bb61231c349cf6b7896fa83353113880e1ba3"
REPO_DIR_NAME = "models--Qwen--Qwen-Image-2.1"
FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
SECTION_RE = re.compile(r"^##\s+(.+?)\s*$")
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


def parse_prompt(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    if not match:
        raise ValueError("缺少 --- 前置元数据块")
    meta: dict[str, str] = {}
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            continue
        meta[key.strip()] = value.strip()
    sections: dict[str, list[str]] = {}
    current = None
    for line in text[match.end():].splitlines():
        heading = SECTION_RE.match(line)
        if heading:
            current = heading.group(1).strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)
    positive = "\n".join(sections.get("正向提示词", [])).strip()
    negative = "\n".join(sections.get("负向提示词", [])).strip()
    if not positive:
        raise ValueError("缺少「## 正向提示词」内容")
    for field in ("id", "width", "height", "steps", "seed"):
        if field not in meta:
            raise ValueError(f"前置元数据缺少 {field}")
    return {
        "id": meta["id"],
        "title": meta.get("title", meta["id"]),
        "width": int(meta["width"]),
        "height": int(meta["height"]),
        # 可选渲染尺寸：VAE 要求宽高 ~32 的倍数，小尺寸图标先大图渲染再缩回目标尺寸。
        "render_width": int(meta.get("renderWidth", meta["width"])),
        "render_height": int(meta.get("renderHeight", meta["height"])),
        "steps": int(meta["steps"]),
        "seed": int(meta["seed"]),
        "guidance": float(meta.get("guidance", "4.0")),
        "snapshot": meta.get("snapshot", DEFAULT_SNAPSHOT),
        "model": meta.get("model", MODEL_ID),
        "output": meta.get("output", f"{meta['id']}.png"),
        "positive": positive,
        "negative": negative,
        "prompt_file": rel(path),
    }


def discover(prompts_dir: Path) -> list[dict]:
    assets = []
    for path in sorted(prompts_dir.glob("*.md")):
        assets.append(parse_prompt(path))
    if not assets:
        raise SystemExit(f"提示词目录为空：{prompts_dir}")
    ids = [a["id"] for a in assets]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"提示词 id 重复：{ids}")
    return assets


def resolve_model_source(snapshot: str) -> tuple[str, bool]:
    """返回 (source, is_local_snapshot)。优先直接用本地 snapshot 目录。"""
    hf_home = os.environ.get("HF_HOME")
    hub_candidates = []
    if hf_home:
        hub_candidates.append(Path(hf_home) / "hub")
    hub_candidates.append(Path.home() / ".cache" / "huggingface" / "hub")
    for hub in hub_candidates:
        snap = hub / REPO_DIR_NAME / "snapshots" / snapshot
        if snap.is_dir():
            return str(snap), True
    return MODEL_ID, False


def load_pipeline(snapshot: str, local_only: bool = True):
    """加载 QwenImage21Pipeline；失败抛出异常，由调用方记录为 failed。"""
    import torch
    from diffusers import QwenImage21Pipeline

    source, is_local = resolve_model_source(snapshot)
    kwargs = {"torch_dtype": torch.float16, "local_files_only": local_only}
    if not is_local:
        kwargs["revision"] = snapshot
    pipe = QwenImage21Pipeline.from_pretrained(source, **kwargs)
    pipe.enable_model_cpu_offload()
    try:
        pipe.set_progress_bar_config(disable=True)
    except Exception:
        pass
    return pipe, torch


def describe_error(exc: BaseException) -> str:
    message = f"{type(exc).__name__}: {exc}".strip()
    lowered = message.lower()
    if "out of memory" in lowered or "cuda oom" in lowered:
        message = "显存不足（CUDA OOM）：" + message
    elif "timed out" in lowered or "timeout" in lowered:
        message = "生成超时：" + message
    return message[:REASON_LIMIT]


def generate_one(pipe, torch, asset: dict, out_path: Path) -> None:
    generator = torch.Generator(device="cpu").manual_seed(asset["seed"])
    render_w = asset.get("render_width", asset["width"])
    render_h = asset.get("render_height", asset["height"])
    kwargs = {
        "prompt": asset["positive"],
        "negative_prompt": asset["negative"],
        "width": render_w,
        "height": render_h,
        "num_inference_steps": asset["steps"],
        "generator": generator,
        "guidance_scale": asset["guidance"],
    }
    try:
        result = pipe(**kwargs)
    except TypeError:
        # 兼容不同 diffusers 版本的参数名差异：退回最小公共参数集。
        fallback = {
            "prompt": asset["positive"],
            "width": render_w,
            "height": render_h,
            "num_inference_steps": asset["steps"],
            "generator": generator,
        }
        result = pipe(**fallback)
    image = result.images[0]
    target = (asset["width"], asset["height"])
    if image.size != target:
        # 管线会按 VAE/32 约束改尺寸；缩回提示词声明的精确尺寸后再落盘。
        from PIL import Image as _Image

        image = image.convert("RGB").resize(target, _Image.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path, format="PNG")


def read_manifest(path: Path) -> dict:
    if not path.is_file():
        return {"model": MODEL_ID, "snapshot": DEFAULT_SNAPSHOT, "generatedAt": "", "assets": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("assets"), list):
            raise ValueError("结构不是 {assets:[...]}")
        return data
    except Exception as exc:
        print(f"[warn] MANIFEST 无法读取，将重建：{exc}", flush=True)
        return {"model": MODEL_ID, "snapshot": DEFAULT_SNAPSHOT, "generatedAt": "", "assets": []}


def write_manifest(path: Path, model: str, snapshot: str, entries: dict[str, dict]) -> None:
    payload = {
        "model": model,
        "snapshot": snapshot,
        "generatedAt": now_iso(),
        "assets": [entries[key] for key in sorted(entries)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def main(argv: list[str] | None = None) -> int:
    _utf8_stdout()
    parser = argparse.ArgumentParser(description="Qwen-Image-2.1 离线批量生成（tools/art）")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--prompts-dir", type=Path, default=DEFAULT_PROMPTS)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--only", nargs="*", default=None, help="只生成指定 id（默认全部）")
    parser.add_argument("--snapshot", default=None, help="覆盖提示词中的 HF snapshot")
    parser.add_argument("--dry-run", action="store_true", help="只解析提示词并打印计划，不加载模型/写盘")
    parser.add_argument(
        "--allow-download",
        action="store_true",
        help="允许联网加载模型（默认关闭；仅在模型缓存不完整时由操作者显式开启）",
    )
    args = parser.parse_args(argv)
    local_only = not args.allow_download
    if local_only:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    try:
        assets = discover(args.prompts_dir)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[fatal] 提示词解析失败：{exc}", flush=True)
        return 1

    selected = assets
    if args.only:
        wanted = set(args.only)
        unknown = wanted - {a["id"] for a in assets}
        if unknown:
            print(f"[fatal] 未知资产 id：{sorted(unknown)}", flush=True)
            return 1
        selected = [a for a in assets if a["id"] in wanted]

    if args.dry_run:
        print(f"[dry-run] 共 {len(selected)} 项，输出目录 {args.out_dir}", flush=True)
        for asset in selected:
            print(
                f"  {asset['id']:<18} {asset['width']}x{asset['height']} "
                f"steps={asset['steps']} seed={asset['seed']} "
                f"prompt={asset['prompt_file']}",
                flush=True,
            )
        return 0

    manifest_path = args.manifest
    out_dir = args.out_dir
    existing = read_manifest(manifest_path)
    entries = {item["id"]: item for item in existing.get("assets", []) if isinstance(item, dict) and "id" in item}
    model = selected[0]["model"] if selected else existing.get("model", MODEL_ID)
    snapshot = args.snapshot or (selected[0]["snapshot"] if selected else existing.get("snapshot", DEFAULT_SNAPSHOT))

    def mark(asset: dict, status: str, reason: str, ms: int) -> None:
        entries[asset["id"]] = {
            "id": asset["id"],
            "file": rel(out_dir / asset["output"]),
            "promptFile": asset["prompt_file"],
            "seed": asset["seed"],
            "status": status,
            "reason": reason,
            "ms": ms,
        }

    print(f"[info] 模型 {model} / snapshot {snapshot}", flush=True)
    try:
        import torch  # noqa: F401  仅用于给出明确的依赖缺失原因
        from diffusers import QwenImage21Pipeline  # noqa: F401
    except Exception as exc:
        reason = f"依赖缺失，未安装或不可导入（torch/diffusers）：{describe_error(exc)}"
        print(f"[failed] {reason}", flush=True)
        for asset in selected:
            mark(asset, "failed", reason, 0)
        write_manifest(manifest_path, model, snapshot, entries)
        failed = sum(1 for item in entries.values() if item.get("status") != "ok")
        print(f"[summary] ok={len(entries) - failed} failed={failed}（已写入 {manifest_path}）", flush=True)
        return 2

    try:
        pipe, torch = load_pipeline(snapshot, local_only=local_only)
    except Exception as exc:
        reason = f"模型管线加载失败（HF 缓存/snapshot/依赖）：{describe_error(exc)}"
        print(f"[failed] {reason}", flush=True)
        for asset in selected:
            mark(asset, "failed", reason, 0)
        write_manifest(manifest_path, model, snapshot, entries)
        failed = sum(1 for item in entries.values() if item.get("status") != "ok")
        print(f"[summary] ok={len(entries) - failed} failed={failed}（已写入 {manifest_path}）", flush=True)
        return 2

    ok_count = 0
    for index, asset in enumerate(selected, start=1):
        out_path = out_dir / asset["output"]
        print(f"[{index}/{len(selected)}] {asset['id']} -> {rel(out_path)} ...", flush=True)
        started = time.perf_counter()
        try:
            generate_one(pipe, torch, asset, out_path)
            elapsed = int((time.perf_counter() - started) * 1000)
            mark(asset, "ok", "", elapsed)
            ok_count += 1
            print(f"    ok ({elapsed} ms)", flush=True)
        except Exception as exc:
            elapsed = int((time.perf_counter() - started) * 1000)
            reason = describe_error(exc)
            if "OutOfMemoryError" in type(exc).__name__ or "out of memory" in str(exc).lower():
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
            mark(asset, "failed", reason, elapsed)
            print(f"    failed ({elapsed} ms): {reason}", flush=True)
            # 保留占位策略：失败不写文件，绝不生成占位 PNG 冒充成功。
        write_manifest(manifest_path, model, snapshot, entries)

    failed_count = len(selected) - ok_count
    print(f"[summary] 本次 ok={ok_count} failed={failed_count}；MANIFEST={manifest_path}", flush=True)
    for item in entries.values():
        if item.get("status") != "ok" and item["id"] in {a["id"] for a in selected}:
            print(f"  failed {item['id']}: {item.get('reason', '')}", flush=True)
    return 0 if failed_count == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
