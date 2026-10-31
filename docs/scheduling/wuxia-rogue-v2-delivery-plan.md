# 江湖夜雨 v2 交付组织计划（运营 / convener）

- flowId: `wuxia-rogue`；intentId: `wuxia-rogue-map`
- 依据（按序）：
  1. `docs/contracts/wuxia-rogue-architecture-v2.md`（冻结）
  2. `docs/proposals/wuxia-rogue-proposal-v2.md`
  3. `docs/proposals/wuxia-rogue-roster-v6.md`
  4. `docs/proposals/wuxia-rogue-modules-v2.md`
  5. `docs/product/wuxia-rogue-intent-v2.md`
- 基线：v1 已交付并通过 AC-8 返工复验（`docs/scheduling/wuxia-rogue-delivery-report-v2.md`）。v2 为纯增量 + 两处行为替换（升级成长改三选一、界面改状态机）。
- 目标：交付可双击运行的 v2 原型，AC-1~AC-13 全部可复现；AC-9~AC-13 需真实浏览器人工目视验收（运营只做无头集成与自测，不代替客户验收，不发 acceptance 卡）。

## 1. 模块与属主（11 模块 / 8 角色，以 roster v6 为准）

| moduleId | 路径 | 属主角色 | v2 工作 |
| --- | --- | --- | --- |
| core-runtime | `src/core/` | core-engine | `Loop.pause/resume/paused`；`main.js` 界面状态机与组合根接线；新局复位 |
| perf-harness | `tests/` | core-engine | 无头集成测试升级到 26 脚本 + v2 断言；全量回归 |
| sects-progression | `src/sects/` | sect-designer（新增） | `defs.js`/`upgrades.js`/`selection.js`：门派初始属性、三选一池、选择应用、唯一成长写入点 |
| hud-ui | `src/ui/` | presentation-fx | `ScreenFlow`（title/sect/playing/result）、`Overlays`（门派卷轴/三选一石碑）、`score` 纯函数、HUD 门派显示 |
| visual-fx | `src/fx/` | presentation-fx | 订阅 `choice:pick` 播放回旋/裂空/万剑特效；素材加载失败回退 |
| combat-player | `src/combat/` | combat-player | `player.stats` 扩展（critRate/critMult/damageReduction/regen）；暴击与减伤结算；每秒回血；不再写成长字段 |
| loot-progression | `src/loot/` | loot-progression | `level:up` 只发 `{level}`；删除自动 `applyGrowth` 与 `ability:unlock`；保留 `reset()` |
| monsters-waves | `src/monsters/` | monsters-director | 不变（只随 `level:up` 读难度；无新任务，除非集成缺陷） |
| env-resources | `styles/`、`assets/` | env-bootstrap | 主题加入 `scroll-panel`/`stele-option` 样式；接入 `assets/generated/` + `SOURCES.md` |
| entry-index | `index.html`、`run.cmd` | env-bootstrap | 脚本顺序扩到 26 个（按架构 v2 §3.2） |
| art-pipeline | `tools/art/` | art-generator（新增） | 依赖安装、prompts/scripts/out/MANIFEST，Qwen-Image-2.1 离线生成 14 项素材 |

规则：一个模块一个属主；跨模块只走 `WG.*` 公开契约与 `Bus` 事件；任何角色不得修改他人模块文件。

## 2. 界面状态机与跨模块接线约定（供各模块实现对齐）

状态机（架构 v2 §5.1）：`title → sect → playing ⇄ choice → result → sect|title`。

- **hud-ui（状态持有者）**：`WG.ui.ScreenFlow.go(name)` 切换并渲染 `title/sect/playing/result`；`bindInput()` 处理按钮/键盘；页面按钮只调用自身状态切换或覆盖层回调。`Overlays.showSect(defs, onPick)`、`showChoice(options, onPick)`、`hide()` 为 DOM 覆盖层；`WG.ui.score(stats)` 为纯函数（公式见方案 §6.2）。
- **main.js（组合根，只按事件切界面/驱动循环）**：
  - 启动：`Loop.start(update,render)` → `ScreenFlow.go('title')`；非 `playing` 状态跳过 update（仅渲染）。
  - 订阅 `sect:selected`：复位本局（`Progression.reset`/`LootSystem.reset`/`Selection.reset`/重置计时统计）→ `ScreenFlow.go('playing')`。
  - 订阅 `choice:offer`：`Loop.pause()`；订阅 `choice:pick`：`Loop.resume()`。
  - 订阅 `player:dead` / 到达 8:00：收集本局统计对象 `{outcome, runTime, level, kills, picks, silver, atk}` → `score=WG.ui.score(stats)` → `Bus.emit('run:result', {outcome, stats, score, grade})`。
  - UI 侧「再来一局」→ `ScreenFlow.go('sect')`（新局在 `sect:selected` 时复位）；「返回标题」→ `ScreenFlow.go('title')`。
  - 兼容 v1 测试：`ui:restart` 旧事件可保留为「重开一局」，但 v2 主路径是状态机。
- **sects-progression（成长唯一写入）**：订阅 `level:up` → 用本局种子派生 RNG（`?seed=` 与 main 同源；无 seed 时随机）→ `UpgradePool.offer(level, sectId, rng)` → `Bus.emit('choice:offer', {level, options})`；`choose(optionId)` 应用效果并对 `WG.combat.player.stats` 写回 → `Bus.emit('choice:pick', {optionId, level})`。`selectSect(id)` 应用初始属性 → `Bus.emit('sect:selected', {sectId})`。
  - 契约 §4.3 的 stats 列表未覆盖方案里的「穿透/剑气飞行速度/丹药加成」：以 **stats 加法字段** 兜底（`pierce`、`projectileSpeed`、`potionDropMult`、`potionHealBonus`），由 sects 写入、combat/loot 只读；不改事件名与公开方法签名，交付报告中如实说明该扩展。
- **combat-player**：只读写位置/HP/计时；`stats` 由 sects 写成长字段；命中按 `critRate/critMult` 结算并在 `damage` 载荷带 `crit`；`takeDamage` 内应用 `damageReduction`；`regen` 每秒回血；订阅 `choice:pick` 执行 `dm_cleave`（每 4s 范围斩）与 `whirl`/`swords`（解锁 v1 绝学）。
- **loot-progression**：`addXp` 升级只发 `level:up {level}`；不再 `applyGrowth`/`ability:unlock`。
- **presentation-fx**：覆盖层命名只用 `scroll-panel`/`stele-option`，禁止 card/deck/hand 命名；素材引用 `assets/generated/*`，`onerror`/缺失回退程序化占位。
- **art-generator**：只写 `tools/art/`；运行时不得引用 `tools/art/`。
- **env-bootstrap**：只接入 `MANIFEST.json` 中 `status=ok` 的素材；失败项在 `SOURCES.md` 标「占位」并写原因；`index.html` 按 §3.2 顺序（26 个 defer 脚本，`src/core/main.js` 最后）。

## 3. 阶段与派发顺序

**P1 基座（并行）**
1. core-engine：`src/core/` —— `Loop.pause/resume/paused`；`main.js` v2 接线（状态机、事件、新局复位、8:00 结算）；保持既有无头测试可运行。
2. sect-designer：`src/sects/` —— 三门派 DEFS、升级池与抽取规则（方案 §5.2/§5.3）、Selection 应用与 reset；含自测脚本（`src/sects/selftest.js` 可保留或自删，最终交付只留 `defs.js/upgrades.js/selection.js`）。
3. presentation-fx：`src/ui/` —— ScreenFlow/Overlays/score/HUD 门派；开始页、门派卷轴、三选一石碑、结算评分页；非卡牌命名。
4. env-bootstrap：`index.html`/`run.cmd` —— 26 脚本顺序；`styles/theme.css` 增加 `scroll-panel`/`stele-option` 与覆盖层样式；`assets/generated/` 目录与 `SOURCES.md` 骨架（素材接入待 MANIFEST）。
5. art-generator：`tools/art/` —— 装依赖（torch cu12x + diffusers/transformers/accelerate/pillow）、写 14 个 prompt、`generate.py`/`verify.py`、离线生成、`MANIFEST.json` 逐项记录（失败如实记原因）。

**P2 玩法与表现（依赖 P1 契约，可并行）**
6. combat-player：`src/combat/` —— stats 扩展、暴击/减伤/回血结算。
7. loot-progression：`src/loot/` —— `level:up` 收窄、移除自动成长/`ability:unlock`。
8. presentation-fx：`src/fx/` —— `choice:pick` 特效订阅。
9. env-bootstrap：`assets/` —— 按 MANIFEST 接入 ok 素材为 WebP、写 SOURCES.md、更新 `index.html`/CSS 引用。

**P3 集成（依赖 P1/P2）**
10. core-engine：`tests/` —— 无头集成升级（26 脚本、v2 断言：状态机、门派属性差异、三选一暂停/生效、评分一致、reset、非卡牌命名扫描）；全量回归（v1 120 项不退化）。
11. 运营：跑 `node tests/integration-check.js` 与 v1 验收探针、v2 状态机探针；按需返工（把要求与证据写进任务）。
12. art/env：按 MANIFEST 与 `assets/generated/` 对账；失败项如实记录。

**P4 交付**
13. 运营：写 `docs/scheduling/wuxia-rogue-v2-delivery-report.md`（启动、AC-9~AC-13 复现路径、素材对账、回归结果、遗留真实问题）；向幕僚 `submit_report`；不发 acceptance 卡（由质检/客户验收）。

## 4. 证据与报告要求（各 worker）

- 代码：`node --check <file>` 全绿；自测脚本实跑输出（含断言数）。
- UI：说明每个 AC-9~AC-12 的 DOM/状态与复现操作；非卡牌命名自检（源码 grep card/deck/hand 不得命中玩法命名）。
- 美术：`tools/art/MANIFEST.json` 每项含 id/file/promptFile/seed/status/ms/reason；`assets/generated/SOURCES.md` 逐项「生成/占位」；失败不得虚报。
- 汇报：完成/未完成、改动文件、测试结论、遗留风险；不写验收结论。

## 5. 风险

- 24GB 显存/依赖安装/单图分钟级 → CPU offload + fp16，逐张生成、后台任务、失败留痕；生成不阻塞其他模块与集成。
- 跨模块接线（main ↔ ui ↔ sects）→ 按 §2 约定实现，集成阶段以无头测试暴露偏差。
- 三选一被做成卡牌观感 → 命名/样式走卷轴/石碑，P3 加源码扫描。
- AC-9~AC-13 最终判定 → 真实浏览器人工目视，由客户/质检完成，运营不代判。
