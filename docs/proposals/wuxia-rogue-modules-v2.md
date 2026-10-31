---
schema: project-modules/v2
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 2
author: rapporteur
status: draft
intent: docs/product/wuxia-rogue-intent-v2.md
proposal: docs/proposals/wuxia-rogue-proposal-v2.md
architecture: docs/contracts/wuxia-rogue-architecture-v2.md
createdAt: 2026-10-31
modules:
  - id: env-resources
    name: 环境资源（样式与素材）
    purpose: 全局样式、字体、占位素材与 Qwen-Image-2.1 生成素材的统一存放与接入
    paths:
      - styles/
      - assets/
    category: env
    publicContract: styles/theme.css 提供 CSS 变量与画布容器布局；assets/generated/ 存放生成并接入的 PNG/WebP 与 SOURCES.md，其余 assets/ 为占位
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#31-env-resources
  - id: entry-index
    name: 入口与启动
    purpose: 页面入口与一键启动脚本，固定脚本加载顺序（含 v2 新增模块）
    paths:
      - index.html
      - run.cmd
    category: entry
    publicContract: index.html 按固定顺序加载 src/core → src/loot → src/sects → src/combat → src/monsters → src/fx → src/ui → src/core/main.js
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#32-entry-index
  - id: core-runtime
    name: 核心运行时
    purpose: 固定步长循环、输入、相机、空间哈希、对象池、种子随机、事件总线、暂停控制与组合根
    path: src/core/
    category: lib
    publicContract: 全局 WG.core.{Loop,Input,Camera,SpatialHash,Pool,Rng,Bus,CONFIG} 与 WG.core.boot()；Loop.pause/resume 供升级选择与界面暂停
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#41-core-runtime
  - id: perf-harness
    name: 性能与验收工装
    purpose: F3 性能面板、帧预算统计、时间加速与复现钩子、无头基准脚本
    path: tests/
    category: test
    publicContract: WG.perf.{overlay,stats,fastForward,spawnBurst}；URL 参数 ?seed= 与 timescale= 的复现约定
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#42-perf-harness
  - id: combat-player
    name: 角色与自动攻击
    purpose: 玩家移动/闪身/索敌/剑气发射/命中判定/玩家属性结算，接收门派初始属性与升级加成
    path: src/combat/
    category: feature
    publicContract: WG.combat.{Player,CombatSystem}，暴露 player.stats 与 damage 事件；属性写入经 WG.sects 应用
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#43-combat-player
  - id: monsters-waves
    name: 怪物与刷怪导演
    purpose: 怪物生成与 AI、三类普通怪 + 精英、刷怪曲线与波次节奏、同屏上限控制
    path: src/monsters/
    category: feature
    publicContract: WG.monsters.{MonsterSystem,Director}，监听 level:up 读取难度，发出 monster:killed
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#44-monsters-waves
  - id: loot-progression
    name: 掉落与经验
    purpose: 掉落表、拾取与磁吸、经验结算与升级曲线（升级后由 sects 提供三选一，不再自动成长）
    path: src/loot/
    category: feature
    publicContract: WG.loot.{LootSystem,Progression}，发出 loot:drop / loot:picked / level:up；不再直接写玩家属性
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#45-loot-progression
  - id: visual-fx
    name: 视觉特效
    purpose: 粒子、伤害数字、受击白闪、震屏、剑雨与技能特效、自动降级开关
    path: src/fx/
    category: feature
    publicContract: WG.fx.{damageNumber,burst,shake,aura}，全部走对象池与上限
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#46-visual-fx
  - id: hud-ui
    name: 界面与流程
    purpose: 开始介绍页、门派选择、升级三选一面板、HUD、结算评分页与再来一局
    path: src/ui/
    category: ui
    publicContract: WG.ui.{HUD,ScreenFlow,Overlays,score}，只读订阅状态，不反向写玩法
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#47-hud-ui
  - id: sects-progression
    name: 门派与升级选择
    purpose: 剑宗/刀门/医谷定义与初始属性、升级三选一选项池、选择状态与属性应用
    path: src/sects/
    category: feature
    publicContract: WG.sects.{DEFS,UpgradePool,Selection}，发出 choice:offer / choice:pick / sect:selected，应用成长写回 combat.player.stats
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#48-sects-progression
  - id: art-pipeline
    name: AI 美术生成流水线
    purpose: 本机 Qwen-Image-2.1 素材生成的提示词、脚本、原始出图与生成记录（离线、可复现、失败留痕）
    path: tools/art/
    category: lib
    publicContract: tools/art/scripts/*.py、tools/art/prompts/*.md、tools/art/out/*.png 与 tools/art/MANIFEST.json；产物由 env-bootstrap 接入 assets/generated/
    architectureSource: docs/contracts/wuxia-rogue-architecture-v2.md#49-art-pipeline
---

# 模块清单 · 江湖夜雨（wuxia-rogue）v2

> 与 `docs/proposals/wuxia-rogue-proposal-v2.md` 第 7 节、`docs/proposals/wuxia-rogue-roster-v6.md` 完全一致。
> 基线：v1 模块清单 `docs/proposals/wuxia-rogue-modules-v1.md`（9 模块）。v2 新增 2 个模块，v1 的 9 个模块 **id/路径/属主不变**。
> 规则：一个模块一个属主；模块路径互不重叠、互不嵌套；同父级的文件与目录可共存。

## 模块表（11 个）

| id | name | path / paths | category | 变化 |
| --- | --- | --- | --- | --- |
| env-resources | 环境资源（样式与素材） | `styles/`、`assets/` | env | 扩展职责：接入 `assets/generated/` |
| entry-index | 入口与启动 | `index.html`、`run.cmd` | entry | 脚本顺序加入 `src/sects/` |
| core-runtime | 核心运行时 | `src/core/` | lib | 新增 `Loop.pause/resume` |
| perf-harness | 性能与验收工装 | `tests/` | test | 不变 |
| combat-player | 角色与自动攻击 | `src/combat/` | feature | 接收门派/升级加成 |
| monsters-waves | 怪物与刷怪导演 | `src/monsters/` | feature | 不变 |
| loot-progression | 掉落与经验 | `src/loot/` | feature | 升级后不再自动成长 |
| visual-fx | 视觉特效 | `src/fx/` | feature | 不变 |
| hud-ui | 界面与流程 | `src/ui/` | ui | 新增开始页/门派选择/三选一/结算评分 |
| **sects-progression** | **门派与升级选择** | `src/sects/` | feature | **新增** |
| **art-pipeline** | **AI 美术生成流水线** | `tools/art/` | lib | **新增** |

共 11 个模块（1–12 项范围内）。目录树预览：

```
index.html            entry-index
styles/               env-resources
assets/               env-resources   （assets/generated/ 为生成素材接入位）
assets/generated/     env-resources
src/core/             core-runtime
src/combat/           combat-player
src/monsters/         monsters-waves
src/loot/             loot-progression
src/fx/               visual-fx
src/ui/               hud-ui
src/sects/            sects-progression   ← 新增
tools/art/            art-pipeline        ← 新增
tests/                perf-harness
```

（`run.cmd` 同属 entry-index，图中省略。）

## 路径合法性自检

- 无重叠：`styles/`、`assets/`、`index.html`、`run.cmd`、`src/core/`、`src/combat/`、`src/monsters/`、`src/loot/`、`src/fx/`、`src/ui/`、`src/sects/`、`tools/art/`、`tests/` 两两不同，且互不为前缀。
- 不嵌套：`src/sects/` 与 `src/core/` 等为 `src/` 下兄弟目录；`tools/art/` 为 `tools/` 下独立目录，均未被其他模块占用。
- `assets/generated/` 是 `assets/` 的子目录，同属 env-resources 一个模块（模块内部子目录，不构成跨模块嵌套）。
- 同父文件与目录共存：根目录 `index.html`/`run.cmd`（文件）与 `styles/`、`assets/`、`src/`、`tools/`、`tests/`（目录）并存。
- 固定模块：`env-resources`（category=env）2 个路径、`entry-index`（category=entry）2 个路径，均在 1–20 内。

## 与 v1 的兼容/替换

- 新增模块为**纯增量**，不占用任何 v1 模块路径；v1 的 9 个模块属主不变。
- 行为变化（属主内的职责调整，非路径变更）：`loot-progression` 不再自动加属性，改为发 `level:up`；`sects-progression` 提供三选一并应用成长；`hud-ui` 新增四类界面；`env-resources` 负责生成素材接入。

## 与角色的绑定

见 `docs/proposals/wuxia-rogue-roster-v6.md`：env-bootstrap（env-resources、entry-index）、core-engine（core-runtime、perf-harness）、combat-player（combat-player）、monsters-director（monsters-waves）、loot-progression（loot-progression）、presentation-fx（visual-fx、hud-ui）、**sect-designer（sects-progression，新增）**、**art-generator（art-pipeline，新增）**。每个模块恰好一个属主。
