---
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 1
author: rapporteur
createdAt: 2026-10-31
---

# 规范物证对齐留痕 · wuxia-rogue（rapporteur）

## 1. 事实核对（只读）

| 项 | 值 |
| --- | --- |
| run | run-20261031-wuxia-rogue-19963999｜state=pinned｜pinnedAt 2026-10-31T06:31:10.163Z |
| run pin · proposal | `docs/proposals/wuxia-rogue-proposal-v1.md`｜sha256 `63dd139f553ff073b441450f8e616569fe76502f2f5cfeca476f10f0e8fe04b3` |
| 验收裁决读取的物证路径 | `docs/proposals/wuxia-rogue-v1.md`（即 `<flowId>-v1.md`）——原不存在 |
| 冻结提案实际哈希（certutil 复核） | `63dd139f553f…`（与 pin 完全一致） |

## 2. 结论与处置

- **结论**：验收链的「规范物证」读取路径为 `docs/proposals/<flowId>-vN.md`；而本 flow 的提案按角色规范命名为 `docs/proposals/<flowId>-proposal-vN.md`，两套命名不一致，导致验收侧读不到物证。属于命名/路径解析对齐问题，已按幕僚派发在版本化纪律内补齐可读物证。
- **处置**：新增 `docs/proposals/wuxia-rogue-v1.md`，作为**同一 v1 提案的规范路径物证**：
  - frontmatter 与冻结提案完全一致：`schema: project-proposal/v2`、`flowId: wuxia-rogue`、`intentId: wuxia-rogue-map`、`version: 1`、`author: rapporteur`、`status: draft`、`intent`/`modules` 引用相同；
  - 正文与冻结提案逐字一致（`fc` 比对：唯一差异是文档开头的「规范路径物证说明」块）；
  - **未新增版本、未改写任何冻结文件**；`wuxia-rogue-proposal-v1.md`、`wuxia-rogue-modules-v1.md`、`wuxia-rogue-roster-v5.md`、`wuxia-rogue-architecture-v1.md` 均未改动。
  - 若两者冲突，以 run pin 的 `wuxia-rogue-proposal-v1.md` 为准（已在说明块中写明）。

## 3. 一致性核对

- `contract_check`：run pin 前后不变（proposal 仍为 `wuxia-rogue-proposal-v1.md`，roster 为 `wuxia-rogue-roster-v5.md`，state=pinned）；无 roster 结构错误。
- 哈希：冻结提案 = `63dd139f553f…`（= pin）；规范物证镜像 = `15b07cb9a8c2f038…`。两者差异**仅来自说明块**（镜像需按派发注明来源）；若验收侧要求与 pin 字节级同哈希，应改由应用侧把规范路径映射到 pin 的提案，而非要求镜像删去说明。
- 内容差异（`fc` 结果）：仅说明块一处；正文其余部分逐字相同（此前发现并已修正一处措辞差异「约 4~5 分钟」→ 与冻结原文一致的「约 4 分钟」）。

## 4. 给验收发起方（verifier）的下一步

1. 物证路径已可读，可重新发起 `cardKind=acceptance` 验收卡；
2. 注意质检报告的**阻断缺陷仍未修复**：重开一局未复位成长/掉落（`Progression.reset`、`LootSystem.reset`），AC-8 仍不通过——该修复属 loot-progression / core-engine 属主，未在本环节处理；
3. 若应用侧仍按 pin 的 sha256 校验物证，请转 app 侧对齐「规范物证路径 → pin 提案」映射，或明确允许镜像不含说明块（届时需以新的对齐方式重出）。

## 5. 边界

- 未修改 `docs/product/**`、`docs/quality/**`、`docs/verification/**`、角色卡与 `.ans/**`；
- 未发验收卡（由质检发起），未替客户或质检做验收结论。
