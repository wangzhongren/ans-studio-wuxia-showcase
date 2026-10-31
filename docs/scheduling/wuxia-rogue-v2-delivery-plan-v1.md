# 江湖夜雨 · wuxia-rogue-v2 交付计划 v1

> 流程线：`wuxia-rogue-v2`（run `run-20261031-wuxia-rogue-v2-91a1b83a`，pinned 2026-10-31T09:55:23Z，8 角色）
> 意图：`docs/product/wuxia-rogue-v2-intent-v1.md`（S1~S13 / AC-1~AC-13）
> 方案：`docs/proposals/wuxia-rogue-v2-proposal-v1.md`
> 模块：`docs/proposals/wuxia-rogue-v2-modules-v1.md`（11 模块）
> 名单：`docs/proposals/wuxia-rogue-v2-roster-v1.md`（8 角色）
> 契约：`docs/contracts/wuxia-rogue-v2-architecture-v1.md`（冻结）
> 编制：运营（convener）｜2026-10-31

## 0. 基线核对（已完成）

- run `run-20261031-wuxia-rogue-v2-91a1b83a`：state=pinned，项目角色 8 个（env-bootstrap、core-engine、combat-player、monsters-director、loot-progression、presentation-fx、sect-designer、art-generator），无需再刷新 pin。
- 旧流程线 `wuxia-rogue` 的运行基线停用，本线为唯一实现线；代码共用现有工作区，**在现有实现上继续/核对，不重做已正确部分**。
- 现状代码：`src/core`（Loop 暂停/恢复、main 状态机）、`src/ui`（ScreenFlow 三界面 + Overlays）已是 v2 形态；`src/sects/`、`tools/art/`、`assets/generated/` 尚不存在；`src/combat`、`src/loot` 仍为 v1 属性/升级路径；`index.html` 已按 26 脚本顺序加载（含尚不存在的 sects 三个文件）。

## 1. 阶段与依赖

```
P1 基础与并行
  ├─ sect-designer     src/sects/         （新目录，解锁升级三选一/门派）
  ├─ art-generator     tools/art/         （长耗时，最早启动）
  ├─ combat-player     src/combat/        （stats 扩展、暴击/减伤/回血、choice:pick）
  ├─ loot-progression  src/loot/          （level:up 收窄为 {level}，去 applyGrowth）
  ├─ presentation-fx   src/ui/            （三界面核对、卷轴/石碑样式、素材引用与回退）
  ├─ monsters-director src/monsters/      （核对 level:up {level} 与 runTime 难度，无回归）
  └─ env-bootstrap     入口/样式核对       （index.html/run.cmd/theme.css 占位与回退）
P2 接入与整合
  ├─ env-bootstrap     assets/generated/ + SOURCES.md（依赖 MANIFEST）
  ├─ presentation-fx   引用 assets/generated/* + onerror 回退
  └─ core-engine       tests/（perf.js 适配 v2、integration-check 26 脚本、F3 详表）
P3 联调与回归
  └─ core-engine + 运营：全量回归、AC-9~AC-13 复现路径、缺陷返工
P4 交付
  └─ 运营：交付报告落盘 + 向幕僚短报（不提交验收卡，验收由质检发起）
```

依赖规则：sects 与 combat/loot 的接口以架构 §4/§5 为准；combat 先扩展 stats 字段，sects 再写入；tests 的 26 脚本断言以 sects 文件落地为前提；素材接入以 `tools/art/MANIFEST.json` 为唯一真源。

## 2. 模块任务与验收要求

| 阶段 | 角色 | 模块（moduleId / 路径） | 任务要点 | 证据 |
| --- | --- | --- | --- | --- |
| P1 | sect-designer | sects-progression / `src/sects/` | `defs.js`/`upgrades.js`/`selection.js`：三门派初始属性（§5.1 数值）、专属被动、8 通用 + 每门派 2 专属 + 绝学，抽取规则 §6.3（1 专属+2 通用、Lv3/5/8 首位绝学、不重复、排除满层、种子 RNG）；`selectSect` 写 `WG.combat.player.stats` 并发 `sect:selected`；`choice:offer/pick` 串接 `Loop.pause/resume`；`reset()` | 三文件 `node --check`；seed 复现抽取序列样例；属性写入字段清单 |
| P1 | art-generator | art-pipeline / `tools/art/` | 14 项资产提示词（§8.2/8.3）、`generate.py`/`verify.py`、`out/*.png`、`MANIFEST.json`；离线（`HF_HUB_OFFLINE=1`）、CPU offload + fp16；失败如实 `failed`+原因，不得虚报 | prompts 14 份、MANIFEST 逐项 status、脚本与 README、环境/安装记录 |
| P1 | combat-player | combat-player / `src/combat/` | `stats` 增加 `critRate/critMult/damageReduction/regen`；`damage` 暴击结算；`takeDamage` 减伤；`regen` 回血；订阅 `choice:pick`（dm_cleave/whirl/swords）；只读 `pierce`/`projectileSpeed`/`potionDropMult`/`potionHealBonus` 加法字段（sects 写入） | `node --check`；stats 字段与伤害路径说明；不重复写成长字段 |
| P1 | loot-progression | loot-progression / `src/loot/` | `level:up` 载荷收窄为 `{level}`；移除 `applyGrowth` 与 `ability:unlock`；保留 `reset()` 与种子掉落；`tables` 不含自动成长表 | `node --check`；事件载荷核对；reset 行为说明 |
| P1 | presentation-fx | hud-ui / `src/ui/` | 核对 title/sect/choice/result 四态与 `WG.ui.{HUD,ScreenFlow,Overlays,score}`；`scroll-panel`/`stele-option` 样式口径；禁用 card/deck/hand 命名；结果页数值直出 `run:result.stats` | 自检脚本/`node --check`；界面状态机与事件订阅清单；卡牌词扫描 |
| P1 | presentation-fx | visual-fx / `src/fx/` | 订阅 `choice:pick` 播放回旋/裂空/万剑特效；对象池与上限不变 | `node --check`；特效映射说明 |
| P1 | monsters-director | monsters-waves / `src/monsters/` | 核对 `level:up` 只读 `{level}`；难度按 `runTime`/等级推进；死亡发 `monster:killed`；上限 300 | `node --check`；改动说明（无必要不改） |
| P1 | env-bootstrap | entry-index / `index.html`,`run.cmd` | 核对 26 脚本顺序与 architecture §3.2 完全一致；无内联玩法/外链；`run.cmd` 可双击 | 脚本清单逐项比对；`run.cmd` 内容 |
| P1 | env-bootstrap | env-resources / `styles/`,`assets/` | 核对 `theme.css` 变量与卷轴/石碑样式；`assets/generated/` 接入位与 `SOURCES.md` 模板；占位素材回退 | 样式类名核对；SOURCES 模板 |
| P2 | env-bootstrap | env-resources / `assets/generated/` | 将 `MANIFEST` 中 `status=ok` 转 WebP(q90) 接入，写 `SOURCES.md`（逐项生成/占位、失败原因） | 目录清单、SOURCES.md、大小统计 |
| P2 | presentation-fx | hud-ui / `src/ui/` | UI 引用 `assets/generated/*` 并 `onerror` 回退占位，不阻塞启动 | 引用点与回退逻辑 |
| P2 | core-engine | perf-harness / `tests/` | `perf.js` 适配 v2（26 脚本 + 暂停态）；`integration-check.js` 升级为 26 脚本与 v2 断言（状态机、门派差异、暂停/选择、评分一致、重开复位、卡牌词扫描）；F3 详表可核对 | 脚本运行结果（通过/失败逐条）、F3/F4/F5 复现说明 |
| P3 | core-engine | perf-harness / `tests/` | 全量回归并修复本模块内缺陷；跨模块缺陷回报运营转派 | 回归输出 |
| P4 | 运营 | `docs/scheduling/` | 交付报告：启动、AC-9~AC-13 复现路径、素材核对、回归结果、偏差与限制 | 报告落盘 + 幕僚短报 |

## 3. 跨模块约定（本计划口径）

1. **属性写入唯一**：门派初始属性与升级成长只由 `WG.sects.Selection` 写 `WG.combat.player.stats`；combat/loot/monsters 不写成长字段。
2. **stats 加法字段兜底**：架构 §4.3 的 stats 列表未含方案 §6.2 的「剑气穿透 +1」「剑气飞行速度 +15%」「疗伤丹掉落/回复加成」；以加法字段 `pierce`、`projectileSpeed`、`potionDropMult`、`potionHealBonus` 兜底，由 sects 写入、combat/loot 只读，不改变既有字段语义。
3. **升级流程**：`level:up {level}` → sects `UpgradePool.offer` → `choice:offer` → main `Loop.pause` → Overlays 呈现 → 玩家选择 → `Selection.choose` → `choice:pick` → main `Loop.resume`。未选择前不得自动替选。
4. **界面状态**：`ScreenFlow` 持有 title/sect/playing/result；`main` 只按事件切换；升级覆盖层不改变界面状态。
5. **评分一致**：`WG.ui.score(stats)` 纯函数；`run:result` 的 `stats/score/grade` 与结算页直出同一对象。
6. **F3 脚本缺口**：architecture §3.2 的 26 脚本未列 `tests/perf.js`，但 AC-11 要求「F3 详表可核对」、§7.3 列 F3/F4/F5；沿用旧线做法：在 main 之后追加 `tests/perf.js` 作为第 27 个 defer 脚本，并在交付报告标注此偏差。index.html 的 26 项与契约逐项一致由 env-bootstrap 保持。
7. **素材隔离**：运行时只引用 `assets/generated/`；`index.html`/`src/**` 不得引用 `tools/art/`；无 fetch/远程 URL/模型加载。

## 4. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| Qwen 依赖未装/显存不足 | 素材缺失 | 先装依赖再生成；CPU offload + fp16；失败保留占位并如实记录，不阻断其它模块 |
| 新 sects 文件未落地时 index.html 404 | 控制台报错但其它脚本可运行 | sects 任务优先；联调阶段复核无残留 404 |
| 三选一被做成卡牌观感 | AC-7/AC-12 不过 | `scroll-panel`/`stele-option` 命名与样式；全仓扫描 card/deck/hand/抽牌/手牌/牌组 |
| 暂停后模拟时间/帧统计异常 | F3/AC-12 | 选择期间仅渲染；`Loop.resume` 重置累加器（现有实现已核对） |
| 评分与统计不一致 | AC-10 不过 | 单一 stats 对象贯穿 run:result 与结算页 |
| 重开未复位 | AC-8 不过 | `Progression/LootSystem/Selection.reset` 全覆盖，集成测试覆盖 |

## 5. 短报节奏

- 每模块完成：角色 → 运营 `submit_report`；运营汇总向幕僚短报（完成/阻塞/证据）。
- 阶段节点：P1 完成、素材接入完成、回归完成各一次汇总。
- 最终：交付报告落盘 + 幕僚报告；**不提交验收卡**（验收由质检发起）。
