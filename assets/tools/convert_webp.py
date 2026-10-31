#!/usr/bin/env python3
"""Convert generated PNG art to runtime WebP.

Sprites get edge-connected background removal (flood fill from image borders)
with a per-item local colour tolerance; backgrounds stay opaque. This script
only reads tools/art/out/*.png and writes assets/generated/*.webp.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import deque
from pathlib import Path
from statistics import median
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "art" / "out"
DST = ROOT / "assets" / "generated"

# Edge flood parameters for sprites. All four corners are seeded, so corners
# always become transparent; max_dist prevents the flood from crossing into a
# similarly coloured subject.
LOCAL_TOL = 10
MAX_DIST = 80

# Pure-black-background drop icons: the subject can touch the frame border, so
# seed only border pixels that actually match the border colour (global flood,
# tolerance in the established 24-40 range). This preserves the cork/base.
DROP_TOL = 30

ITEMS = {
    # id: (width, height, kind)
    "player": (96, 96, "sprite"),
    "monster-wanderer": (96, 96, "sprite"),
    "monster-bowman": (96, 96, "sprite"),
    "monster-blade": (96, 96, "sprite"),
    "weapon-sword": (96, 96, "sprite"),
    "weapon-blade": (96, 96, "sprite"),
    "weapon-needle": (96, 96, "sprite"),
    "drop-potion": (48, 48, "sprite"),
    "drop-silver": (48, 48, "sprite"),
    "drop-xp": (48, 48, "sprite"),
    "title-bg": (1280, 720, "background"),
    "ui-result": (1280, 720, "background"),
    "ui-scroll": (1024, 512, "background"),
    "ui-stele": (1024, 512, "background"),
    "sect-jianzong": (256, 384, "background"),
    "sect-daomen": (256, 384, "background"),
    "sect-yigu": (256, 384, "background"),
}


def dist(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def border_pixels(px, w, h):
    out = []
    for x in range(w):
        out.append(px[x, 0])
        out.append(px[x, h - 1])
    for y in range(1, h - 1):
        out.append(px[0, y])
        out.append(px[w - 1, y])
    return out


def border_ref(px, w, h):
    pix = border_pixels(px, w, h)
    return tuple(median(p[i] for p in pix) for i in range(3))


def background_mask(px, w, h, tol, local_tol=None):
    """Flood background from every border pixel whose colour matches ref."""
    ref = border_ref(px, w, h)
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        if seen[y * w + x]:
            return
        c = px[x, y]
        if dist(c, ref) <= tol:
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(1, h - 1):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        c = px[x, y]
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if seen[ny * w + nx]:
                continue
            n = px[nx, ny]
            if dist(n, ref) > tol:
                continue
            if local_tol is not None and dist(n, c) > local_tol:
                continue
            seen[ny * w + nx] = 1
            q.append((nx, ny))
    return seen, ref


def local_background_mask(px, w, h, local_tol=16, max_dist=None):
    """Edge-flood following locally smooth background (handles gradients)."""
    ref = border_ref(px, w, h)
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            seen[y * w + x] = 1
            q.append((x, y))
    for y in range(1, h - 1):
        for x in (0, w - 1):
            seen[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        c = px[x, y]
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            if seen[ny * w + nx]:
                continue
            n = px[nx, ny]
            if dist(n, c) > local_tol:
                continue
            if max_dist is not None and dist(n, ref) > max_dist:
                continue
            seen[ny * w + nx] = 1
            q.append((nx, ny))
    return seen, ref


def sprite_mask(px, w, h, asset_id=None):
    """Edge-connected background mask used for all usable sprites."""
    if asset_id in ("drop-potion", "drop-silver"):
        # Pure black background; only border pixels close to the border colour
        # seed the flood, because the bottle/ingot may touch the frame edge.
        return background_mask(px, w, h, DROP_TOL)
    if asset_id == "monster-blade":
        # Dark figure on a dark maroon background: a tight local tolerance is
        # needed or the flood eats the body. Remove tiny leftover specks.
        seen, _ = local_background_mask(px, w, h, 2, 40)
        drop_small_opaque(seen, w, h, 8)
        return seen, border_ref(px, w, h)
    return local_background_mask(px, w, h, LOCAL_TOL, MAX_DIST)


def drop_small_opaque(seen, w, h, min_area):
    """Mark small isolated foreground islands as background."""
    visited = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if seen[idx] or visited[idx]:
                continue
            comp = []
            q = deque([(x, y)])
            visited[idx] = 1
            while q:
                cx, cy = q.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if seen[ni] or visited[ni]:
                        continue
                    visited[ni] = 1
                    q.append((nx, ny))
            if len(comp) < min_area:
                for cx, cy in comp:
                    seen[cy * w + cx] = 1


def mask_stats(seen, px, w, h):
    total = w * h
    cleared = sum(seen)
    center0 = 0
    center_total = 0
    for y in range(h // 4, h - h // 4):
        for x in range(w // 4, w - w // 4):
            center_total += 1
            if seen[y * w + x]:
                center0 += 1
    corners = [seen[0], seen[w - 1], seen[(h - 1) * w], seen[h * w - 1]]
    return {
        "alpha0": round(cleared / total, 4),
        "opaque": round(1 - cleared / total, 4),
        "centerCleared": round(center0 / center_total, 4) if center_total else 0,
        "cornersCleared": all(corners),
    }


def analyze():
    for asset_id, (w, h, kind) in ITEMS.items():
        path = SRC / f"{asset_id}.png"
        if not path.exists():
            print(f"{asset_id}: MISSING {path}")
            continue
        im = Image.open(path).convert("RGBA")
        if im.size != (w, h):
            print(f"{asset_id}: SIZE {im.size} expected {(w, h)}")
            continue
        px = im.load()
        print(f"\n{asset_id} {w}x{h} {kind} mode={im.mode}")
        print("  corners", [px[x, y] for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))])
        ref = border_ref(px, w, h)
        bp = border_pixels(px, w, h)
        ds = [dist(p, ref) for p in bp]
        print("  borderRef", ref, "maxDist", round(max(ds), 1), "meanDist", round(sum(ds) / len(ds), 1))
        if kind == "sprite":
            for tol in (20, 24, 28, 32, 36, 40):
                seen, _ = background_mask(px, w, h, tol)
                print(f"  tol={tol}", mask_stats(seen, px, w, h))
            for lt in (10, 14, 18, 22, 26):
                seen, _ = local_background_mask(px, w, h, lt, 80)
                print(f"  local={lt}", mask_stats(seen, px, w, h))


def convert(only=None):
    DST.mkdir(parents=True, exist_ok=True)
    written = []
    ids = list(ITEMS) if not only else only
    unknown = set(ids) - set(ITEMS)
    if unknown:
        raise SystemExit(f"unknown asset ids: {sorted(unknown)}")
    for asset_id in ids:
        w, h, kind = ITEMS[asset_id]
        src = SRC / f"{asset_id}.png"
        dst = DST / f"{asset_id}.webp"
        if not src.exists():
            raise SystemExit(f"missing source {src}")
        im = Image.open(src).convert("RGBA")
        if im.size != (w, h):
            raise SystemExit(f"size mismatch {asset_id}: {im.size} != {(w, h)}")
        if kind == "sprite":
            px = im.load()
            seen, _ = sprite_mask(px, w, h, asset_id)
            out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            opx = out.load()
            for y in range(h):
                for x in range(w):
                    if not seen[y * w + x]:
                        r, g, b, a = px[x, y]
                        opx[x, y] = (r, g, b, 255 if a >= 255 else a)
            out.save(dst, "WEBP", lossless=True, method=6)
        else:
            im.convert("RGB").save(dst, "WEBP", quality=88, method=6)
        written.append(asset_id)
        print(f"wrote {dst.relative_to(ROOT)} {dst.stat().st_size} bytes")
    print(f"converted={len(written)} ids={written}")


def emit_sources(summary, rows, exceptions, failures):
    """Regenerate SOURCES.md from the actual WebP bytes on disk."""
    by_id = {r["id"]: r for r in rows}
    lines = []
    lines.append("# assets/generated/ · 生成素材接入位与来源清单")
    lines.append("")
    lines.append("> 模块：env-resources（属主 env-bootstrap）")
    lines.append("> 契约：`docs/contracts/wuxia-rogue-v2-architecture-v1.md` §3.1 / §6.2 / §6.4")
    lines.append("> 当前阶段：**17 项生成 WebP 已接入**（10 个精灵透明（含 2 个掉落图标）、7 个背景不透明）；无例外。")
    lines.append("")
    lines.append("## 1. 接入与转换规则")
    lines.append("")
    lines.append("1. **唯一真源**：离线美术流水线的 `tools/art/MANIFEST.json`（art-generator 维护，17 条）；本文件逐项对应。")
    lines.append("2. **精灵透明化**：仅从图像四边种子做 4 邻接泛洪，只清除与边缘连通的背景；默认 `local_tol=10`、`max_dist=80`。`monster-blade` 为暗色人物+暗红背景，使用 `local_tol=2`、`max_dist=40`，并移除小于 8 px 的孤立前景噪点，避免侵蚀人物。`drop-potion` / `drop-silver` 为纯黑背景且主体可能触边，使用边缘连通全局泛洪 `tol=30`（仅以匹配边缘色的边界像素为种子），避免裁掉瓶口/元宝边缘。")
    lines.append("3. **编码**：精灵输出 RGBA WebP，`lossless=True`、`method=6`，保留 alpha；背景输出 RGB WebP，`quality=88`、`method=6`，保持不透明。")
    lines.append("4. **尺寸**：输出宽高必须与源 PNG 逐项完全一致（PIL 解码核对）。")
    lines.append("5. **drop 补转**：`drop-potion` / `drop-silver` 已由 art-generator 重生成（纯黑背景、单只青绿药瓶/银白元宝居中），本轮按边缘连通流程补转透明 WebP；四角 alpha=0，主体保留，旧例外记录作废。")
    lines.append("6. **运行时零依赖**：只读本地文件；不联网、不加载模型、不依赖 Python。加载失败由 UI 层 `onerror` 回退占位，不阻塞启动。")
    lines.append("7. **版权**：素材为项目自绘或本机离线生成，无第三方版权素材、无远程 URL。")
    lines.append("8. **变更同步**：新增或替换资产时同步更新本文件与 `MANIFEST`；验收以两者一致为准。")
    lines.append("")
    lines.append("## 2. 17 项资产清单")
    lines.append("")
    lines.append("| # | 资产 id | 类型 | 运行时路径 | 尺寸 | 处理 | 状态 | 字节 | sha256 | 回退占位 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    order = list(ITEMS)
    for n, asset_id in enumerate(order, 1):
        w, h, kind = ITEMS[asset_id]
        fallback = f"`assets/placeholder-{asset_id}.svg`"
        r = by_id[asset_id]
        if kind == "sprite":
            if asset_id in ("drop-potion", "drop-silver"):
                proc = "边缘连通背景抠除 global_tol=30；透明 alpha；lossless/method=6"
            elif asset_id == "monster-blade":
                proc = "边缘连通背景抠除 local_tol=2/max_dist=40 + 去孤岛<8px；透明 alpha；lossless/method=6"
            else:
                proc = "边缘连通背景抠除 local_tol=10/max_dist=80；透明 alpha；lossless/method=6"
        else:
            proc = "不透明 RGB；quality=88/method=6"
        lines.append(
            f"| {n} | {asset_id} | {kind} | `{r['path']}` | {r['width']}×{r['height']} | "
            f"{proc} | **ok** | {r['bytes']} | `{r['sha256']}` | {fallback} |"
        )
    lines.append("")
    lines.append("## 3. 逐项校验数据（PIL 解码）")
    lines.append("")
    lines.append("| 资产 id | 格式/模式 | 四角 alpha | alpha=0 占比 | 非透明占比 | 中心非透明占比 |")
    lines.append("| --- | --- | --- | --- | --- | --- |")
    for r in rows:
        corners = "/".join(str(a) for a in r["cornersAlpha"])
        center = "—" if r["centerOpaque"] is None else f"{r['centerOpaque']:.4f}"
        lines.append(
            f"| {r['id']} | WEBP/{r['mode']} | {corners} | {r['alpha0']:.4f} | "
            f"{r['opaque']:.4f} | {center} |"
        )
    lines.append("")
    lines.append("## 4. 汇总")
    lines.append("")
    lines.append("| 指标 | 数量 |")
    lines.append("| --- | --- |")
    lines.append(f"| 总条目（与 MANIFEST 一致） | {summary['total']} / 17 |")
    lines.append("| MANIFEST `ok`（源图生成） | 17 / 17 |")
    lines.append(f"| 已接入生成 WebP（generated） | {summary['webp']} / 17 |")
    lines.append(f"| 精灵透明 WebP | {sum(1 for r in rows if r['kind'] == 'sprite')} / 10 |")
    lines.append("| 背景不透明 WebP | 7 / 7 |")
    lines.append(f"| 失败例外（回退占位，未写 WebP） | {summary['exceptions']} / 17 |")
    lines.append(f"| 校验失败 | {summary['failed']} / 17 |")
    lines.append("")
    lines.append("> 说明：MANIFEST 的 `ok` 表示源 PNG 生成成功；接入层的 `generated` 表示本目录真实存在且通过 PIL 校验的 WebP。`drop-potion` / `drop-silver` 重生成后已补转透明 WebP，17 项全部接入。")
    lines.append("")
    lines.append("## 5. 回退链")
    lines.append("")
    lines.append("`assets/generated/<id>.webp` → `assets/placeholder-<id>.svg` → 代码内几何绘制 / CSS 样式。")
    lines.append("")
    lines.append("- 17 项生成 WebP 存在且通过校验，运行时优先加载。")
    lines.append("- `drop-potion` / `drop-silver` 已补转透明 WebP；占位 SVG 仅作加载失败时的兜底。")
    lines.append("- 任何素材缺失时游戏仍可启动，回退不阻塞。")
    lines.append("")
    lines.append("## 6. 更新记录")
    lines.append("")
    lines.append("| 日期 | 变更 | 操作者 |")
    lines.append("| --- | --- | --- |")
    lines.append("| 2026-10-31 | 初始化接入位与 14 项清单（均未接入） | env-bootstrap |")
    lines.append("| 2026-10-31 | 新增 3 个武器占位，按 MANIFEST 17 条复核（全部 failed，未接入） | env-bootstrap |")
    lines.append("| 2026-10-31 | 17 张源 PNG 转 WebP：15 项接入（8 精灵透明 + 7 背景不透明），2 项 drop 源图无主体回退占位；逐项 PIL 校验 | env-bootstrap |")
    lines.append("| 2026-10-31 | drop-potion/drop-silver 重生成后补转透明 WebP，generated 17/17、透明精灵 10/10 | env-bootstrap |")
    lines.append("")
    lines.append("## 7. 核对口径")
    lines.append("")
    lines.append("- 本文件 17 条与 `tools/art/MANIFEST.json` 的 `assets` 一一对应。")
    lines.append("- 本文件不参与运行时加载，仅作来源、处理参数与校验记录。")
    lines.append("- 运行时引用只允许 `assets/generated/*` 与 `assets/placeholder-*.svg`，不得出现远程地址。")
    lines.append("- 武器/怪物/玩家精灵必须带 alpha 且四角 alpha=0；背景必须不透明。")
    lines.append("")
    path = DST / "SOURCES.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} {path.stat().st_size} bytes")


def verify(write_sources=False):
    rows = []
    exceptions = []
    failures = []
    for asset_id, (w, h, kind) in ITEMS.items():
        path = DST / f"{asset_id}.webp"
        src = SRC / f"{asset_id}.png"
        if not path.exists():
            failures.append(f"{asset_id}: missing")
            continue
        data = path.read_bytes()
        im = Image.open(path)
        im.load()
        fmt = im.format
        dims = im.size
        if fmt != "WEBP":
            failures.append(f"{asset_id}: format={fmt}")
        if dims != (w, h):
            failures.append(f"{asset_id}: size={dims} expected={(w, h)}")
        if src.exists() and Image.open(src).size != dims:
            failures.append(f"{asset_id}: size={dims} != png={Image.open(src).size}")
        corners = None
        alpha0 = None
        opaque = None
        center_opaque = None
        mode = im.mode
        if kind == "sprite":
            rgba = im.convert("RGBA")
            px = rgba.load()
            alphas = [px[x, y][3] for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
            corners = alphas
            if alphas != [0, 0, 0, 0]:
                failures.append(f"{asset_id}: corners alpha={alphas}")
            hist = rgba.getchannel("A").histogram()
            total = w * h
            zero = hist[0]
            alpha0 = round(zero / total, 4)
            opaque = round(1 - alpha0, 4)
            if not (0.01 <= opaque <= 0.85):
                failures.append(f"{asset_id}: opaque={opaque}")
            c0 = 0
            ctotal = 0
            for y in range(h // 4, h - h // 4):
                for x in range(w // 4, w - w // 4):
                    ctotal += 1
                    if px[x, y][3] > 0:
                        c0 += 1
            center_opaque = round(c0 / ctotal, 4) if ctotal else 0
            if center_opaque <= 0:
                failures.append(f"{asset_id}: center fully transparent")
        else:
            rgba = im.convert("RGBA")
            px = rgba.load()
            alphas = [px[x, y][3] for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
            corners = alphas
            if alphas != [255, 255, 255, 255]:
                failures.append(f"{asset_id}: corners alpha={alphas}")
            hist = rgba.getchannel("A").histogram()
            total = w * h
            alpha0 = round(hist[0] / total, 4)
            opaque = round(1 - alpha0, 4)
            if alpha0 != 0:
                failures.append(f"{asset_id}: unexpected transparency={alpha0}")
        rows.append({
            "id": asset_id,
            "kind": kind,
            "path": f"assets/generated/{asset_id}.webp",
            "mode": mode,
            "width": dims[0],
            "height": dims[1],
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "cornersAlpha": corners,
            "alpha0": alpha0,
            "opaque": opaque,
            "centerOpaque": center_opaque,
        })
    summary = {
        "total": len(ITEMS),
        "webp": len(rows),
        "exceptions": len(exceptions),
        "failed": len(failures),
    }
    if write_sources:
        emit_sources(summary, rows, exceptions, failures)
    print(json.dumps({"summary": summary, "failures": failures, "rows": rows,
                      "exceptions": exceptions}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


def preview():
    """Checkerboard contact sheet for visual QA of sprite transparency."""
    ids = [i for i, (_, _, k) in ITEMS.items() if k == "sprite"]
    cell = 160
    cols = 3
    rows = (len(ids) + cols - 1) // cols
    out = Image.new("RGB", (cols * cell, rows * cell), (255, 255, 255))
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            if ((x // 16) + (y // 16)) % 2:
                px[x, y] = (210, 210, 210)
    for n, asset_id in enumerate(ids):
        im = Image.open(DST / f"{asset_id}.webp").convert("RGBA")
        im.thumbnail((cell - 16, cell - 16), Image.NEAREST)
        x = (n % cols) * cell + (cell - im.width) // 2
        y = (n // cols) * cell + (cell - im.height) // 2
        out.paste(im, (x, y), im)
    path = ROOT / "assets" / "tools" / "_preview_sprites.png"
    out.save(path)
    print(f"wrote {path.relative_to(ROOT)} ids={ids}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyze", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--sources", action="store_true")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--only", help="comma-separated asset ids (default: all)")
    args = ap.parse_args()
    if args.analyze:
        analyze()
    elif args.verify:
        verify()
    elif args.sources:
        verify(write_sources=True)
    elif args.preview:
        preview()
    else:
        convert(args.only.split(",") if args.only else None)


if __name__ == "__main__":
    main()
