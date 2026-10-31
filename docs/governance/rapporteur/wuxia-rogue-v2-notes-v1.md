# wuxia-rogue-v2 治理笔记 v1 — 新流程线 v1 单据产出（任务 #t-mvw7yht9-c199aa21）

日期：2026-10-31
角色：rapporteur（策划）
flowId：wuxia-rogue-v2｜intentId：wuxia-rogue-map-v2

## 1. 背景与依据

- 新流程线意图已确认：`docs/product/wuxia-rogue-v2-intent-v1.md`（intentId=`wuxia-rogue-map-v2`，version 1，S1~S13 / AC-1~AC-13）；意图入口 `docs/intents/wuxia-rogue-map-v2.md`。
- 目的：旧流程线 `wuxia-rogue` 的 run 基线无法刷新（应用固定核对 v1 规范物证），新增角色无法派发；按同一已批准范围（`req-36c38669f1d06b83`）新开流程线以重新生成基线，范围不扩大。
- 必读：`docs/contracts/wuxia-rogue-architecture-v2.md`（旧流程线架构，sha256 `3d8dc69b…`）已通读；本流程线架构按同一设计重述。

## 2. 产出（4 份 v1 单据，自足，不依赖旧流程线）

| 文件 | schema | 字节 | sha256 |
| --- | --- | --- | --- |
| `docs/proposals/wuxia-rogue-v2-proposal-v1.md` | project-proposal/v2 | 17,577 | `6aea2849e6d9bcef18fdd225d0455d253e908826bf77798067346c001ab4eaf8` |
| `docs/proposals/wuxia-rogue-v2-modules-v1.md` | project-modules/v2 | 9,612 | `306553003018078430b876fa447ddc54f63ce87e3205c67303979e7646d64ee3` |
| `docs/proposals/wuxia-rogue-v2-roster-v1.md` | project-roster/v3 | 15,200 | `957a47f31ab5d7c2c05ab73f18b056f22d35c455fb6178fb60765d1c9ba74873` |
| `docs/contracts/wuxia-rogue-v2-architecture-v1.md` | project-architecture/v1 | 20,348 | `d4bec46b8d05157563b1da2bc2462c8a3a86d2fe5ebfe9e1519e49656715c152` |

frontmatter 关键字段：

- proposal：`flowId: wuxia-rogue-v2`、`intentId: wuxia-rogue-map-v2`、`version: 1`、`author: rapporteur`、`status: draft`、`intent: docs/product/wuxia-rogue-v2-intent-v1.md`、`modules/roster/architecture` 指向本流程线 v1 文件。
- modules：同上 flowId/intentId/version；11 模块；`architectureSource` 指向 `docs/contracts/wuxia-rogue-v2-architecture-v1.md#…`（锚点经脚本核对全部存在）。
- roster：同上；`modulesDoc: docs/proposals/wuxia-rogue-v2-modules-v1.md`；`references` 四键指向 v1 链；`envBootstrap.omitted: false`；8 角色 / 11 模块；management 仅存在于拓扑块（convener + 8 角色）。
- architecture：`flowId: wuxia-rogue-v2`、`intentId: wuxia-rogue-map-v2`、`version: 1`、`author: rapporteur`、`status: draft`、`proposal/modules/roster` 指向 v1；`baselineNote` 注明与旧流程线 architecture-v2 设计一致。

## 3. 模块-属主对照（11 模块 / 8 角色）

| 模块 | 路径 | 属主 |
| --- | --- | --- |
| env-resources | `styles/`、`assets/`（env） | env-bootstrap |
| entry-index | `index.html`、`run.cmd`（entry） | env-bootstrap |
| core-runtime | `src/core/`（lib） | core-engine |
| perf-harness | `tests/`（test） | core-engine |
| combat-player | `src/combat/`（feature） | combat-player |
| monsters-waves | `src/monsters/`（feature） | monsters-director |
| loot-progression | `src/loot/`（feature） | loot-progression |
| visual-fx | `src/fx/`（feature） | presentation-fx |
| hud-ui | `src/ui/`（ui） | presentation-fx |
| sects-progression | `src/sects/`（feature） | sect-designer |
| art-pipeline | `tools/art/`（lib） | art-generator |

## 4. 自检结果

脚本：`docs/governance/rapporteur/check-v2flow.py`（纯 stdlib 只读），`python -I` 运行，exit 0：

```
intentId=wuxia-rogue-map-v2 flowId=wuxia-rogue-v2
modules(auth)=11 modules(snap)=11 roles=8 paths=13
owners: art-pipeline->art-generator, combat-player->combat-player, core-runtime->core-engine,
        entry-index->env-bootstrap, env-resources->env-bootstrap, hud-ui->presentation-fx,
        loot-progression->loot-progression, monsters-waves->monsters-director,
        perf-harness->core-engine, sects-progression->sect-designer, visual-fx->presentation-fx
OK: wuxia-rogue-v2 v1 单据自检通过（意图一致、模块快照一致、单一属主、拓扑/management 一致、路径无重叠、架构锚点齐全）
```

覆盖项：意图/流程线/intentId 五文件一致；intentId 满足 slug 规则且不等于 flowId；模块快照与权威模块清单逐字一致；11 模块、8 角色齐全；每模块恰一个属主；拓扑块 modules/roles/management 与 frontmatter 一致且 frontmatter 无 management；13 条路径两两不重叠/不嵌套；env-resources=env、entry-index=entry；架构锚点全部存在。

首次运行曾报 11 条「架构锚点不存在」，原因是脚本自身把锚点集合加了 `#` 前缀再比较（脚本缺陷），修正后全绿；文档内容未改动。

## 5. contract_check（flowId=wuxia-rogue-v2）

- run：`run-20261031-wuxia-rogue-v2-91a1b83a`｜flow wuxia-rogue-v2｜state=draft
- 意图入口：intentId=`wuxia-rogue-map-v2`｜来源=proposal｜入口 `docs/intents/wuxia-rogue-map-v2.md`｜存在=yes｜intentId 匹配=yes
- 意图来源：产品意图=wuxia-rogue-map-v2｜提案=wuxia-rogue-map-v2｜一致性=yes
- 该 run 仍为 draft（未钉），故 contract_check 不列 pinned 文档清单；识别意图与提案一致，未见 proposal-missing/roster-missing 等拒绝码。

## 6. 说明与遗留

1. **规范路径物证镜像**：本任务只要求 4 份文件，未额外创建 `docs/proposals/wuxia-rogue-v2-v1.md` 一类规范路径镜像。若应用按旧约定（`docs/proposals/<flowId>-vN.md`）核对物证，请在下次派发时明确，我再补齐（不与 4 份单据冲突）。
2. **与旧流程线关系**：旧流程线 `wuxia-rogue` 的文件未改动（proposal-v2/modules-v2/roster-v6/architecture-v2、proposal-v1 均只读引用）；本流程线单据自足。
3. 未写验收/质量/排期文档；未写角色卡；未发提案/任命/验收卡（本任务未要求）。
4. 审计提示：本任务新增的 shell 调用仅为 `python -I`（只读自检）与 4 次 `certutil -hashfile`（只读哈希），未写盘。
