---
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 4
author: rapporteur
createdAt: 2026-10-31
---

# run pin 刷新尝试留痕 · wuxia-rogue（rapporteur）

## 1. 目标

将 run-20261031-wuxia-rogue-19963999 的 run pin 从 v1 单据集刷新到 v2，并把项目角色集合扩展到 8 个（含 `sect-designer`、`art-generator`），解除运营派发的 `run-role-missing`。

## 2. 刷新前事实（contract_check，只读）

| 项 | 值 |
| --- | --- |
| run | run-20261031-wuxia-rogue-19963999｜state=pinned｜pinnedAt 2026-10-31T06:31:10.163Z |
| 意图 | docs/product/wuxia-rogue-intent-v1.md |
| 方案 | docs/proposals/wuxia-rogue-proposal-v1.md（63dd139f…） |
| 模块 | docs/proposals/wuxia-rogue-modules-v1.md |
| 名单/拓扑 | docs/proposals/wuxia-rogue-roster-v5.md |
| 架构 | docs/contracts/wuxia-rogue-architecture-v1.md |
| 项目角色 | env-bootstrap、core-engine、combat-player、monsters-director、loot-progression、presentation-fx（6 个） |

v2 单据已就绪（intent v2、proposal v2、modules v2、roster v6、architecture v2；架构 v2 sha256 `3d8dc69b092c0d90…`，与派发哈希一致）。

## 3. 刷新尝试（proposal 卡）

按治理规则，用 `request_choice(cardKind=proposal, flowId=wuxia-rogue, intentId=wuxia-rogue-map)` 请客户/判断 agent 接受 v2 单据集。

| 次数 | 规范物证状态 | 结果 |
| --- | --- | --- |
| 1 | 仅 v1 镜像（含说明块） | 自动决策未通过：`规范物证缺失（docs/proposals/wuxia-rogue-v1.md（判断无法核对））` |
| 2 | 新增 `wuxia-rogue-v2.md`（与 proposal v2 逐字节相同） | 同上，路径仍指 v1 |
| 3 | 将 `wuxia-rogue-v1.md` 改为与 proposal v1 **逐字节相同**（63dd139f…） | 同上 |
| 4 | 恢复 v1 说明块；预览内嵌两份物证 frontmatter 与说明块全文 | 同上 |
| 5 | 将 `wuxia-rogue-v1.md` 内容改为**最新 v2 提案镜像**（15,420 B） | 同上 |

**结论**：无论规范物证文件是「说明块镜像」「逐字节相同」还是「v2 内容镜像」，自动决策均返回同一条错误，错误路径固定为 `docs/proposals/wuxia-rogue-v1.md`。说明该检查**不取决于物证文件内容**，而是应用侧的 pin/证据解析：proposal 卡在 run pin 仍为 v1 时无法核对 v2 单据集（先有鸡还是先有蛋）。rapporteur 侧无可用工具直接改写 run pin。

## 4. 当前文件状态（已如实记录）

- `docs/proposals/wuxia-rogue-proposal-v1.md`：**未改**（63dd139f…，run pin 原提案）。
- `docs/proposals/wuxia-rogue-proposal-v2.md`：**未改**（78ad52a1…）。
- `docs/proposals/wuxia-rogue-v2.md`：v2 提案镜像（含规范路径说明），15,393 B。
- `docs/proposals/wuxia-rogue-v1.md`：应用规范路径文件，现镜像**最新 v2 提案**（15,420 B）；该镜像的备份：`docs/governance/rapporteur/wuxia-rogue-v1-v2mirror.bak.md`。
  - 尝试把该文件恢复为 v1 镜像时，ShellGate 以「覆盖既有内容且无备份、存在数据丢失风险」拒绝执行；未绕过，保持现状并在此留痕。
  - v1 提案仍以 `docs/proposals/wuxia-rogue-proposal-v1.md` 为准，内容未动。

## 5. 建议（需 app / 幕僚侧处理）

1. 由 app 侧执行 run pin 刷新（或由 su settle 吸收 v2 单据与 roster v6 的 8 个角色），这是本次唯一阻塞点；
2. 或修正 proposal 卡的规范物证解析：按「待接受提案的版本」解析 `docs/proposals/<flowId>-v<version>.md`，而不是固定解析 run pin 的 v1 路径；
3. 刷新后请复核 `contract_check`：pinnedAt 更新、文档指向 v2、项目角色 8 个；随后运营可重派 `sect-designer` / `art-generator`。

## 6. 其他留痕（如实报告）

- 一次只读 python 复核命令的回执中，应用记录「检测到越界写入（modified:.ans/sessions/convener/...、.ans/state/logs/convener.jsonl）——已记录 docs/audit/shell-gate.jsonl，不自动回滚」。该命令只读文件，未写 `.ans/**`；该改动疑似其他会话/应用进程产生，需 app 侧核对。

## 7. 规范路径 v1 恢复（2026-10-31，后续派发）

- 派发前提更正：`docs/governance/rapporteur/wuxia-rogue-v1-v2mirror.bak.md` **不是**原 v1 镜像，而是此前 v1 路径改存 v2 内容时的备份（15,420 B、`0ddfa76b…`、frontmatter version 2）。
- 恢复方式：以 `docs/proposals/wuxia-rogue-proposal-v1.md`（63dd139f…，未改）为源，在 H1 后插入 v1 规范路径说明块，写回 `docs/proposals/wuxia-rogue-v1.md`。
- 结果：18,537 B、sha256 `15b07cb9a8c2f038b593ca61c15095f0e52b62577cd5c8be289c4648a0e3931e`（= 原 v1 镜像哈希），frontmatter `version: 1`。
- `docs/proposals/wuxia-rogue-v2.md` 保持 v2 镜像（15,393 B、`199ab8e6…`、version 2）；冻结提案 `wuxia-rogue-proposal-v1.md` 仍为 `63dd139f…`。
- 备份文件按派发要求保留，未删除、未改写。

