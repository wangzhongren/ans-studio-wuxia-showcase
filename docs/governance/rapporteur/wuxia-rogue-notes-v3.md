# 策划工作记录 · wuxia-rogue v2（需求变更扩编）

- flowId: wuxia-rogue；intentId: wuxia-rogue-map（原样复制，两处与入口 `docs/intents/wuxia-rogue-map.md` 一致）
- 依据：`docs/product/wuxia-rogue-intent-v2.md`（v2，S9~S13 / AC-9~AC-13）；v1 的 S1~S8 / AC-1~AC-8 继续有效
- 基线（只读）：proposal v1、modules v1、roster v5、architecture v1

## 1. 本版产物（全部新版本，未改旧版）

| 类型 | 文件 | 版本 | 关键变化 |
| --- | --- | --- | --- |
| 方案 | `docs/proposals/wuxia-rogue-proposal-v2.md` | 2 | 开始页、三门派（剑宗/刀门/医谷）、升级三选一（卷轴/石碑，非卡牌）、结算评分 S/A/B/C、AI 美术流水线与降级 |
| 模块 | `docs/proposals/wuxia-rogue-modules-v2.md` | 2 | 11 模块 = v1 的 9 个（路径/属主不变）+ `src/sects/` + `tools/art/` |
| 名单 | `docs/proposals/wuxia-rogue-roster-v6.md` | 6 | 8 角色 = v1 的 6 个 + `sect-designer` + `art-generator`；management 含 convener 与全部角色 |
| 架构 | `docs/contracts/wuxia-rogue-architecture-v2.md` | 2 | 新增 `WG.sects.*`、`Loop.pause/resume`、`WG.ui.ScreenFlow/Overlays/score`、事件 `sect:selected/choice:offer/choice:pick/run:result`、脚本顺序 26 个、素材流水线与 AC-9~13 |

## 2. 关键设计决定

1. **不做卡牌**：三选一以「卷轴/石碑」呈现，类名禁用 card/deck/hand，选项池为数值/技能强化；与 v1「无卡牌」一致。
2. **门派固定三个**：剑宗（攻速）、刀门（爆发/暴击）、医谷（高 HP + 缓慢回血）；数值写入方案 §5.2。
3. **属性写入收敛**：v1 由 loot 自动成长；v2 改由 `WG.sects.Selection` 唯一写 `combat.player.stats`，loot 只发 `level:up`（同时修复 AC-8：`Progression.reset()`/`LootSystem.reset()`）。
4. **结算可复现**：评分 `WG.ui.score()` 为纯函数，结算页直出同一统计对象，避免「页面值与公式不一致」。
5. **美术离线化**：`tools/art/` 不进运行时；生成 → 校验 → env-bootstrap 转 WebP 接入 `assets/generated/` + `SOURCES.md`；失败保留占位并在 MANIFEST/SOURCES 如实记录（AC-13）。
6. **边界不扩张**：v1 的 9 个模块路径与属主全部保留；新增 2 个模块只由 2 个新岗位持有，需按名单 v6 任命。

## 3. 自检

- 结构自检脚本：`docs/governance/rapporteur/check-v2.py`（stdlib，只读）
- 结果：`OK` —— 11 模块 id/字段与权威模块清单逐字一致；8 角色、每模块唯一属主；拓扑 modules/roles/management 与 frontmatter 一致（management = convener + 8 角色）；13 条路径无重叠/嵌套；env-resources=env、entry-index=entry，`envBootstrap.omitted=false`。
- 架构锚点：modules v2 的 11 个 `architectureSource` 锚点在 architecture v2 中全部存在。
- intentId/flowId：四份文档一致（`wuxia-rogue-map` / `wuxia-rogue`），引用 intent v2。

## 4. 遗留 / 交接

- 任命：roster v6 新增 2 岗位，需 convener 依名单发起任命并写卡（策划不写角色卡）。
- 实现注意：v1 提案 §6.4 累计经验表有勘误（Lv5=296/Lv8=824/Lv12=2024 与公式 `40+24n` 不符），实现以公式为准（正确值 304/784/1760）；v2 沿用同一曲线，已在提案 v2 中按公式重算。
- 验收：AC-9~AC-13 需真机浏览器人工目视（意图 v2 要求），验收卡由质检发起，策划不发卡。
