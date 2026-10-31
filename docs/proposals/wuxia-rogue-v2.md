---
schema: project-proposal/v2
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 2
author: rapporteur
status: draft
title: 江湖夜雨 · 武侠大地图 Roguelike 原型策划方案 v2（体验闭环与 AI 美术）
intent: docs/product/wuxia-rogue-intent-v2.md
modules: docs/proposals/wuxia-rogue-modules-v2.md
supersedes: docs/proposals/wuxia-rogue-proposal-v1.md
createdAt: 2026-10-31
---

# 江湖夜雨 · 武侠大地图 Roguelike 原型（wuxia-rogue）策划方案 v2

> **规范路径物证说明**：本文件是 `docs/proposals/wuxia-rogue-proposal-v2.md`（本次待接受的提案，sha256 78ad52a1…）的**同一 v2 规范路径物证**——同一 `flowId=wuxia-rogue`、同一 `version=2`、同一 `intentId=wuxia-rogue-map`，正文内容一致，未新增版本、未改写任何已钉文件。按验收链要求的规范命名 `docs/proposals/<flowId>-v2.md` 提供可读物证；两者内容冲突时以 `wuxia-rogue-proposal-v2.md` 为准。

> 依据：`docs/product/wuxia-rogue-intent-v2.md`（intentId=`wuxia-rogue-map`，version 2；v1 的 S1~S8/AC-1~AC-8 继续有效）
> 基线方案：`docs/proposals/wuxia-rogue-proposal-v1.md`（v1，只读）
> 模块清单：`docs/proposals/wuxia-rogue-modules-v2.md`（project-modules/v2，11 模块）
> 人员名单：`docs/proposals/wuxia-rogue-roster-v6.md`（project-roster/v3）
> 架构契约：`docs/contracts/wuxia-rogue-architecture-v2.md`

## 1. 版本与范围

- **v2 增量**：S9 开始介绍页、S10 结算评分页、S11 开局门派选择、S12 升级三选一（非卡牌）、S13 本地 Qwen-Image-2.1 素材生成与替换。
- **继承 v1**：大地图/自动攻击/掉落拾取/后期清屏/8 分钟一局/非卡牌/桌面零依赖运行；AC-1~AC-8 继续有效。
- **覆盖点**：v1「升级自动成长」的**获得方式**由 v2「升级三选一」取代；AC-5「升级带来可观察成长」仍成立（选择后立即生效并可核对）。
- **不做**：抽牌/手牌/牌组/构筑/回合制卡牌对战；联机、账号、商业化、剧情线；运行时联网或加载模型。

## 2. 方案摘要

打开游戏先看到**开始介绍页**（游戏名 + 玩法说明 + 开始入口）→ 选**门派**（剑宗/刀门/医谷）→ 进入战斗（v1 循环不变）→ 每次升级**暂停并弹出三选一成长面板**（卷轴/石碑样式）→ 8 分钟通关或死亡 → **结算评分页**（S/A/B/C + 战绩 + 再来一局）。美术用本机 Qwen-Image-2.1 离线生成 PNG/WebP 放入 `assets/generated/`，运行时零模型、零联网。

界面状态机：

```
title（开始介绍页）
  └─ 开始游戏 → sect（门派选择）
        └─ 选定门派 → playing（战斗，可多次进入 choice 覆盖层）
              ├─ 升级 → choice（暂停 + 三选一）→ 选择后回 playing
              └─ 结束（win / dead）→ result（结算评分页）
                    ├─ 再来一局 → sect
                    └─ 返回标题 → title
```

## 3. 开始介绍页（S9 / AC-9）

### 3.1 版面

- 全屏背景（生成素材 `title-bg`，失败则用程序化水墨渐变占位）。
- 主标题「江湖夜雨」+ 副标题「武侠 · 大地图 · 自动战斗」。
- **介绍区（可阅读面板，不能是一行小字）**，三块：
  1. **目标**：在 8 分钟内变强，撑过血月怪潮；
  2. **操作**：WASD/方向键走位，Shift 闪身，攻击自动触发；
  3. **核心循环**：击杀 → 掉落 → 拾取 → 升级（三选一）→ 更强 → 清屏。
- 醒目按钮「开始游戏」（Enter 或点击），点击后进入门派选择。
- 右下角小字：版本 v2、F3 性能面板。

### 3.2 验收对应（AC-9）

启动即 `title` 状态；三块介绍区均可见；点击开始进入 `sect`（而非直接开打）。

## 4. 开局门派选择（S11 / AC-11）

### 4.1 三个门派（固定）

| 门派 | 定位 | 攻击力 | 攻击间隔 | 最大 HP | 移速 | 专属被动 |
| --- | --- | --- | --- | --- | --- | --- |
| **剑宗** | 攻速 | 10 | 0.42 s | 100 | 230 px/s | 每 3 级额外 +5% 攻速 |
| **刀门** | 爆发 | 18 | 0.70 s | 110 | 215 px/s | 暴击率 +10%，暴击伤害 ×1.6 |
| **医谷** | 生存/回复 | 9 | 0.60 s | 140 | 205 px/s | 每秒回血 1.5，受击减伤 5% |

（v1 基准：攻 12 / 间隔 0.55 / HP 100 / 移速 220；三门派据此偏移。）

### 4.2 选择界面

- 三张**竖幅卷轴式面板**（非卡牌：无牌堆/手牌/费用/稀有度抽取；卷轴=菜单样式）。
- 每张展示：门派名、定位、初始属性 4 项、专属成长方向（1~2 行）。
- 点击/方向键选择后高亮，二次确认（Enter）进入战斗；选择结果写入本局 `sectId`。
- 默认高亮剑宗，但**不自动确认**。

### 4.3 差异可核对

进入游戏后：攻击力/攻速/HP/移速与上表一致；剑宗攻速明显更快、刀门单击更痛、医谷更耐打且缓慢回血（HUD 与 F3 详表可核对）。

## 5. 升级三选一（S12 / AC-12）

### 5.1 触发与流程

- 每次升级（Lv2 起）→ `choice:offer`：**暂停战斗**（世界模拟暂停），弹出三选一面板。
- 恰好 **3 个可辨识选项**，每个含：名称、图标、一行效果说明、类型标签（通用/门派/绝学）。
- 玩家必须选其一（方向键/WASD 移动高亮 + Enter；或点击），**未选择前不自动替选**；选择后立即生效、面板消失、战斗恢复。
- 下一次升级再次提供 3 个新选项（可重复的通用项可再出现，已满级的排除）。

### 5.2 选项池

**通用（8 项，每项最多叠 5 层）**

| id | 名称 | 效果 |
| --- | --- | --- |
| power | 锋锐 | 攻击力 +15% |
| haste | 疾风 | 攻击间隔 -8%（下限 0.18 s） |
| swift | 身法 | 移速 +6% |
| vigor | 铁骨 | 最大 HP +15% 并回复 20 |
| magnet | 牵引 | 拾取/磁吸半径 +20% |
| pierce | 透劲 | 剑气穿透 +1 |
| multi | 分光 | 剑气数量 +1（上限 3） |
| reach | 长虹 | 剑气射程 +15% |

**门派专属（每门派 2 项，不可跨门派出现）**

| 门派 | id | 名称 | 效果 |
| --- | --- | --- | --- |
| 剑宗 | jz_combo | 连斩 | 剑气数量 +1（上限 3，可叠 2 层） |
| 剑宗 | jz_aura | 剑罡 | 攻速 +10%，剑气飞行速度 +15% |
| 刀门 | dm_cleave | 裂空 | 每 4 s 自动一次范围斩（半径 120，200% 攻击力） |
| 刀门 | dm_edge | 刀魄 | 暴击伤害 +30% |
| 医谷 | yg_herb | 药息 | 疗伤丹掉落率 +50%，拾取回复 +10 |
| 医谷 | yg_mend | 回春 | 受击减伤 +10%，每秒回血 +0.5 |

**绝学（v1 里程碑，作为该等级的保底选项之一）**

| 等级 | id | 名称 | 效果 |
| --- | --- | --- | --- |
| Lv3 | whirl | 剑气回旋 | 半径 95，每 1.5 s 18 伤害（v1 数值） |
| Lv5 | swords | 万剑归宗 | 每 12 s，半径 420 范围 60 伤害（v1 数值） |
| Lv8 | twin | 双剑气 | 自动攻击额外 1 道剑气 |

### 5.3 抽取规则（确定性，走种子 RNG）

1. 候选 = 通用池（未满层）+ 本门派专属池（未满层）；
2. 每级 3 个：**1 个门派专属**（无可选则用通用）+ **2 个通用**；不得重复；
3. 若该等级有绝学（Lv3/5/8），**第 1 个名额固定为该绝学**，其余 2 个从通用/专属抽取；
4. 不足 3 个时，用未满层的通用项补足；仍不足则减少数量（不重复填）；
5. 全部走 `?seed=` 同一 RNG，保证同种子同升级序列。

### 5.4 非卡牌口径（对齐 AC-12）

1. 无抽牌/牌堆/手牌/弃牌堆/牌组构筑/卡牌收集；
2. 选项升级时即时出现，选择后即消耗消失，**不跨局收集、不进卡组**；
3. 战斗仍为即时自动攻击 + 走位，无回合制；
4. 视觉为卷轴/石碑/光球样式，命名与 CSS 类不使用 card/deck/hand 等词。

## 6. 结算评分页（S10 / AC-10）

### 6.1 版面

死亡或 8:00 通关后**自动**进入 `result`（无需手动打开）：

- 标题：「血月退散」（胜利）/「力竭倒地」（失败）；
- 评分徽章：**S / A / B / C**，带对应颜色与一句评语；
- 战绩表：存活时间、等级、击杀数、拾取数、银两、最终攻击力（**与本局统计一致**）；
- 按钮：「再来一局」（→ 门派选择）、「返回标题」。

### 6.2 评分公式与阈值（纯函数，可核对）

```
score = 击杀数×2 + 拾取数×1 + 等级×100 + 银两×2 + 存活秒数×0.5
S: score ≥ 2000
A: 1500 ≤ score < 2000
B: 900  ≤ score < 1500
C: score < 900
```

示例（机械核对基线）：8 分钟、200 击杀、300 拾取、Lv10、120 银两 → 400+300+1000+240+240 = **2180 → S**；30 秒早死、5 击杀、Lv1 → 约 **131 → C**。

## 7. AI 美术生成与接入（S13 / AC-13）

### 7.1 环境事实（意图 v2 已核实）

- 模型：HF 缓存 `C:\Users\51054\.cache\huggingface\hub\models--Qwen--Qwen-Image-2.1`（snapshot `d26bb612…`，diffusers 管线 `QwenImage21Pipeline`；transformer ≈14.2 GB、text_encoder ≈17.5 GB、VAE 另计）。
- 硬件：RTX 4090 24 GB；Python 3.12.10；当前无 torch/diffusers/transformers/accelerate，**需一次性安装**（PyPI 可访问）；之后可离线生成（`HF_HUB_OFFLINE=1`）。
- 显存策略：24 GB 放不下全组件 → `enable_model_cpu_offload()`（或 sequential offload）+ fp16/bf16；单图分钟级；批量时逐张生成、固定 seed。

### 7.2 资产清单（首批 14 项）

| id | 用途 | 尺寸 | 接入位置 |
| --- | --- | --- | --- |
| title-bg | 开始页背景 | 1280×720 | assets/generated/title-bg.webp |
| player | 玩家角色 | 96×96 | assets/generated/player.webp |
| sect-jianzong / sect-daomen / sect-yigu | 门派卷轴主图 ×3 | 256×384 | assets/generated/sect-*.webp |
| monster-wanderer / monster-bowman / monster-blade | 怪物 ×3 | 96×96 | assets/generated/monster-*.webp |
| ui-scroll | 三选一卷轴底 | 1024×512 | assets/generated/ui-scroll.webp |
| ui-stele | 门派选择石碑框 | 1024×512 | assets/generated/ui-stele.webp |
| ui-result | 结算页背景 | 1280×720 | assets/generated/ui-result.webp |
| drop-xp / drop-silver / drop-potion | 掉落物 ×3 | 48×48 | assets/generated/drop-*.webp |

### 7.3 提示词与生成规范

- 每资产一份 `tools/art/prompts/<id>.md`：正向提示词、负向提示词、尺寸、步数、seed、模型 snapshot。
- 风格统一词：`中国武侠，水墨与写意，国风，低饱和，无文字，无边框水印`；负向：`文字, 水印, 现代物品, 卡牌, 牌面`（避免卡牌观感）。
- 固定 seed 写入 manifest；同 prompt+seed 可复现。
- 生成脚本 `tools/art/scripts/generate.py`：读清单 → 逐张生成 → `tools/art/out/` → 更新 `tools/art/MANIFEST.json`。

### 7.4 接入流程（分工）

1. **art-generator**：生成原图到 `tools/art/out/`，写 `MANIFEST.json`（id、prompt 文件、seed、status=ok/failed、耗时、备注）。
2. **env-bootstrap（资产属主）**：把 `status=ok` 的图压缩为 WebP 放入 `assets/generated/`，写 `assets/generated/SOURCES.md`（哪些生成、哪些占位）；更新 `index.html`/样式引用。
3. **presentation-fx**：在 UI 代码中引用 `assets/generated/*`，加载失败自动回退占位（不阻塞运行）。
4. **运行时**：只读本地 assets，不联网、不加载模型、不依赖 Python。

### 7.5 失败降级（必须如实记录）

- 生成失败（OOM/超时/依赖缺失）：**保留原占位**，在 `MANIFEST.json` 标 `failed` + 原因，并在 `assets/generated/SOURCES.md` 标注「占位」。
- 不得用占位冒充生成素材，不得虚报成功率；AC-13 第 ④ 条以记录为准。
- 若环境未装依赖：先在 `tools/art/README.md` 写安装清单（torch cu12x、diffusers、transformers、accelerate、pillow），由 art-generator 执行一次安装。

## 8. 运行与验收方式

- 启动：双击 `index.html` / `run.cmd`；推荐 Edge/Chrome；零联网、零构建。
- 调试：`?seed=` 复现；`?timescale=` 加速；F3 性能面板；F4 跳 5:30；F5 怪潮。
- 验收：AC-9~AC-13 **必须在真实浏览器人工目视**（意图 v2 §5 明确不接受截图/自述）；AC-1~AC-8 沿用 v1 口径。
- 复现要点：`?seed=1234` 下同操作路径两次，界面/评分/升级序列一致。

## 9. 模块清单（11 个，与模块文档/名单一致）

| id | 名称 | 路径 | category | 属主角色 |
| --- | --- | --- | --- | --- |
| env-resources | 环境资源（样式与素材） | `styles/`、`assets/` | env | env-bootstrap |
| entry-index | 入口与启动 | `index.html`、`run.cmd` | entry | env-bootstrap |
| core-runtime | 核心运行时 | `src/core/` | lib | core-engine |
| perf-harness | 性能与验收工装 | `tests/` | test | core-engine |
| combat-player | 角色与自动攻击 | `src/combat/` | feature | combat-player |
| monsters-waves | 怪物与刷怪导演 | `src/monsters/` | feature | monsters-director |
| loot-progression | 掉落与经验 | `src/loot/` | feature | loot-progression |
| visual-fx | 视觉特效 | `src/fx/` | feature | presentation-fx |
| hud-ui | 界面与流程 | `src/ui/` | ui | presentation-fx |
| sects-progression | 门派与升级选择 | `src/sects/` | feature | **sect-designer（新增）** |
| art-pipeline | AI 美术生成流水线 | `tools/art/` | lib | **art-generator（新增）** |

## 10. 验收映射（v2 增量）

| AC | 方案如何满足 | 观察证据 |
| --- | --- | --- |
| AC-9 开始页 | 独立 title 状态，含标题/三块说明/开始按钮 | 启动先见开始页；点击进入门派选择 |
| AC-10 结算评分页 | 结束自动进 result，战绩 + S/A/B/C + 再来一局 | 数值与过程一致；按钮可开新局 |
| AC-11 门派选择 | 3 门派竖幅卷轴，初始属性差异 + 专属被动 | 选不同门派，攻速/攻击/HP 可观察不同 |
| AC-12 升级三选一 | 升级暂停弹 3 选项，选择即生效，不自动选 | 面板出现、选后属性变化、下次升级再来 3 个 |
| AC-13 素材替换 | Qwen 生成 WebP 入 assets/generated/，运行时零依赖 | 断网可玩；目录与 manifest 可核对；观感明显区别于占位 |

v1 AC-1~AC-8 沿用不变；AC-5 由「三选一后属性可核对」满足。

## 11. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 24 GB 显存不足/依赖未装 | 素材生成失败 | CPU offload + fp16；失败保留占位并记录；先装依赖再批量 |
| 生成风格不统一/带文字 | AC-13 观感差 | 统一风格词 + 负向提示词；逐张验收，不达标重生成 |
| 三选一被做成卡牌观感 | AC-7/AC-12 风险 | 卷轴/石碑样式，禁用 card/deck/hand 命名与图标 |
| 升级暂停导致节奏断裂 | 手感 | 暂停仅覆盖选择期间，选择后立即恢复；面板小而轻 |
| 评分与统计不一致 | AC-10 不通过 | 评分纯函数只读本局统计；结算页数值直出同一对象 |
| 新模块路径与既有冲突 | 名单结构失败 | `src/sects/`、`tools/art/` 为全新目录，已做两两前缀自检 |

## 12. 版本与引用

- 本文件 v2 只读；后续变更出 v3，并同步 modules/roster/architecture 版本。
- 引用：intent v2（`docs/product/wuxia-rogue-intent-v2.md`）、modules v2、roster v6、architecture v2；v1 方案作为基线只读。
