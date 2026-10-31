---
schema: project-modules/v2
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 1
author: rapporteur
status: draft
intent: docs/product/wuxia-rogue-intent-v1.md
proposal: docs/proposals/wuxia-rogue-proposal-v1.md
architecture: docs/contracts/wuxia-rogue-architecture-v1.md
createdAt: 2026-10-31
modules:
  - id: env-resources
    name: 环境资源（样式与占位素材）
    purpose: 提供全局样式、字体与程序化占位美术/音效资源，保证零依赖可运行
    paths:
      - styles/
      - assets/
    category: env
    publicContract: styles/theme.css 提供 CSS 变量与画布容器布局；assets/ 为占位素材目录（自绘，无第三方版权素材）
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#31-env-resources
  - id: entry-index
    name: 入口与启动
    purpose: 页面入口与 Windows 一键启动脚本，固定脚本加载顺序
    paths:
      - index.html
      - run.cmd
    category: entry
    publicContract: index.html 按固定顺序加载 src/core → src/loot → src/combat → src/monsters → src/fx → src/ui → src/core/main.js
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#32-entry-index
  - id: core-runtime
    name: 核心运行时
    purpose: 固定步长循环、输入、相机、空间哈希、对象池、种子随机、事件总线与组合根
    path: src/core/
    category: lib
    publicContract: 全局 WG.core.{Loop,Input,Camera,SpatialHash,Pool,Rng,Bus,CONFIG} 与 WG.core.boot()
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#41-core-runtime
  - id: perf-harness
    name: 性能与验收工装
    purpose: F3 性能面板、帧预算统计、时间加速与复现钩子、无头基准脚本
    path: tests/
    category: test
    publicContract: WG.perf.{overlay,stats,fastForward}；URL 参数 ?seed= & timescale= 的复现约定
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#42-perf-harness
  - id: combat-player
    name: 角色与自动攻击
    purpose: 玩家移动/闪身/索敌/剑气发射/命中判定/玩家属性结算
    path: src/combat/
    category: feature
    publicContract: WG.combat.{Player,CombatSystem}，对外暴露 player.stats 与 damage(event) 事件
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#43-combat-player
  - id: monsters-waves
    name: 怪物与刷怪导演
    purpose: 怪物生成与 AI、三类普通怪 + 精英、刷怪曲线与波次节奏、同屏上限控制
    path: src/monsters/
    category: feature
    publicContract: WG.monsters.{MonsterSystem,Director}，监听 level:up 读取难度，发出 monster:killed
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#44-monsters-waves
  - id: loot-progression
    name: 掉落与成长
    purpose: 掉落表、拾取与磁吸、经验结算、升级曲线、里程碑技能解锁与属性成长
    path: src/loot/
    category: feature
    publicContract: WG.loot.{LootSystem,Progression}，发出 loot:drop / loot:picked / level:up / ability:unlock
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#45-loot-progression
  - id: visual-fx
    name: 视觉特效
    purpose: 粒子、伤害数字、受击白闪、震屏、剑雨特效与自动降级开关
    path: src/fx/
    category: feature
    publicContract: WG.fx.{damageNumber,burst,shake,aura}，全部走对象池与上限
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#46-visual-fx
  - id: hud-ui
    name: 界面与流程
    purpose: 标题、HUD、结算、重开与调试叠层
    path: src/ui/
    category: ui
    publicContract: WG.ui.{HUD,ScreenFlow}，只读订阅状态，不反向写玩法
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#47-hud-ui
---

# 模块清单 · 江湖夜雨（wuxia-rogue）v1

> 与 `docs/proposals/wuxia-rogue-proposal-v1.md` 第 7 节、`docs/proposals/wuxia-rogue-roster-v1.md` 完全一致。
> 规则：一个模块一个属主；模块路径互不重叠、互不嵌套；同父级的文件与目录可共存。

## 模块表

| id | name | path / paths | category | publicContract |
| --- | --- | --- | --- | --- |
| env-resources | 环境资源 | `styles/`、`assets/` | env | CSS 变量、素材目录约定 |
| entry-index | 入口与启动 | `index.html`、`run.cmd` | entry | 固定脚本加载顺序 |
| core-runtime | 核心运行时 | `src/core/` | lib | `WG.core.*` |
| perf-harness | 性能与验收工装 | `tests/` | test | `WG.perf.*`、URL 复现参数 |
| combat-player | 角色与自动攻击 | `src/combat/` | feature | `WG.combat.*` |
| monsters-waves | 怪物与刷怪导演 | `src/monsters/` | feature | `WG.monsters.*` |
| loot-progression | 掉落与成长 | `src/loot/` | feature | `WG.loot.*` |
| visual-fx | 视觉特效 | `src/fx/` | feature | `WG.fx.*` |
| hud-ui | 界面与流程 | `src/ui/` | ui | `WG.ui.*` |

共 9 个模块（1–12 项范围内）。目录树预览：

```
index.html            entry-index
run.cmd               entry-index
styles/               env-resources
assets/               env-resources
src/core/             core-runtime
src/combat/           combat-player
src/monsters/         monsters-waves
src/loot/             loot-progression
src/fx/               visual-fx
src/ui/               hud-ui
tests/                perf-harness
```

## 路径合法性自检

- 无重叠：`styles/`、`assets/`、`index.html`、`run.cmd`、`src/core/`、`src/combat/`、`src/monsters/`、`src/loot/`、`src/fx/`、`src/ui/`、`tests/` 两两不同，且互不为前缀。
- 不嵌套：`src/*` 同属 `src/` 下的兄弟目录，各自独立；没有 `src/` 整体被某模块占用。
- 同父文件与目录共存：根目录下 `index.html`/`run.cmd`（文件）与 `styles/`、`assets/`、`src/`、`tests/`（目录）并存，属合法情形。
- 固定模块：`env-resources`（category=env）2 个路径、`entry-index`（category=entry）2 个路径，均在 1–20 范围内。

## 与角色的绑定

见 `docs/proposals/wuxia-rogue-roster-v1.md`：env-bootstrap（env-resources、entry-index）、core-engine（core-runtime、perf-harness）、combat-player（combat-player）、monsters-director（monsters-waves）、loot-progression（loot-progression）、presentation-fx（visual-fx、hud-ui）。每个模块恰好一个属主。
