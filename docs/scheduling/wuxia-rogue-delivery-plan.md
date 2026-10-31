# 交付计划 · 江湖夜雨（wuxia-rogue）

> 运营（convener）接交付后按架构依赖顺序组织实现。依据：
> `docs/contracts/wuxia-rogue-architecture-v1.md`、`docs/proposals/wuxia-rogue-roster-v5.md`、
> `docs/proposals/wuxia-rogue-modules-v1.md`、`docs/product/wuxia-rogue-intent-v1.md`。
> 已任命名单（D3 全选，decisionId=decision-req-051d96afb4546607）：env-bootstrap、core-engine、
> combat-player、monsters-director、loot-progression、presentation-fx。

## 角色 → 模块 → 路径

| 角色 | 模块 | 路径 | 阶段 |
| --- | --- | --- | --- |
| env-bootstrap | env-resources | styles/、assets/ | P1 |
| env-bootstrap | entry-index | index.html、run.cmd | P1 |
| core-engine | core-runtime | src/core/ | P1 |
| core-engine | perf-harness | tests/ | P1 |
| combat-player | combat-player | src/combat/ | P2 |
| monsters-director | monsters-waves | src/monsters/ | P2 |
| loot-progression | loot-progression | src/loot/ | P2 |
| presentation-fx | visual-fx | src/fx/ | P3 |
| presentation-fx | hud-ui | src/ui/ | P3 |

## 阶段

- **P1 基座**：环境入口与核心运行时先行（env-bootstrap ×2、core-engine ×2）。
- **P2 玩法**：战斗 / 怪物 / 掉落并行（三模块按冻结 WG.* 契约实现，互不直接调用）。
- **P3 表现**：特效与 HUD/流程（只读订阅事件，不写玩法状态）。
- **P4 集成联调**：组合根 `src/core/main.js` 装配、启动自测、AC 复现路径核对；集成问题按模块属主返工。
- **P5 交付**：说明启动方式、AC-1~AC-8 复现路径、已知限制；最终验收由质检发起，运营不发验收卡。

## 约束

- 派发一律携带准确 moduleId / modulePaths，目标为模块属主，不越界写他人文件。
- 跨模块只走 `WG.core.Bus` 事件与 `WG.*` 公开接口；core 不反向依赖上层。
- 全流程禁止任何卡牌元素（抽牌/手牌/牌组/构筑/三选一）。
- 复现钩子保留：`?seed=`、`?timescale=`、F3 性能叠层、F4 快进、F5 怪潮。
