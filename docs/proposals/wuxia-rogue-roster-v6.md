---
schema: project-roster/v3
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 6
author: rapporteur
status: draft
title: 江湖夜雨 · 人员名单（wuxia-rogue）v6（扩编）
createdAt: 2026-10-31
intent: docs/product/wuxia-rogue-intent-v2.md
proposal: docs/proposals/wuxia-rogue-proposal-v2.md
modulesDoc: docs/proposals/wuxia-rogue-modules-v2.md
architecture: docs/contracts/wuxia-rogue-architecture-v2.md
references:
  intent: docs/product/wuxia-rogue-intent-v2.md
  proposal: docs/proposals/wuxia-rogue-proposal-v2.md
  modules: docs/proposals/wuxia-rogue-modules-v2.md
  architecture: docs/contracts/wuxia-rogue-architecture-v2.md
envBootstrap:
  omitted: false
  note: 默认必带；env-resources 与 entry-index 两个固定模块均由该角色持有，并负责生成素材接入 assets/generated/
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
roles:
  - id: env-bootstrap
    displayName: 环境与入口装配
    purpose: 让原型在任何 Windows 机器上双击即开；提供样式基座与占位素材，并接入生成素材到 assets/generated/
    capability: 静态前端装配、HTML/CSS、Windows 启动脚本（cmd）、资源目录与素材接入管理
    modules:
      - env-resources
      - entry-index
  - id: core-engine
    displayName: 引擎与性能
    purpose: 提供稳定、可测的运行时基座：固定步长循环、输入、相机、空间哈希、对象池、暂停控制与性能工装
    capability: JavaScript 游戏循环与渲染管线、空间索引/碰撞、对象池与 GC 控制、性能剖析与降级策略
    modules:
      - core-runtime
      - perf-harness
  - id: combat-player
    displayName: 角色操控与自动攻击
    purpose: 玩家走位/闪身手感，自动攻击索敌与命中结算，并承接门派初始属性与升级加成
    capability: 2D 动作手感调优、索敌与投射物系统、碰撞/命中判定、数值结算
    modules:
      - combat-player
  - id: monsters-director
    displayName: 怪物与刷怪导演
    purpose: 怪物 AI 与刷怪曲线，把后期同屏密度推到 200~300 只并保持可玩
    capability: 行为 AI（追击/远程/冲锋）、刷怪导演与难度曲线、波次节奏、实体容量管理
    modules:
      - monsters-waves
  - id: loot-progression
    displayName: 掉落与经验
    purpose: 掉落、拾取、经验与升级事件；成长选择交由门派与升级选择岗位
    capability: 概率掉落、拾取交互、经验曲线与经济数值
    modules:
      - loot-progression
  - id: presentation-fx
    displayName: 表现与界面
    purpose: 把「满屏清怪」做成看得见的爽感，并承载开始页、门派选择、三选一面板与结算评分页
    capability: Canvas 粒子与特效、伤害数字与震屏、DOM HUD 与覆盖层、性能受控的视觉反馈
    modules:
      - visual-fx
      - hud-ui
  - id: sect-designer
    displayName: 门派与技能设计
    purpose: 设计并实现剑宗/刀门/医谷的初始属性、专属被动与升级三选一池（含效果、稀有度、抽取规则）
    capability: 动作 Roguelike 数值与技能设计、成长曲线与构筑平衡、状态效果实现（JS）、非卡牌化交互设计
    modules:
      - sects-progression
  - id: art-generator
    displayName: AI 美术生成流水线
    purpose: 用本机 Qwen-Image-2.1 离线生成武侠美术，维护提示词/脚本/原始出图/生成记录，并与资产属主交接
    capability: diffusers 管线与 Qwen-Image 推理、24 GB 显存 offload 策略、提示词工程、图像后处理与 WebP 转换、生成记录与失败降级
    modules:
      - art-pipeline
---

# 人员名单 · 江湖夜雨（wuxia-rogue）v6（扩编）

> 依据意图：`docs/product/wuxia-rogue-intent-v2.md`（intentId=`wuxia-rogue-map`，version 2）
> 依据方案：`docs/proposals/wuxia-rogue-proposal-v2.md`（v2）
> 权威模块清单：`docs/proposals/wuxia-rogue-modules-v2.md`（v2，模块快照逐字复制）
> 架构契约：`docs/contracts/wuxia-rogue-architecture-v2.md`（v2）
> 上一版名单：`docs/proposals/wuxia-rogue-roster-v5.md`（v5，v1 基线，只读）
> 本名单是招人的唯一依据；不含角色卡内容（角色卡由人事环节依据本名单撰写）。

## 1. 人员名单（8 角色 / 11 模块）

| 角色 id | 名称 | 职责 | 所需技能 | 持有模块 |
| --- | --- | --- | --- | --- |
| env-bootstrap | 环境与入口装配 | 页面入口、脚本加载顺序、一键启动、全局样式与占位素材、生成素材接入 | 静态前端装配、HTML/CSS、Windows cmd 启动脚本、素材接入管理 | env-resources、entry-index |
| core-engine | 引擎与性能 | 固定步长循环、输入、相机、空间哈希、对象池、暂停控制、F3 性能工装与降级 | JS 渲染管线、空间索引与碰撞、对象池/GC 控制、性能剖析 | core-runtime、perf-harness |
| combat-player | 角色操控与自动攻击 | 移动/闪身手感、索敌、剑气发射、命中与伤害结算、承接门派与升级加成 | 2D 动作手感、投射物与命中判定、数值结算 | combat-player |
| monsters-director | 怪物与刷怪导演 | 三类怪 + 精英 AI、刷怪曲线与波次、同屏上限与难度成长 | 行为 AI、刷怪导演/难度曲线、实体容量管理 | monsters-waves |
| loot-progression | 掉落与经验 | 掉落表、拾取与磁吸、经验与升级事件（不再自动加属性） | 概率掉落、拾取交互、经验曲线 | loot-progression |
| presentation-fx | 表现与界面 | 粒子/伤害数字/震屏/剑雨；开始页、门派选择、三选一面板、结算评分页 | Canvas 特效、DOM HUD 与覆盖层、评分与数据展示 | visual-fx、hud-ui |
| **sect-designer** | **门派与技能设计** | 三门派初始属性与专属被动、升级三选一池、抽取规则与效果实现 | 动作 Roguelike 数值/技能设计、平衡调校、状态效果实现、非卡牌化交互 | **sects-progression** |
| **art-generator** | **AI 美术生成流水线** | Qwen-Image-2.1 提示词/脚本/出图/记录，交给资产属主接入 | diffusers/Qwen-Image 推理、显存 offload、提示词工程、图像后处理、失败降级 | **art-pipeline** |

**v2 扩编说明（客户明确要求新增岗位）**：
- 新增 `sect-designer`：专职门派/技能设计与实现，不塞给 combat-player 或 loot-progression；
- 新增 `art-generator`：专职 AI 美术生成流水线，不塞给 env-bootstrap（env-bootstrap 只负责把成品接入 `assets/generated/`）。

## 2. 模块属主与路径（一模块一属主，路径不重叠）

| 模块 id | 属主角色 | 路径 | category | 与 v1 关系 |
| --- | --- | --- | --- | --- |
| env-resources | env-bootstrap | `styles/`、`assets/` | env | 路径不变，扩展接入职责 |
| entry-index | env-bootstrap | `index.html`、`run.cmd` | entry | 路径不变，脚本顺序扩展 |
| core-runtime | core-engine | `src/core/` | lib | 路径不变，新增暂停控制 |
| perf-harness | core-engine | `tests/` | test | 不变 |
| combat-player | combat-player | `src/combat/` | feature | 路径不变，承接加成 |
| monsters-waves | monsters-director | `src/monsters/` | feature | 不变 |
| loot-progression | loot-progression | `src/loot/` | feature | 路径不变，成长移出 |
| visual-fx | presentation-fx | `src/fx/` | feature | 不变 |
| hud-ui | presentation-fx | `src/ui/` | ui | 路径不变，界面扩展 |
| **sects-progression** | **sect-designer** | `src/sects/` | feature | **新增** |
| **art-pipeline** | **art-generator** | `tools/art/` | lib | **新增** |

- v1 的 9 个模块路径与属主全部保持不变（未擅自扩张既有角色边界）；新增 2 个模块为纯增量。
- 每个模块只有一个属主，无共享目录；跨模块改动走架构契约接口与事件。
- 固定角色 `env-bootstrap` 未省略（`envBootstrap.omitted=false`），仍只持有 `env`（env-resources）与 `entry`（entry-index）两个固定模块。

## 3. 人员+模块拓扑图

```topology
schema: project-topology/v2
modules:
  - id: env-resources
    paths:
      - styles/
      - assets/
    roleId: env-bootstrap
  - id: entry-index
    paths:
      - index.html
      - run.cmd
    roleId: env-bootstrap
  - id: core-runtime
    path: src/core/
    roleId: core-engine
  - id: perf-harness
    path: tests/
    roleId: core-engine
  - id: combat-player
    path: src/combat/
    roleId: combat-player
  - id: monsters-waves
    path: src/monsters/
    roleId: monsters-director
  - id: loot-progression
    path: src/loot/
    roleId: loot-progression
  - id: visual-fx
    path: src/fx/
    roleId: presentation-fx
  - id: hud-ui
    path: src/ui/
    roleId: presentation-fx
  - id: sects-progression
    path: src/sects/
    roleId: sect-designer
  - id: art-pipeline
    path: tools/art/
    roleId: art-generator
roles:
  - id: env-bootstrap
    modules:
      - env-resources
      - entry-index
  - id: core-engine
    modules:
      - core-runtime
      - perf-harness
  - id: combat-player
    modules:
      - combat-player
  - id: monsters-director
    modules:
      - monsters-waves
  - id: loot-progression
    modules:
      - loot-progression
  - id: presentation-fx
    modules:
      - visual-fx
      - hud-ui
  - id: sect-designer
    modules:
      - sects-progression
  - id: art-generator
    modules:
      - art-pipeline
management:
  - convener
  - env-bootstrap
  - core-engine
  - combat-player
  - monsters-director
  - loot-progression
  - presentation-fx
  - sect-designer
  - art-generator
```

## 4. 协作与接口约定（摘要，详见架构 v2）

- 组合根：`src/core/main.js`（core-engine）按顺序装配；`WG.core.Loop.pause/resume` 供升级三选一与界面暂停。
- 新增事件：`sect:selected`、`choice:offer`、`choice:pick`；结算走 `run:result`。
- 素材交接：art-generator 产出 `tools/art/out/*.png` + `MANIFEST.json` → env-bootstrap 压缩为 WebP 放入 `assets/generated/` 并写 `SOURCES.md` → presentation-fx 在 UI 中引用并做加载失败回退占位。
- 属性写入：门派初始属性与升级加成的唯一写入点是 `WG.sects.Selection`（写 `WG.combat.player.stats`）。
- 变更须走新版本（v7+）文档，不原地修改本名单。

## 5. 备注

- 未包含角色卡、边界与权限内容——由人事（nominator）依据本名单发起任命与写卡；新增 2 个岗位需按本名单任命。
- 名单与 `wuxia-rogue-modules-v2.md` 的模块 id/name/purpose/path/paths/category/publicContract/architectureSource 完全一致；如后续调整，两文件同步升版。
- 引用链：intent v2 → proposal v2 → modules v2 / architecture v2；本名单 v6 为最新名单版本。
