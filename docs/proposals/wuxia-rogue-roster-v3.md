---
schema: project-roster/v3
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 3
author: rapporteur
status: draft
title: 江湖夜雨 · 人员名单（wuxia-rogue）v3
createdAt: 2026-10-31
intent: docs/product/wuxia-rogue-intent-v1.md
proposal: docs/proposals/wuxia-rogue-proposal-v1.md
modulesDoc: docs/proposals/wuxia-rogue-modules-v1.md
architecture: docs/contracts/wuxia-rogue-architecture-v1.md
references:
  intent: docs/product/wuxia-rogue-intent-v1.md
  proposal: docs/proposals/wuxia-rogue-proposal-v1.md
  modules: docs/proposals/wuxia-rogue-modules-v1.md
  architecture: docs/contracts/wuxia-rogue-architecture-v1.md
envBootstrap:
  omitted: false
  note: 默认必带；env-resources 与 entry-index 两个固定模块均由该角色持有
modules:
  - id: env-resources
    name: 环境资源（样式与占位素材）
    purpose: 全局样式、字体与程序化占位美术/音效资源
    paths:
      - styles/
      - assets/
    category: env
    publicContract: styles/theme.css 提供 CSS 变量与画布容器布局；assets/ 为自绘占位素材目录
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#31-env-resources
  - id: entry-index
    name: 入口与启动
    purpose: 页面入口与 Windows 一键启动脚本，固定脚本加载顺序
    paths:
      - index.html
      - run.cmd
    category: entry
    publicContract: index.html 按固定顺序加载 core → loot → combat → monsters → fx → ui → main.js
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
    publicContract: WG.perf.{overlay,stats,fastForward}；URL 参数 ?seed= 与 timescale= 的复现约定
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#42-perf-harness
  - id: combat-player
    name: 角色与自动攻击
    purpose: 玩家移动/闪身/索敌/剑气发射/命中判定/玩家属性结算
    path: src/combat/
    category: feature
    publicContract: WG.combat.{Player,CombatSystem}，暴露 player.stats 与 damage 事件
    architectureSource: docs/contracts/wuxia-rogue-architecture-v1.md#43-combat-player
  - id: monsters-waves
    name: 怪物与刷怪导演
    purpose: 怪物生成与 AI、三类普通怪 + 精英、刷怪曲线与波次节奏、同屏上限控制
    path: src/monsters/
    category: feature
    publicContract: WG.monsters.{MonsterSystem,Director}，监听 level:up，发出 monster:killed
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
roles:
  - id: env-bootstrap
    displayName: 环境与入口装配
    purpose: 让原型在任何 Windows 机器上双击即开；提供样式基座与占位素材
    capability: 静态前端装配、HTML/CSS、Windows 启动脚本（cmd）、资源目录管理
    modules:
      - env-resources
      - entry-index
  - id: core-engine
    displayName: 引擎与性能
    purpose: 提供稳定、可测的运行时基座：固定步长循环、输入、相机、空间哈希、对象池与性能工装
    capability: JavaScript 游戏循环与渲染管线、空间索引/碰撞、对象池与 GC 控制、性能剖析与降级策略
    modules:
      - core-runtime
      - perf-harness
  - id: combat-player
    displayName: 角色操控与自动攻击
    purpose: 玩家走位/闪身手感，以及「进入范围自动攻击」的索敌、发射与命中结算
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
    displayName: 掉落与成长
    purpose: 击杀→掉落→拾取→经验→升级→技能解锁的完整闭环与成长曲线
    capability: 掉落表与概率、拾取/磁吸、经验曲线与经济数值、技能解锁与属性成长建模
    modules:
      - loot-progression
  - id: presentation-fx
    displayName: 表现与界面
    purpose: 把「满屏清怪」做成看得见的爽感，并承载标题/HUD/结算流程
    capability: Canvas 粒子与特效、伤害数字与震屏、HUD/DOM UI、性能受控的视觉反馈
    modules:
      - visual-fx
      - hud-ui
---

# 人员名单 · 江湖夜雨（wuxia-rogue）v3

> 依据意图：`docs/product/wuxia-rogue-intent-v1.md`（intentId=`wuxia-rogue-map`）
> 依据方案：`docs/proposals/wuxia-rogue-proposal-v1.md`（v1）
> 模块清单：`docs/proposals/wuxia-rogue-modules-v1.md`（v1）
> 架构契约：`docs/contracts/wuxia-rogue-architecture-v1.md`（v1）
> 本名单是招人的唯一依据；不含角色卡内容（角色卡由人事环节依据本名单撰写）。
> 版本说明：v1 存在 `modules` 键重复（文档引用与模块数组）导致 YAML 非法；v2 拆分引用键；v3 按拓扑校验要求把 convener 明确写入 `management.roles`（与全部项目角色并列）。

## 1. 人员名单（角色 = 岗位）

| 角色 id | 名称 | 职责 | 所需技能 | 持有模块 |
| --- | --- | --- | --- | --- |
| env-bootstrap | 环境与入口装配 | 页面入口、脚本加载顺序、一键启动脚本、全局样式与占位素材 | 静态前端装配、HTML/CSS、Windows cmd 启动脚本、资源管理 | env-resources、entry-index |
| core-engine | 引擎与性能 | 固定步长循环、输入、相机、空间哈希、对象池、种子随机、事件总线、F3 性能工装与降级 | JS 渲染管线、空间索引与碰撞、对象池/GC 控制、性能剖析 | core-runtime、perf-harness |
| combat-player | 角色操控与自动攻击 | 移动/闪身手感、索敌、剑气发射、命中与伤害结算、玩家属性 | 2D 动作手感、投射物与命中判定、数值结算 | combat-player |
| monsters-director | 怪物与刷怪导演 | 三类怪 + 精英 AI、刷怪曲线与波次、同屏上限与难度成长 | 行为 AI、刷怪导演/难度曲线、实体容量管理 | monsters-waves |
| loot-progression | 掉落与成长 | 掉落表、拾取与磁吸、经验与升级曲线、Lv3/5/8 技能解锁 | 概率掉落、拾取交互、成长曲线与经济数值 | loot-progression |
| presentation-fx | 表现与界面 | 粒子/伤害数字/震屏/剑雨、标题/HUD/结算/重开 | Canvas 特效、DOM HUD、性能受控的视觉反馈 | visual-fx、hud-ui |

共 **6 个角色 / 9 个模块**；角色少而精，一人可持多模块，每个模块恰好一个属主。

## 2. 模块属主与路径（一模块一属主，路径不重叠）

| 模块 id | 属主角色 | 路径 | category |
| --- | --- | --- | --- |
| env-resources | env-bootstrap | `styles/`、`assets/` | env |
| entry-index | env-bootstrap | `index.html`、`run.cmd` | entry |
| core-runtime | core-engine | `src/core/` | lib |
| perf-harness | core-engine | `tests/` | test |
| combat-player | combat-player | `src/combat/` | feature |
| monsters-waves | monsters-director | `src/monsters/` | feature |
| loot-progression | loot-progression | `src/loot/` | feature |
| visual-fx | presentation-fx | `src/fx/` | feature |
| hud-ui | presentation-fx | `src/ui/` | ui |

- 每个模块只有一个属主，无共享目录；跨模块改动走架构契约中的接口与事件，不越界改他人文件。
- 固定角色 `env-bootstrap` 未省略（`envBootstrap.omitted=false`），且只持有 `env`（env-resources）与 `entry`（entry-index）两个固定模块。

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
management:
  convener: convener
  roles:
    - convener
    - env-bootstrap
    - core-engine
    - combat-player
    - monsters-director
    - loot-progression
    - presentation-fx
```

## 4. 协作与接口约定（摘要，详见架构契约）

- 组合根：`src/core/main.js`（core-engine 持有）负责按顺序装配各系统并驱动 `update/render`。
- 事件：`monster:killed`、`loot:drop`、`loot:picked`、`level:up`、`ability:unlock`、`player:dead`、`run:win`。
- 数据所有权：怪物数据归 monsters，掉落/成长归 loot，玩家属性归 combat，特效/UI 只读。
- 变更须走新版本（v4+）文档，不原地修改本名单。

## 5. 备注

- 未包含角色卡、边界与权限内容——由人事（nominator）依据本名单发起任命与写卡。
- 名单与 `wuxia-rogue-modules-v1.md` 的模块 id/路径/category 完全一致；如后续调整，两文件同步升版。
- 引用链：intent v1 → proposal v1 → modules v1 / architecture v1；本名单 v3 为最新名单版本。
