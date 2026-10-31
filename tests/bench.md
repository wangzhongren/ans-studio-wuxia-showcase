# 江湖夜雨 · perf-harness 手工验收清单（tests/bench.md）

> 属主：core-engine（perf-harness，`tests/`）
> 契约：`docs/contracts/wuxia-rogue-architecture-v1.md` §4.2 / §6.2 / §6.3 / §7
> 范围：F3 性能叠层、F4 快进、F5 怪潮、URL 调试参数、Node 纯逻辑基准。
> 本清单只验证**性能与调试工装**；玩法 AC 的通过判定仍由质检（verifier）执行。

---

## 0. 一句话结论

`tests/perf.js` 提供契约要求的 `WG.perf.{overlay,stats,fastForward,spawnBurst}`；
`tests/bench.js` 为 Node 无头纯逻辑 1000 帧基准；本文件为 AC-1~AC-8 的手工复现清单。
**`tests/perf.js` 不在 architecture §3.2 的 22 个固定脚本内，需要 index.html 在 `src/core/main.js` 之后追加一行脚本标签（见 §1），由运营协调 entry-index 属主执行；本角色未修改 index.html。**

---

## 1. 集成依赖（必须先完成，否则 F3/F4/F5 不存在）

在 `index.html` 的脚本列表末尾、`src/core/main.js` 之后追加：

```html
<script defer src="src/core/main.js"></script>
<script defer src="tests/perf.js"></script>
```

- 顺序必须**在 main.js 之后**：perf.js 通过 `WG.core.boot()` 取世界，并监听键盘。
- perf.js 自身对缺失 `#hud-debug` / 未开局 / 模块未就绪均做安全跳过，不会阻断游戏启动。
- 该追加属于 entry-index 的加载清单变更，必须由运营协调 entry-index 属主确认后执行（architecture §3.2 固定脚本顺序的变更需同步架构版本）。
- 未追加时：`WG.perf` 不存在，F3/F4/F5 无效；`node tests/bench.js` 与 `node tests/perf-check.js` 仍可独立运行。

---

## 2. 启动与复现参数

### 2.1 启动

1. 双击 `index.html`（或 `run.cmd`）；推荐 Edge / Chrome。
2. 标题界面按 **Enter** 开始一局。
3. 若 `file://` 被企业策略限制：

   ```bat
   python -m http.server 8000
   ```

   然后访问 `http://localhost:8000/`。

### 2.2 URL 调试参数（由 core/main.js 解析）

| 参数 | 示例 | 作用 | 备注 |
| --- | --- | --- | --- |
| `?seed=` | `?seed=7` | 固定 mulberry32 随机序列，复现同一局 | 同 seed + 同操作 → 同现象（AC-8） |
| `?timescale=` | `?timescale=4` | 时间加速（1~8，仅调试） | 不改变单局 480s 的模拟时长，只加快墙钟 |
| `?debug=1` | `?debug=1` | 调试标记透传到 world | 不自动快进、不自动刷怪 |

组合示例：

```text
index.html?seed=1234&timescale=4&debug=1
```

**禁止项**：正式流程不得自动快进或自动生成怪；本工装只在显式按键/显式 API 调用时执行。

---

## 3. F3 / F4 / F5 行为

| 键 | 行为 | 前置条件 | 可观察证据 |
| --- | --- | --- | --- |
| **F3** | 切换 `#hud-debug` 叠层显隐（`hidden` 属性） | 无（标题界面也可开） | 面板出现/消失；每 250ms 刷新，隐藏时不轮询 |
| **F4** | `WG.perf.fastForward(330)`：对局时间跳到 5:30，并按导演曲线补怪 | `world.state === 'playing'` | 对局时间 05:30；剩余 02:30；怪物数向 ~220 靠拢 |
| **F5** | `WG.perf.spawnBurst(120)`：立即在屏外生成 120 只怪 | 同上，且 `WG.monsters` 已就绪 | 怪物计数 +120（受 300 硬上限约束） |

按键细节：

- 边沿触发：忽略 `keydown.repeat`；Ctrl/Meta/Alt 组合不触发；只拦截 F3/F4/F5 的默认行为。
- 未开局（标题/结算）按 F4/F5：安全跳过，F3 仍可开关；叠层的「操作」行显示跳过原因。
- F4 的补怪通过 **公开批量接口** `WG.monsters.Director.spawnBurst(deficit)`（缺失时回退 `MonsterSystem.spawnBurst`），不触碰怪物内部对象。
- F4 **不伪造玩家等级/经验/HP**：这些状态归 loot/combat 所有；因此 AC-6 的「回旋/万剑成片清怪」需要正常玩到 Lv5+（或用 `?timescale=` 加速实玩），不能只靠 F4。
- F4/F5 生成的怪使用模板基础属性（`spawnBurst` 不叠加按时间成长的 HP/伤害倍率），用途是压力/帧率观察，不作为数值平衡验收。
- F5 的实际生成数可能小于 120：受 300 硬上限、屏外取点失败或模块未就绪影响；叠层「操作」行显示实际数量。

### 3.1 F4 在 330s 的目标数

按 `CONFIG.director.targets` 线性插值：`[300,200] → [420,280]`，330s ≈ **220**。
若当前存活更少，F4 会调用一次批量生成补齐缺口（例：12 → 220，请求 208）。
之后 Director 仍按正常节奏补怪/清怪。

---

## 4. F3 面板字段

`#hud-debug` 使用 `styles/theme.css` 的 `.hud-debug` 两列网格（`hud-debug__key` / `hud-debug__val`），共 19 行：

| 行 | 含义 | 数据来源 |
| --- | --- | --- |
| FPS | 最近帧率 | `WG.core.Loop.frameStats.fps` |
| 帧耗时 | 整帧毫秒 | `frameStats.frameMs` |
| 模拟 p95 | 模拟耗时 p95 | `frameStats.p95Sim` |
| 渲染 p95 | 渲染耗时 p95 | `frameStats.p95Render` |
| 阶段 | 本帧 sim / draw 毫秒 | `frameStats.simMs/renderMs` |
| 补步 | 本帧固定步执行次数（≤3） | `frameStats.steps` |
| 怪物 / 剑气 / 掉落 / 粒子 / 数字 | 实体计数 | 各模块公开 count（见 §6） |
| 等级 | `Lv.n xp/xpNext` | `WG.combat.player.stats` |
| 攻击 | 攻击力 / 攻击间隔 | 同上（AC-5） |
| 拾取 | 拾取半径 / 磁吸半径 | 同上（AC-5） |
| HP | 当前/最大气血 | `WG.combat.player` |
| 降级 | `开/关` | `WG.fx.degrade.enabled` |
| 对局 | 状态 + 已进行时间 | `WG.core.boot()` 返回的 world |
| 种子 | 本局 seed | world.seed |
| 操作 | 最近一次 F4/F5 结果 | perf 内部记录 |

阈值高亮（沿用 `styles/theme.css` 的 `--warn` / `--bad`）：

- FPS > 0 且 < 45 → 警告色；
- 模拟 p95 > 6 ms、渲染 p95 > 8 ms → 警告色；
- `degraded=开` → 警告色；HP ≤ 0 → 危险色。

> 说明：当前 `WG.combat.CombatSystem` 在 main.js 中被直接赋值而**未实例化**，`entities.projectiles` 会安全地显示 **0**；一旦 combat 属主提供实例/`projectilePool`，叠层会自动读取真实数量（见 §7 遗留问题）。

---

## 5. AC-1 ~ AC-8 手工验收清单

> 每条按「操作 → 观察证据 → 通过标准」执行；建议每步截图或记录 F3 数值。
> 同一轮验收固定一个 seed（如 `?seed=1234`），便于对比。

### AC-1 地图滚动与障碍滑动

- 操作：开始后按住 **D** 8 秒；再绕岩石/贴崖壁行走。
- 观察：背景/网格/障碍持续滚动，出现新区域；贴障碍沿切线滑动，不卡死、不抖动穿墙。
- 通过：8 秒内持续位移；贴墙可滑；无卡死。

### AC-2 自动索敌与剑气

- 操作：靠近怪物至 **170 px** 内，不按攻击键；随后后退至 > 220 px。
- 观察：自动发射剑气；怪物掉血、白闪、出现伤害数字；走远后停手。
- 通过：自动开火；命中反馈可见；超出丢失半径后不再索敌。

### AC-3 击杀掉落

- 操作：任意击杀一只怪。
- 观察：怪物消失；死亡点出现经验珠/银两；可见掉落物。
- 通过：至少 1 个掉落物生成（经验珠必掉；银两按概率）。

### AC-4 拾取与 HUD

- 操作：走向掉落物（或进入磁吸半径）。
- 观察：掉落物飞向角色并消失；HUD 经验/银两/拾取数增加。
- 通过：HUD 计数单调增加；掉落物不复用后残留。

### AC-5 升级与 F3 详表

- 操作：连续击杀至升级；按 **F3**。
- 观察：等级 +1；F3 的「等级 / 攻击 / 拾取 / HP」行数值变化（攻击力 +2、攻速间隔 ×0.97、拾取半径 +2 等，以 loot 实现为准）。
- 通过：等级与至少一项属性变化能在 F3 面板直接读到。

### AC-6 5:30 怪潮与技能表现

- 操作 A（压力/帧率）：`?seed=7` 开始，按 **F4**；或正常等待 5 分钟。
- 操作 B（技能表现）：先用 `?timescale=4` 正常玩到 Lv5+，再按 F4 观察。
- 观察：同屏 **200+** 怪；回旋/万剑成片清怪；粒子、伤害数字、震屏可见。
- 通过：F3 怪物数 ≥ 200；技能表现可见；帧率见 AC-8。
- **注意**：F4 只推进时间与怪潮，不伪造等级；只按 F4 时玩家可能仍是低等级、且可能被瞬间围杀。技能证据请用操作 B。

### AC-7 无卡牌元素

- 操作：完整玩一局，查看标题/升级/结算/重开所有界面。
- 观察：无抽牌、手牌、牌组、构筑、三选一卡面；升级无卡面选择。
- 通过：全程无任何卡牌机制（架构 §9 永久禁止）。

### AC-8 确定性与帧率底线

- 操作：同 seed、同操作重开两次；再用 F4/F5 压测怪潮。
- 观察：两次现象一致（刷怪节奏/掉落序列/伤害数字顺序）；F3 显示 **≥45 fps**（目标 60）；无持续卡死；模拟 p95 ≤6 ms、渲染 p95 ≤8 ms。
- 通过：确定性一致 + 帧率底线达标 + 补步不超过 3。

### 记录表（建议）

| AC | seed | 结果（PASS/FAIL） | 证据（F3 数值/截图/备注） |
| --- | --- | --- | --- |
| AC-1 |  |  |  |
| AC-2 |  |  |  |
| AC-3 |  |  |  |
| AC-4 |  |  |  |
| AC-5 |  |  |  |
| AC-6 |  |  |  |
| AC-7 |  |  |  |
| AC-8 |  |  |  |

---

## 6. stats 契约与实体计数口径

`WG.perf.stats` 为 **getter 实时视图**（每次读取原地刷新，返回稳定对象）：

```js
{
  fps, p95Sim, p95Render,
  entities: { monsters, projectiles, drops, particles, numbers },
  degraded
}
```

| 字段 | 口径 | 实现 |
| --- | --- | --- |
| `monsters` | 存活怪数 | `WG.monsters.MonsterSystem.count`（getter） |
| `projectiles` | 玩家剑气活跃数 | `WG.combat.player`/系统实例的 `projectilePool.count`；无实例则为 0 |
| `drops` | 掉落物活跃数 | `WG.loot.LootSystem.count`（**方法**，perf 已按函数调用） |
| `particles` | 粒子数 | `WG.fx.particles.count`（getter） |
| `numbers` | 伤害数字数 | `WG.fx.numbers.count`（getter） |
| `degraded` | 自动降级是否开启 | `WG.fx.degrade.enabled` |

注意：

- 敌方箭矢（`MonsterSystem.stats().arrows`）不计入 `entities.projectiles`；本字段对应架构 §7 的「剑气 200」上限。
- 若 F3 的「剑气」长期为 0，先排查 §7 的 CombatSystem 实例化问题。

---

## 7. Node 无头工具

### 7.1 纯逻辑 1000 帧基准

```bat
node tests/bench.js
```

- 无 DOM、无 Canvas、无 rAF；加载 `src/core/{config,rng,pool,spatial-hash,bus}.js`。
- 满载：300 怪 + 200 剑气 + 150 掉落 + 600 粒子 + 64 数字；每帧含哈希重建、约 500 次圆形查询、池周转、RNG 与 Bus。
- 缺失核心脚本时打印缺失文件并以退出码 1 结束（不会静默通过）。

本次实测（Node，开发机，2026-10-31）：

```text
seed=20261031  frames=1000  warmup=120  dt=1/60
sim/frame: p50=0.072 ms  p95=0.116 ms  p99=0.154 ms  max=0.488 ms  avg=0.078 ms
budget: CONFIG.perf.simP95Ms=6 ms → PASS
```

> 该数字只是 Node CPU 回归基线（无渲染、无 GC 压力模拟），**不代表浏览器 F3 帧率**；浏览器验收以 AC-8 的 F3 读数为准。

### 7.2 perf 契约自检

```bat
node tests/perf-check.js
```

覆盖：stats 字段与实时性、三种计数形态、spawnBurst 上限/未开局保护、fastForward 时间与补怪、F3/F4/F5 边沿、overlay 构建与安全跳过。
本次结果：**52 passed, 0 failed**。

### 7.3 真实模块集成自检

```bat
node tests/perf-integration-check.js
```

加载**真实** `src/core/*` 与 `src/monsters/{types,ai,director}.js`（不使用怪物桩），验证：

- `perf.spawnBurst(120)` 经真实 `Director → MonsterSystem.spawnBurst` 生成 120 只，且全部位于视口外 ≥ 240 px 环带；
- `perf.fastForward(330)` 把 `runTime` 推到 330、`remaining` 推到 150，并将同屏怪补到 200~220；
- 再次生成受 300 硬上限约束；
- 300 怪下 `MonsterSystem.update` / `Director.update` 不抛错；`stats.entities.projectiles` 安全为 0。

本次结果：**16 passed, 0 failed**。

---

## 8. 已知限制与遗留问题（需其他属主处理）

1. **index.html 缺少 perf.js（集成阻塞）**
   必须在 `src/core/main.js` 之后追加 `<script defer src="tests/perf.js"></script>`。本角色不修改 index.html；需运营协调 entry-index 属主，并确认 architecture §3.2 固定脚本顺序的变更口径。

2. **CombatSystem 未实例化（combat/main 集成缺陷）**
   `src/combat/auto-attack.js` 导出的是构造器 `WG.combat.CombatSystem`，而 `src/core/main.js` 直接把它赋给 `world.combat` 并按 `update(dt, world)` 调用；仓库内没有任何 `new CombatSystem(...)`。后果：战斗更新可能抛错（被 Loop 捕获记录）、`projectilePool` 不存在、F3「剑气」恒为 0。应由 combat 属主提供单例/工厂，main 属主改为实例调用；perf 已对缺失实例安全降级为 0。

3. **F4 不伪造成长**
   等级/经验/技能解锁归 loot 所有；F4 只推进对局时间并按导演曲线补怪。AC-6 的技能表现需正常玩到 Lv5+（可配合 `?timescale=4`）。

4. **F4/F5 的怪使用基础模板属性**
   `spawnBurst` 不叠加按 `runTime` 成长的 HP/伤害/速度倍率；仅用于压力与帧率观察，不用于平衡验收。

5. **Canvas 绘制缓冲尺寸未发现设置点（entry-index/core 集成风险）**
   `index.html` 的 `<canvas id="game">` 没有 `width/height` 属性，注释称「尺寸由 core/main.js 按视口与 DPR 设置」，但 `src/core/main.js` 中未发现 canvas / devicePixelRatio 相关代码。若实际运行出现 300×150 拉伸模糊，应由 entry-index/core 属主补齐（perf-harness 不负责画布尺寸）。

6. **F3 面板只读**
   叠层不写玩法状态；显示值来自公开计数与只读 player.stats。若某模块未就绪，对应行显示 `-` 或 0，不抛错。

---

## 9. 快速自检命令汇总

```bat
node --check tests/perf.js
node --check tests/bench.js
node --check tests/perf-check.js
node --check tests/perf-integration-check.js
node tests/bench.js
node tests/perf-check.js
node tests/perf-integration-check.js
```

预期：四条 `--check` 均 exit 0；bench 输出 p95 并 PASS/OVER BUDGET；perf-check 输出 `52 passed, 0 failed`；集成自检输出 `16 passed, 0 failed`。
