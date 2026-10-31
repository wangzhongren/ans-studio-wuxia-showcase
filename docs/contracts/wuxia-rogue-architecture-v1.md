---
schema: project-architecture/v1
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 1
author: rapporteur
status: frozen
title: 江湖夜雨 · 项目架构契约（wuxia-rogue）v1
intent: docs/product/wuxia-rogue-intent-v1.md
proposal: docs/proposals/wuxia-rogue-proposal-v1.md
modules: docs/proposals/wuxia-rogue-modules-v1.md
roster: docs/proposals/wuxia-rogue-roster-v1.md
createdAt: 2026-10-31
---

# 项目架构契约 · 江湖夜雨（wuxia-rogue）v1

> 本文件冻结 v1 的模块边界、依赖方向、公开契约与验收复现方式；引用 `docs/proposals/wuxia-rogue-proposal-v1.md`（v1）与 `docs/proposals/wuxia-rogue-roster-v1.md`（v1）。
> 变更必须出新版本 `wuxia-rogue-architecture-v2.md`，旧版只读。

## 1. 总览与技术栈

- **形态**：桌面端单机原型，浏览器承载（Edge/Chrome），8 分钟一局。
- **技术栈**：HTML5 Canvas 2D + 原生 JavaScript（ES2019），**零依赖、无构建、无网络**。
- **加载模型**：经典 `<script defer>` 顺序加载（非 ES module），`file://` 双击可用。
- **全局命名空间**：`window.WG`，子命名空间 `WG.core / WG.loot / WG.combat / WG.monsters / WG.fx / WG.ui / WG.perf`。
- **确定性**：mulberry32 种子随机；URL `?seed=<整数>` 复现同一局；`?timescale=<1..8>` 仅调试加速。

## 2. 分层与依赖方向

```
[装配层]  entry-index (index.html / run.cmd) + env-resources (styles/, assets/)
      ↓ 只负责加载与样式，不含玩法
[基座层]  core-runtime (src/core/)  ← 循环/输入/相机/空间哈希/对象池/RNG/事件总线/组合根
      ↓ 公开 WG.core.*
[玩法层]  combat-player (src/combat/) · monsters-waves (src/monsters/) · loot-progression (src/loot/)
      ↓ 只通过 WG.core.Bus 事件与只读状态交互
[表现层]  visual-fx (src/fx/) · hud-ui (src/ui/)
      ↓ 订阅事件、读取状态、绘制与渲染
[工装层]  perf-harness (tests/)  ← 可被任意层调用，不反向依赖
```

**依赖规则（违反视为架构缺陷）**：

1. 上层可依赖下层公开契约；下层**不得**依赖上层（core 不引用 combat/monsters/loot/fx/ui）。
2. 玩法层三个模块之间**不得直接 import/调用彼此内部函数**，只走 `WG.core.Bus` 事件与公开只读接口。
3. 表现层只读：不得修改怪物/玩家/掉落的状态，不得发玩法事件（可发 `ui:*` 展示事件）。
4. 工装层只读或调用公开 API，不得持有玩法内部引用。
5. 所有跨模块调用必须经 `WG.<ns>.<API>`；禁止跨模块直接访问 `WG.<ns>._internal`。

## 3. 文件与路径约定

### 3.1 env-resources

- 路径：`styles/`（全局样式）、`assets/`（自绘占位素材）。
- `styles/theme.css`：定义 CSS 变量（配色、字体、HUD 尺寸）与 `#game` 画布容器布局；HUD DOM 样式必须使用这些变量。
- `assets/`：只允许自绘/程序化生成的占位素材（SVG/PNG 自绘、或代码内几何绘制），**不得引入第三方版权素材**。
- 属主：env-bootstrap。

### 3.2 entry-index

- 路径：`index.html`、`run.cmd`。
- 固定脚本加载顺序（defer 保序）：

```
src/core/config.js
src/core/rng.js
src/core/pool.js
src/core/spatial-hash.js
src/core/input.js
src/core/camera.js
src/core/bus.js
src/core/loop.js
src/loot/tables.js
src/loot/progression.js
src/loot/pickup.js
src/combat/player.js
src/combat/auto-attack.js
src/monsters/types.js
src/monsters/ai.js
src/monsters/director.js
src/fx/particles.js
src/fx/damage-numbers.js
src/fx/screen-fx.js
src/ui/hud.js
src/ui/screens.js
src/core/main.js        ← 组合根，最后加载
```

- `index.html` 只含 `<canvas id="game">`、HUD 容器与上述脚本；**不允许**内联玩法逻辑。
- `run.cmd`：`@echo off` + `start "" "%~dp0index.html"`，无其他依赖。
- 属主：env-bootstrap。

## 4. 模块公开契约

> 以下为 v1 冻结的最小接口集；新增接口需同步升版。所有坐标单位为 px，时间为秒（dt 固定 1/60）。

### 4.1 core-runtime

路径 `src/core/`，属主 core-engine。

```text
WG.core.CONFIG        // 全部数值常量（见方案 §6），唯一数值源
WG.core.Rng(seed)     // { next(), range(a,b), int(a,b), pick(arr) }
WG.core.Pool(cap, factory, reset) // { spawn(), forEach(fn), count, releaseAll() }
WG.core.SpatialHash(cellSize)     // { clear(), insert(e), queryCircle(x,y,r,out) }
WG.core.Input         // { axis(): {x,y}, dashPressed(), keyPressed(code) }
WG.core.Camera        // { update(target,dt,world), apply(ctx), shake(amp,dur) }
WG.core.Bus           // { on(type,fn), off(type,fn), emit(type,payload) }
WG.core.Loop          // { start(update,render), stop(), simTime, frameStats }
WG.core.boot(options) // 组合根入口：装配各系统并启动
```

- 组合根 `src/core/main.js`：创建世界、注册系统、按 `input → player → combat → monsters → loot → fx → ui → render` 顺序驱动。
- 固定步长：累加器 + 最多 3 次补步；渲染使用插值 alpha。
- 相机震动由 `Camera.shake` 统一处理；`fx` 通过 `WG.core.Bus` 或 `Camera` 触发。

### 4.2 perf-harness

路径 `tests/`，属主 core-engine。

```text
WG.perf.overlay       // F3 开关：FPS、p95 帧耗时、各阶段耗时、实体计数、降级状态
WG.perf.stats         // { fps, p95Sim, p95Render, entities: {monsters,projectiles,drops,particles,numbers}, degraded }
WG.perf.fastForward(t)// 仅调试：把对局时间推进到 t 秒（等价 timescale 快进）
WG.perf.spawnBurst(n) // 仅调试：立即在屏外生成 n 只怪，供 AC-6/AC-8 压测
```

- `tests/bench.md` / `tests/bench.js`：无头基准（Node 可选运行纯逻辑模拟 1000 帧）与手工验收清单。
- URL 参数：`?seed=`、`?timescale=`、`?debug=1` 由组合根解析。
- **禁止**在正式流程中自动快进或自动生成怪；仅调试键触发。

### 4.3 combat-player

路径 `src/combat/`，属主 combat-player。

```text
WG.combat.Player      // { x,y,r,hp,maxHp,stats,dash(),takeDamage(n) }
WG.combat.CombatSystem// { update(dt, world), projectilePool, hitTest() }
WG.combat.player      // 单例玩家引用（供 UI 只读）
```

- `player.stats = { atk, atkInterval, projectileCount, range, speed, pickupRadius, magnetRadius, level, xp, xpNext }`
- 索敌：`WG.core.SpatialHash.queryCircle(player, 170)` 取最近存活怪；目标丢失或超出 220 px 重选。
- 命中：剑气与怪物圆形碰撞；命中后 `Bus.emit('damage', {targetId, amount, crit:false, x, y})`，由怪物系统扣血。
- 玩家受伤发 `player:hurt`，HP 归零发 `player:dead`。
- 闪身：0.16 s 位移 120 px，冷却 1.2 s，无敌 0.18 s；无敌期忽略怪物伤害。

### 4.4 monsters-waves

路径 `src/monsters/`，属主 monsters-director。

```text
WG.monsters.types     // 游侠/弓手/刀客(+血刀宗师) 模板：hp,speed,damage,atkInterval,radius,xp
WG.monsters.MonsterSystem // { update(dt, world), pool, byId(id), count }
WG.monsters.Director  // { update(dt, runTime, playerLevel), targetAlive, spawnRate }
```

- 所有怪物存于对象池；`count` 上限 300（硬上限），超出不再生成。
- 死亡流程：扣血至 0 → `Bus.emit('monster:killed', {id, x, y, type, xp})` → 归还对象池 → `fx` 播死亡特效。
- 刷怪：屏幕外 240~360 px 环带取点，避开障碍与视野；由 Director 按方案 §6.3 曲线驱动。
- 难度成长：`level:up` 事件与 `runTime` 共同决定 HP/伤害/速度倍率。
- 怪物 AI 不得直接改玩家 HP；受伤判定由 `damage` 事件驱动。

### 4.5 loot-progression

路径 `src/loot/`，属主 loot-progression。

```text
WG.loot.tables        // DROP_TABLE、XP 曲线、升级成长表、里程碑技能表（唯一数值源之一，与方案 §6 对齐）
WG.loot.LootSystem    // { dropAt(x,y,type), update(dt, player), pool, count }
WG.loot.Progression   // { addXp(n), level, xp, xpNext, stats(), unlockList() }
```

- 监听 `monster:killed` → 掉落物入池并发 `loot:drop`。
- 拾取：距离 ≤ pickupRadius 或进入 magnetRadius 后磁吸；拾取后发 `loot:picked {kind, amount}`，经验珠调用 `Progression.addXp`。
- 升级：满足曲线发 `level:up {level, stats}`；Lv3/5/8 发 `ability:unlock {id}`。
- 技能数值（回旋 95/18/1.5s、万剑 420/60/12s）由本模块定义，combat 读取并执行；`fx` 负责表现。
- 玩家属性写回 `WG.combat.player.stats` 的唯一入口是本模块的 `applyGrowth()`。

### 4.6 visual-fx

路径 `src/fx/`，属主 presentation-fx。

```text
WG.fx.particles      // 池，上限 600；burst(x,y,color,n)
WG.fx.numbers        // 池，上限 64；damageNumber(x,y,value,kind)
WG.fx.screen         // { shake(amp,dur), flash(alpha), swordRain(x,y,r) }
WG.fx.degrade        // { enabled, set(on) }  // FPS<50 持续 2s 自动开启
```

- 只读事件：`damage`、`monster:killed`、`loot:picked`、`level:up`、`ability:unlock`。
- 所有特效对象池化；同屏上限满时复用最旧，不新建对象。
- 降级开启时关闭震屏、血雾粒子与剑雨细节，仅保留伤害数字（保障 AC-8 可玩帧率）。

### 4.7 hud-ui

路径 `src/ui/`，属主 presentation-fx。

```text
WG.ui.hud      // { render(state) }  // 时间、HP、等级、经验条、击杀数、拾取数、银两
WG.ui.screens  // { showTitle(), showResult(result), hide(), bindInput() }
```

- 只读 `player.stats` 与结算数据；不写玩法状态。
- 标题/结算/重开（R 键）；**无任何卡牌、手牌、牌组、三选一界面**。
- F3 调试叠层由 `WG.perf.overlay` 提供，UI 仅负责容器。

## 5. 数据流

### 5.1 每帧顺序（update 固定步长）

```
Input.axis → Player.move（轴分离碰撞/世界钳制）→ Camera.update
→ SpatialHash 重建（怪物/掉落）
→ CombatSystem.update（索敌、发射、命中 → emit 'damage'）
→ MonsterSystem.update（AI、追击、攻击 → emit 'player:hurt'/'player:dead'）
→ LootSystem.update（掉落计时、磁吸、拾取 → Progression.addXp → 'level:up'）
→ Director.update（按 runTime/level 补怪）
→ FX/DamageNumbers 计时
```

### 5.2 事件表（唯一跨模块通信通道）

| 事件 | 发送方 | 订阅方 | 载荷 |
| --- | --- | --- | --- |
| `damage` | combat | monsters, fx | `{targetId, amount, x, y}` |
| `monster:killed` | monsters | loot, fx, ui | `{id, x, y, type, xp}` |
| `loot:drop` | loot | fx | `{x, y, kind}` |
| `loot:picked` | loot | fx, ui | `{kind, amount, total}` |
| `level:up` | loot | combat, monsters, fx, ui | `{level, stats}` |
| `ability:unlock` | loot | combat, fx, ui | `{id, level}` |
| `player:hurt` | monsters | fx, ui | `{hp, maxHp}` |
| `player:dead` | combat/monsters | ui, main | `{runTime, kills}` |
| `run:win` | main | ui | `{runTime, kills, level}` |

### 5.3 状态所有权

| 状态 | 所有者 | 读取方 |
| --- | --- | --- |
| 玩家 HP/位置/属性 | combat | 全部（只读） |
| 怪物实体 | monsters | combat（命中查询）、fx（死亡点） |
| 掉落物 | loot | fx、ui |
| 等级/经验/解锁 | loot | combat、ui、monsters |
| 对局计时/胜负 | core（main） | ui、director |
| 特效/数字 | fx | 无（自渲染） |

## 6. 运行方式与验收复现

### 6.1 启动

1. 双击 `index.html`（或 `run.cmd`）；推荐 Edge/Chrome；
2. 标题界面按 Enter 开始；
3. 操作：WASD/方向键移动，Shift 闪身，F3 性能面板，R 结算后重开；
4. 退化路径：若企业策略限制 `file://`，在项目根执行 `python -m http.server 8000` 后访问 `http://localhost:8000/`。

### 6.2 AC 复现步骤（逐条可执行）

| AC | 复现操作 | 观察证据 |
| --- | --- | --- |
| AC-1 | 开始后按住 D 8 秒，再绕岩石/贴崖壁行走 | 地图持续滚动出现新区域；贴障碍可滑动，不卡死 |
| AC-2 | 靠近怪物至 170 px 内不按键 | 自动发射剑气、怪物掉血+白闪+伤害数字；走远后停手 |
| AC-3 | 任意击杀一只怪 | 怪物消失，死亡点出现经验珠/银两并可见 |
| AC-4 | 走向掉落物 | 掉落物飞向角色并消失；HUD 经验/银两/拾取数增加 |
| AC-5 | 连续击杀至升级 | 等级+1，F3 详表显示攻击力/攻速/拾取半径变化 |
| AC-6 | `?seed=7` 开始，按 F4 跳到 5:30 或等待 5 分钟 | 同屏 200+ 怪；回旋/万剑成片清怪，粒子/数字/震屏可见 |
| AC-7 | 完整玩一局并查看所有界面 | 无抽牌/手牌/牌组/构筑元素；升级无卡面选择 |
| AC-8 | 同 seed 同操作重开两次；F4 压测怪潮 | 现象一致；F3 显示 ≥45 fps（目标 60），无持续卡死 |

### 6.3 验收辅助

- `?seed=1234`：固定随机序列，供 AC-6/AC-8 复现。
- `?timescale=4`：4× 时间加速（仅调试）。
- F3：性能叠层；F4：快进到 5:30；F5：触发一次 120 只怪潮爆发。
- `tests/bench.js`：Node 下跑纯逻辑 1000 帧，输出 p95 模拟耗时（无渲染，仅回归用）。

## 7. 性能预算与测量

| 指标 | 预算 | 测量 |
| --- | --- | --- |
| 帧率 | 60 fps 目标 / ≥45 fps 底线（300 怪） | F3 FPS |
| 模拟耗时 | p95 ≤ 6 ms | F3 分阶段计时 |
| 渲染耗时 | p95 ≤ 8 ms | F3 分阶段计时 |
| 实体上限 | 怪 300 / 剑气 200 / 掉落 150 / 粒子 600 / 数字 64 | F3 计数 |
| GC | 稳态无逐帧分配 | Chrome Performance 抽查 |

强制手段：对象池、空间哈希、离屏剔除、预渲染精灵、粒子上限、自动降级、固定步长 + 补步上限 3。

## 8. 扩展点

- 新怪物：`src/monsters/types.js` 加模板 + `ai.js` 加行为，不改其他模块。
- 新掉落/技能：`src/loot/tables.js` 加条目，`ability:unlock` 事件由 combat/fx 各自订阅。
- 新特效：`src/fx/` 内新增函数，UI 不感知。
- 新难度/模式：`Director` 读取 `CONFIG` 曲线表，参数化即可。
- 若后续改用 Phaser 等引擎：保持 `WG.*` 公开契约不变，仅替换 core-runtime 实现。

## 9. 变更与冻结

- v1 冻结：模块 id/路径、事件名、公开 API 签名、脚本加载顺序。
- 修改任一内容须出 v2 架构并同步 proposal/modules/roster 新版本；旧版只读。
- 卡牌机制（抽牌/出牌/手牌/牌组/构筑/卡面选择）**永久禁止**进入架构；出现即视为违反意图 v1 与 AC-7。
