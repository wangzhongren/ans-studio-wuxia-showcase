# wuxia-rogue-v2 终验发卡尝试记录 v1

- 日期：2026-10-31
- 任务：`#t-mvwe3129-4c5adf60`（幕僚派发）
- 结论：**未发起验收卡**（发现素材口径不一致，按派发要求先回报）。

## 已做

1. 按序读完 intent / architecture / delivery plan / delivery report / feedback2 / art-render bridge；architecture SHA256 实测 `d4bec46b…c152` 与派发一致。
2. 独立核对：
   - `index.html` 27 外部脚本 / 0 内联 / 27 defer，前 26 与 architecture §3.2 一致，末位 `tests/perf.js`；
   - 17 个 WebP 的 bytes/sha256 与 `assets/generated/SOURCES.md` 逐项一致；MANIFEST 17/17 ok；
   - 10 精灵 RGBA 四角 alpha=0；7 背景 RGB 不透明；
   - 加载链 generated → placeholder → missing；`assetDraw` 守卫；池 32/16/56；F3 不降级；
   - 透明 choice 弹层无背景、门派仍用 `ui-stele`；
   - 27 个 src JS 无远程 URL / 网络 API / `tools/art` 引用；无卡牌词；
   - 回归：integration 575/0、smoke 76/0、perf 52/0、background 31/0、loop 15/0、perf-integration 16/0、sect self-check 137/0、bench p95 0.117 ms PASS。
3. 产出：`docs/quality/wuxia-rogue-v2-report-v1.md`、`docs/verification/wuxia-rogue-v2-final-check.py`（只读脚本）。

## 未发卡原因（F1）

- `assets/generated/ui-scroll.webp` 存在且与 SOURCES 一致，但 `src/*.js` + `index.html` + `styles/theme.css` 检索 `ui-scroll` 命中 0。
- 透明弹层改造后该背景不再被使用 → 准确口径为 **17/17 生成、16/17 运行时引用**，与派发「17 项已全部接入」不符；AC-13 ② 逐项核对不完全满足。
- 待幕僚确认：登记为「保留但不使用」并修正表述，或重新接入；确认后再复核并发卡。

## 其他限制

- `sword-qi` 仅占位（README 已登记，bridge 允许）。
- AC-9 ~ AC-13 真实浏览器目视未进行；Node bench 非浏览器帧率。
