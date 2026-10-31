---
schema: project-architecture/v1
flowId: wuxia-rogue-v2
intentId: wuxia-rogue-map-v2
version: 1
author: rapporteur
status: draft
title: 江湖夜雨 · 项目架构契约（wuxia-rogue-v2）v1
intent: docs/product/wuxia-rogue-v2-intent-v1.md
proposal: docs/proposals/wuxia-rogue-v2-proposal-v1.md
modules: docs/proposals/wuxia-rogue-v2-modules-v1.md
roster: docs/proposals/wuxia-rogue-v2-roster-v1.md
baselineNote: 设计内容与旧流程线 docs/contracts/wuxia-rogue-architecture-v2.md 一致，仅按新流程线重述；旧文件只读、不构成依赖
createdAt: 2026-10-31
---

# 项目架构契约 · 江湖夜雨（wuxia-rogue-v2）v1

> 本文件是新流程线 `wuxia-rogue-v2` 的自足架构契约，冻结模块边界、公开契约、事件与素材流水线；引用 `docs/proposals/wuxia-rogue-v2-proposal-v1.md`（v1）、`docs/proposals/wuxia-rogue-v2-modules-v1.md`（v1）与 `docs/proposals/wuxia-rogue-v2-roster-v1.md`（v1）。
> 依据意图：`docs/product/wuxia-rogue-v2-intent-v1.md`（S1~S13 / AC-1~AC-13）。
> 设计内容与旧流程线 `docs/contracts/wuxia-rogue-architecture-v2.md` 保持一致（按新流程线重述，不改变模块与事件）；旧流程线文件只读，本流程线不依赖其运行基线。
> 变更必须出新版本 `wuxia-rogue-v2-architecture-v2.md`，旧版只读。

## 1. 总览与技术栈

- **形态**：桌面端单机原型，浏览器承载（Edge/Chrome），8 分钟一局。
- **技术栈**：HTML5 Canvas 2D + 原生 JavaScript（ES2019），**运行时零依赖、无构建、无网络、不加载模型**。
- **加载模型**：经典 `<script defer>` 顺序加载；`file://` 双击可用。
- **能力集**：大地图走位、自动攻击、掉落拾取、升级三选一、开始介绍页、门派选择、结算评分页、离线素材生成与接入。
- **确定性**：mulberry32 种子随机；`?seed=` 复现；升级三选一抽取同样走该 RNG。

## 2. 分层与依赖方向

```
[装配层]  entry-index (index.html / run.cmd) + env-resources (styles/, assets/, assets/generated/)
      ↓ 只负责加载与样式/素材接入，不含玩法
[基座层]  core-runtime (src/core/)  ← 循环/输入/相机/空间哈希/对象池/RNG/事件总线/暂停/组合根
      ↓ 公开 WG.core.*
[玩法层]  combat-player (src/combat/) · monsters-waves (src/monsters/) · loot-progression (src/loot/)
          · sects-progression (src/sects/)
      ↓ 只通过 WG.core.Bus 事件与只读状态交互
[表现层]  visual-fx (src/fx/) · hud-ui (src/ui/)
      ↓ 订阅事件、读取状态、绘制与渲染
[工装层]  perf-harness (tests/)  ← 运行时内，只读或调用公开 API
[离线工具链] art-pipeline (tools/art/) ← 不进入运行时、不被任何 WG.* 引用
```

**依赖规则**：

1. 上层可依赖下层；下层不得依赖上层。
2. 玩法层模块之间只走事件（`WG.core.Bus`）与只读状态，不直接调用彼此内部函数。
3. 表现层只读事件与状态，不反向写玩法状态。
4. 工装（tests/）只读或调用公开 API，不承担玩法逻辑。
5. 任何模块不得访问其他模块的 `_internal` 内部实现。
6. `sects-progression` 是**玩家属性成长的唯一写入者**（门派初始属性与升级加成）；`loot-progression` 只发 `level:up`，不写属性。
7. `hud-ui` 是**界面状态的唯一持有者**（title/sect/playing/result），不得写玩法状态；`main` 只按事件切换界面。
8. `art-pipeline` 与运行时**完全隔离**：运行时不得引用 `tools/art/`，不得联网、不得加载模型。

## 3. 文件与路径约定

### 3.1 env-resources

- 路径：`styles/`、`assets/`（含 `assets/generated/`）。
- `styles/theme.css`：CSS 变量、画布容器、卷轴/石碑面板样式（类名使用 `scroll-panel` / `stele-option`，**禁用** card/deck/hand 命名）。
- `assets/`：程序化占位素材（自绘，无第三方版权素材）。
- `assets/generated/`：Qwen-Image-2.1 生成并接入的 WebP/PNG；必须附 `assets/generated/SOURCES.md`（逐项标注「生成」或「占位」，含来源与失败原因）。
- 属主：env-bootstrap。

### 3.2 entry-index

- 路径：`index.html`、`run.cmd`。
- 固定脚本加载顺序（defer 保序，共 26 个）：

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
src/sects/defs.js
src/sects/upgrades.js
src/sects/selection.js
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
src/ui/overlays.js
src/core/main.js        ← 组合根，最后加载
```

- `index.html` 只含 `<canvas id="game">`、HUD/覆盖层容器与上述脚本；不允许内联玩法逻辑。
- `run.cmd`：`@echo off` + `start "" "%~dp0index.html"`。
- 属主：env-bootstrap。

### 3.3 目录约定

| 目录 | 属主 | 说明 |
| --- | --- | --- |
| `src/sects/` | sect-designer | `defs.js`（门派定义）、`upgrades.js`（选项池与抽取）、`selection.js`（选择状态与属性应用） |
| `tools/art/prompts/` | art-generator | 每资产一份提示词 md（正/负提示词、尺寸、seed、snapshot） |
| `tools/art/scripts/` | art-generator | `generate.py`（生成）、`verify.py`（校验与 manifest 更新） |
| `tools/art/out/` | art-generator | 原始出图 PNG（不直接被游戏引用） |
| `tools/art/MANIFEST.json` | art-generator | 生成记录（唯一真源） |
| `assets/generated/` | env-bootstrap | 接入后的 WebP/PNG + `SOURCES.md`（唯一运行时素材真源） |

## 4. 模块公开契约

### 4.1 core-runtime

路径 `src/core/`，属主 core-engine。

```text
WG.core.CONFIG        // 数值常量（方案 §4/§5/§6）
WG.core.Rng(seed)     // { next(), range(a,b), int(a,b), pick(arr) }
WG.core.Pool(cap, factory, reset)
WG.core.SpatialHash(cellSize)
WG.core.Input
WG.core.Camera
WG.core.Bus           // { on, off, emit }
WG.core.Loop          // { start(update,render), stop(), pause(), resume(), paused, simTime, frameStats }
WG.core.boot(options) // 组合根入口
```

- `Loop.pause()/resume()/paused`：用于升级三选一与界面暂停；暂停期间 `update` 不再推进模拟，`render` 继续（保证面板可见）。
- 固定步长与补步上限 3。

### 4.2 perf-harness

路径 `tests/`，属主 core-engine。

```text
WG.perf.overlay / stats / fastForward(t) / spawnBurst(n)
```

- 运行时内只读工装；新增界面状态与暂停不影响 F3 面板与实体计数。

### 4.3 combat-player

路径 `src/combat/`，属主 combat-player。

```text
WG.combat.Player      // { x,y,r,hp,maxHp,stats,dash(),takeDamage(n) }
WG.combat.CombatSystem// { update(dt, world), projectilePool, hitTest() }
WG.combat.player      // 单例玩家引用（UI 只读）
```

- `player.stats`：`{ atk, atkInterval, projectileCount, range, speed, pickupRadius, magnetRadius, maxHp, level, xp, xpNext, critRate, critMult, damageReduction, regen }`
- 命中：`Bus.emit('damage', {...})`；暴击按 `critRate/critMult` 结算；`damageReduction` 在 `takeDamage` 内生效。
- **属性写入约束**：combat 只写位置/HP/计时；成长字段由 `WG.sects.Selection` 写入。
- 闪身与索敌参数：闪身位移 120 px、冷却 1.6 s、无敌 0.18 s；索敌半径取 `stats.range`，最近目标优先。

### 4.4 monsters-waves

路径 `src/monsters/`，属主 monsters-director。

```text
WG.monsters.types / MonsterSystem / Director
```

- 三类普通怪（游荡者/弓手/刀客）+ 精英；难度读 `level:up` 与 `runTime`；死亡发 `monster:killed`。
- 后期同屏密度目标 200~300，硬上限 300。

### 4.5 loot-progression

路径 `src/loot/`，属主 loot-progression。

```text
WG.loot.tables        // 掉落表、XP 曲线（不含自动成长表）
WG.loot.LootSystem    // { dropAt(x,y,type), update(dt, player), reset(), pool, count }
WG.loot.Progression   // { addXp(n), reset(), level, xp, xpNext }
```

- 升级只发 `level:up {level}`，**不自动加属性、不发 `ability:unlock`**；成长由 `sects-progression` 以三选一承接。
- `Progression.reset()`、`LootSystem.reset()`：重开一局时等级/经验/掉落/掉落 RNG 全部复位（AC-8 复现要求）。
- 掉落 RNG 绑定 `world.seed`，保证 `?seed=` 复现。

### 4.6 visual-fx

路径 `src/fx/`，属主 presentation-fx。

```text
WG.fx.particles / numbers / screen / degrade
```

- 粒子、伤害数字、受击白闪、震屏、剑雨与技能特效；订阅 `choice:pick` 播放技能生效特效（回旋/裂空/万剑）。
- 全部走对象池与上限，自动降级开关可关闭非必要特效。

### 4.7 hud-ui

路径 `src/ui/`，属主 presentation-fx。

```text
WG.ui.HUD        // { render(state) }  // 时间、HP、等级、经验、击杀、拾取、银两、门派
WG.ui.ScreenFlow // { go(name), current(), bindInput() }  // name: title|sect|playing|result
WG.ui.Overlays   // { showSect(defs, onPick), showChoice(options, onPick), hide() }
WG.ui.score(stats) // 纯函数：{ score, grade }  // grade ∈ S/A/B/C
```

- 界面状态机：`title → sect → playing → result`；`result` 可回 `sect`（再来一局）或 `title`。
- 只读 `player.stats` 与本局统计；不写玩法状态。
- 覆盖层命名：`scroll-panel`、`stele-option`；**不得**出现 card/deck/hand 等命名或图标。
- 评分纯函数只读本局统计对象，结算页数值直出同一对象（保证 AC-10 一致）。

### 4.8 sects-progression

路径 `src/sects/`，属主 sect-designer。

```text
WG.sects.DEFS        // { jianzong, daomen, yigu }：{ id,name,desc,init:{atk,atkInterval,maxHp,speed,regen,critRate,critMult,damageReduction}, exclusive:[optionId] }
WG.sects.UpgradePool // { offer(level, sectId, rng): [3 options], apply(option) }
WG.sects.Selection   // { selectSect(id), current(), choose(optionId), modifiers, reset() }
```

- `selectSect(id)`：应用门派初始属性到 `WG.combat.player.stats`，发 `sect:selected {sectId}`。
- 升级流程：`level:up` → `UpgradePool.offer(level, sectId, rng)` → 发 `choice:offer {level, options[3]}` → main `Loop.pause()`；`Overlays` 呈现；玩家选择 → `Selection.choose(optionId)` → 应用效果 → `choice:pick {optionId, level}` → main `Loop.resume()`。
- 抽取规则见方案 §5.3（1 专属 + 2 通用；Lv3/5/8 首个名额固定绝学；不重复；排除满层；走种子 RNG）。
- `reset()`：新局清空 modifiers 与已选选项。
- **唯一属性成长写入点**：`apply` 直接修改 `WG.combat.player.stats`，其他模块不得写成长字段。

### 4.9 art-pipeline

路径 `tools/art/`，属主 art-generator；**非运行时模块**。

```text
tools/art/prompts/<id>.md      // 正向/负向提示词、尺寸、步数、seed、模型 snapshot
tools/art/scripts/generate.py  // 读清单 → QwenImage21Pipeline（HF 缓存，CPU offload）→ out/*.png → 更新 MANIFEST
tools/art/scripts/verify.py    // 校验文件存在/尺寸/可解码，回填 status
tools/art/out/*.png            // 原始出图（不被游戏引用）
tools/art/MANIFEST.json        // { model, snapshot, generatedAt, assets:[{id,file,promptFile,seed,status:ok|failed,reason,ms}] }
```

- 运行时**不得**引用 `tools/art/`；`index.html`/`src/**` 只引用 `assets/generated/`。
- 生成环境：HF 缓存 `models--Qwen--Qwen-Image-2.1`（snapshot `d26bb612…`），RTX 4090 24 GB，Python 3.12.10；一次安装 torch(cu12x)/diffusers/transformers/accelerate/pillow 后离线生成（`HF_HUB_OFFLINE=1`）；`enable_model_cpu_offload()` + fp16。
- 失败：保留占位，`MANIFEST` 标 `failed` + 原因；不得虚报。

## 5. 数据流与事件

### 5.1 界面与对局状态机

```
boot → title
  └─ 开始游戏 → sect
        └─ 选定门派（sect:selected）→ playing
              ├─ level:up → choice:offer（Loop.pause）→ choice:pick（Loop.resume）→ playing
              ├─ player:dead → run:result(dead) → result
              └─ 8:00 → run:result(win) → result
                    ├─ 再来一局 → sect
                    └─ 返回标题 → title
```

### 5.2 每帧顺序（playing 状态）

```
Input.axis → Player.move → Camera.update → SpatialHash 重建
→ CombatSystem.update（索敌/发射/命中 → damage）
→ MonsterSystem.update（AI/攻击 → player:hurt/player:dead）
→ LootSystem.update（掉落/磁吸/拾取 → addXp → level:up）
→ Sects（若 level:up：offer → choice:offer → 暂停）
→ Director.update（补怪）
→ FX 计时；UI 渲染
```

暂停（choice 状态）期间：跳过上述 update，仅渲染与覆盖层输入。

### 5.3 事件表（全量）

| 事件 | 发送方 | 订阅方 | 载荷 |
| --- | --- | --- | --- |
| `damage` | combat | monsters, fx | `{targetId, amount, crit, x, y}` |
| `monster:killed` | monsters | loot, fx, ui | `{id, x, y, type, xp}` |
| `loot:drop` | loot | fx | `{x, y, kind}` |
| `loot:picked` | loot | fx, ui | `{kind, amount, total}` |
| `level:up` | loot | sects, monsters, fx, ui | `{level}` |
| `sect:selected` | sects | ui, main, combat | `{sectId}` |
| `choice:offer` | sects | ui, main | `{level, options:[{id,name,desc,kind}]}` |
| `choice:pick` | sects | combat, fx, ui, main | `{optionId, level}` |
| `player:hurt` | monsters | fx, ui | `{hp, maxHp}` |
| `player:dead` | combat/monsters | ui, main | `{runTime, kills}` |
| `run:win` | main | ui | `{runTime, kills, level}` |
| `run:result` | main | ui | `{outcome, stats, score, grade}` |

> `ability:unlock` 停用（由 `choice:pick` 取代）。

### 5.4 状态所有权

| 状态 | 所有者 | 读取方 |
| --- | --- | --- |
| 玩家 HP/位置 | combat | 全部（只读） |
| 玩家成长属性 | sects（写入）/ combat（持有） | 全部（只读） |
| 怪物实体 | monsters | combat、fx |
| 掉落物 | loot | fx、ui |
| 等级/经验 | loot | sects、ui、monsters |
| 门派/已选成长 | sects | ui、combat |
| 界面状态 | ui | main |
| 对局计时/胜负 | core（main） | ui、director |
| 素材生成记录 | art-pipeline（离线） | 验收方（只读） |

## 6. 素材生成与静态接入流程

### 6.1 生成（离线，art-generator）

1. 安装依赖：`pip install torch --index-url https://download.pytorch.org/whl/cu124` + `diffusers transformers accelerate pillow`（一次；之后 `HF_HUB_OFFLINE=1`）。
2. 写 `prompts/<id>.md`（正/负提示词、尺寸、seed）。
3. `python tools/art/scripts/generate.py --manifest tools/art/MANIFEST.json`：逐张生成到 `out/`，更新 manifest（`status:ok|failed`、耗时、原因）。
4. `python tools/art/scripts/verify.py`：校验可解码与尺寸，回填结果。

### 6.2 接入（env-bootstrap）

1. 只处理 `status=ok`：转 WebP（质量 90）→ `assets/generated/`；
2. 写 `assets/generated/SOURCES.md`：逐项标注生成来源（seed/prompt）或「占位」；
3. `index.html` / CSS 引用 `assets/generated/*`；加载失败自动回退占位（presentation-fx 在 UI 层实现）。

### 6.3 运行时零依赖（AC-13 ③）

- 无 `fetch`/XHR/WebSocket；无远程 URL；无模型加载；无 Python 调用；
- `index.html` 仅本地脚本与本地图片；断网可玩；
- 占位回退：图片 `onerror` 或缺失时不抛异常，使用程序化绘制。

### 6.4 失败降级

- 任一素材失败：保留原占位，`MANIFEST` 与 `SOURCES.md` 如实标注；不阻断启动与验收（AC-13 允许少量占位，但必须记录）。
- 环境未就绪（无 torch）：先在 `tools/art/README.md` 记录安装步骤，不伪造生成结果。

## 7. 运行方式与验收复现

### 7.1 启动

1. 双击 `index.html`（或 `run.cmd`）；推荐 Edge/Chrome；
2. 开始页点击「开始游戏」→ 选门派 → 战斗；
3. 操作：WASD/方向键移动，Shift 闪身，F3 性能面板；升级时方向键/鼠标选择三选一；结算页 R/点击「再来一局」。

### 7.2 AC-1 ~ AC-13 复现

| AC | 复现操作 | 观察证据 |
| --- | --- | --- |
| AC-1 地图可移动 | 进入战斗后持续移动 | 角色位置连续变化，地图明显大于一屏，边界不卡死 |
| AC-2 自动攻击 | 靠近怪物不按攻击键 | 自动发射剑气、怪物掉血、有受击反馈；离开范围停止 |
| AC-3 击杀与掉落 | 击杀怪物 | 怪物消失，原位出现可见掉落物 |
| AC-4 拾取生效 | 走到掉落物处 | 掉落物消失、拾取计数/银两变化 |
| AC-5 升级成长 | 累积经验升级 | 升级后属性提升，且经三选一选择后立即可核对 |
| AC-6 后期清屏 | 推进到后期（F4/F5 或正常游玩） | 同屏怪密度显著上升、范围清怪、成片消失与伤害数字 |
| AC-7 非卡牌 | 完整游玩 | 无抽牌/手牌/牌组/回合制元素 |
| AC-8 可运行可复现 | `?seed=1234` 同操作两次 | 现象可重复；后期保持可玩帧率；重开一局状态复位 |
| AC-9 开始页 | 双击打开 | 先见独立开始页：游戏名 + 三块玩法说明 + 开始按钮；点击后进入门派选择 |
| AC-10 结算评分页 | 玩到死亡或 8:00 | 自动进结算：存活时间/等级/击杀/拾取/银两/最终攻击 + S/A/B/C + 再来一局；抽查三项数值一致 |
| AC-11 门派选择 | 开始后选不同门派各开一局 | 3 门派卷轴可选；剑宗攻速快、刀门单伤高、医谷 HP 高且缓慢回血；F3 详表可核对 |
| AC-12 升级三选一 | 击杀至升级 | 暂停并弹 3 个卷轴/石碑选项；选择后立即生效；下次升级再来 3 个；无卡牌元素 |
| AC-13 素材替换 | 查看 `assets/generated/` 与 `SOURCES.md`；断网启动游玩 | 生成素材被引用、观感区别于占位；`tools/art/MANIFEST.json` 记录成败；断网正常运行 |

> AC-1 ~ AC-13 均需在真实浏览器/真实运行环境中人工目视验收；仅凭截图、自述或日志不得判定通过（意图 §5）。

### 7.3 验收辅助

- `?seed=1234`：同种子复现升级序列与掉落；
- `?timescale=`：时间加速；F3 性能面板；F4 跳 5:30；F5 怪潮；F6（`?debug=1`）直接打开三选一面板（仅调试，不改变正式流程）。

## 8. 性能预算

| 指标 | 预算 | 说明 |
| --- | --- | --- |
| 帧率 | 60 fps 目标 / ≥45 fps 底线（300 怪） | 不变 |
| 模拟/渲染 | p95 ≤ 6 ms / ≤ 8 ms | 三选一暂停不增加战斗中开销 |
| 实体上限 | 怪 300 / 剑气 200 / 掉落 150 / 粒子 600 / 数字 64 | 不变 |
| 素材内存 | `assets/generated/` 解码后 ≤ 8 MB；启动预解码，运行不反复 decode | WebP q90 + 尺寸上限 |
| 覆盖层 | 打开时 ≤ 1 ms/帧 | DOM + CSS，不走 Canvas 重绘 |

## 9. 与旧流程线实现的关系

- **路径与属主不变**：`src/core/`、`src/combat/`、`src/monsters/`、`src/loot/`、`src/fx/`、`src/ui/`、`tests/`、`styles/` + `assets/`、`index.html` + `run.cmd` 与项目既有实现一致；新增 `src/sects/`、`tools/art/` 为全新目录。
- **行为约定（相对 v1 基线设计的替换）**：

| 项 | v1 基线设计 | 本流程线 |
| --- | --- | --- |
| 升级成长 | loot 自动 applyGrowth | sects 三选一（`choice:offer/pick`），loot 不写属性 |
| `ability:unlock` | loot 在 Lv3/5/8 发出 | 停用；绝学改为三选一的保底选项 |
| 属性写入 | loot `applyGrowth()` | `WG.sects.Selection` 唯一写入 |
| 界面 | 标题/结算简单 `screens` | `ScreenFlow` 状态机 + `Overlays` 覆盖层 |
| 素材 | 纯程序化占位 | `assets/generated/` 生成素材 + 占位回退 |

- 旧流程线 `docs/contracts/wuxia-rogue-architecture-v2.md` 为只读参考；本流程线以本文件为准。

## 10. 变更与冻结

- 冻结内容：模块 id/路径、`WG.sects.*`、`WG.ui.ScreenFlow/Overlays/score`、事件名、脚本顺序、素材目录约定。
- 修改任一内容须出 v2 架构并同步 proposal/modules/roster 新版本；旧版只读。
- **永久禁止**：卡牌机制（抽牌/手牌/牌组/构筑/卡面抽取）进入架构；运行时联网或加载模型。
