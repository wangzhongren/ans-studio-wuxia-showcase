---
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 5
author: rapporteur
createdAt: 2026-10-31
---

# v3 提案与新基线刷新尝试留痕 · wuxia-rogue（rapporteur）

## 1. 依据与核对

- 需求变更 `req-36c38669f1d06b83`：status=approved、changeKind=scope、判断 agent（「替我决策」）代批 decision=approve（默认推荐项）、批准时间 2026-10-31T09:29:57.285Z；**非客户本人点击**（票据位于 `.ans/**`，rapporteur 未读取，依据来自幕僚派发与本意图入口的记载）。
- `docs/intents/wuxia-rogue-map.md` 已按批准范围更新（v2）：S9~S13、新增模块 `sects-progression`/`src/sects/` 与 `art-pipeline`/`tools/art/`、新增角色 `sect-designer`、`art-generator`。
- 对照 v2 单据：范围/模块/角色/验收对应一致，无需修正设计；仅需按流程出 v3 提案并把 run 基线指向 v2 单据集。

## 2. 本轮产出

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `docs/proposals/wuxia-rogue-proposal-v3.md` | 15,533 B | `5f24cb7aeea744d720ee5e70ccd6ae98e17d05f674c5c0a88143334591af4ecb` |
| `docs/proposals/wuxia-rogue-v3.md`（规范路径镜像） | 16,001 B | `3db40c424f4aed27060b7a16abd4af17394b7940d7b2e39df29a30d4348b7f6c` |
| `docs/proposals/wuxia-rogue-v1.md`（恢复后 v1 镜像） | 18,537 B | `15b07cb9a8c2f038b593ca61c15095f0e52b62577cd5c8be289c4648a0e3931e` |
| `docs/proposals/wuxia-rogue-v2.md`（v2 镜像，未动） | 15,393 B | `199ab8e6f31b4f309586cca2d2bd6019943941fc11255b059f3517072a5c254d` |
| `docs/proposals/wuxia-rogue-proposal-v1.md`（冻结，未动） | 18,034 B | `63dd139f553ff073b441450f8e616569fe76502f2f5cfeca476f10f0e8fe04b3` |

- v3 frontmatter：`flowId=wuxia-rogue`、`intentId=wuxia-rogue-map`、`version: 3`、`intent=docs/product/wuxia-rogue-intent-v2.md`、`modules=wuxia-rogue-modules-v2.md`、`roster=wuxia-rogue-roster-v6.md`、`architecture=docs/contracts/wuxia-rogue-architecture-v2.md`；正文继承 v2 设计，新增「v3 修订说明」注明依据。
- 生成脚本（受治理写入留痕）：`docs/governance/rapporteur/make-proposal-v3.py`、`restore-v1-canonical.py`、`make-v1-canonical-identical.py`。

## 3. 提案卡尝试（上限 2 次）

均使用 `request_choice(cardKind=proposal, flowId=wuxia-rogue, intentId=wuxia-rogue-map, taskId=t-mvw7ahmf-33c05aca)`，预览中携带批准票据信息与 v2 单据集/角色/属主，并声明「接受后刷新 run 基线」。

| 次数 | 卡片前的物证文件状态 | 回执原文（核心） |
| --- | --- | --- |
| 1 | `wuxia-rogue-v1.md` = v1 镜像（含说明块，18,537 B / `15b07cb9…`）；`wuxia-rogue-v3.md` 就位 | `自动决策未通过/未完成：规范物证缺失（规范物证缺失：docs/proposals/wuxia-rogue-v1.md（判断无法核对））`；注明「这不是客户拒绝」 |
| 2 | `wuxia-rogue-v1.md` = 与 run pin 提案**逐字节相同**（18,034 B / `63dd139f…`）；`wuxia-rogue-v3.md` 就位 | 回执与第 1 次**逐字相同**，仍指向 `docs/proposals/wuxia-rogue-v1.md` |

**结论**：错误与物证文件内容/哈希无关（含说明块镜像与逐字节相同两种状态均同回执），是应用侧 pin/证据解析问题；run pin 仍为 v1 单据集、角色仍 6 个。rapporteur 无工具直接改写 run pin，需 app/su 侧刷新或修正 proposal 卡的规范物证解析。

## 4. 收尾状态

- `docs/proposals/wuxia-rogue-v1.md` 已恢复为 v1 镜像（`15b07cb9…`，含说明块），与上一任务完成标准一致。
- 备份 `docs/governance/rapporteur/wuxia-rogue-v1-v2mirror.bak.md`（15,420 B / `0ddfa76b…`，v2 镜像）保留未动。
- 未修改 v1/v2 冻结提案；未发验收卡；未尝试改门禁或绕过。
- 审计提示：以脚本生成 `docs/proposals/wuxia-rogue-proposal-v3.md` 时，应用记录「越界写入（added:docs/proposals/wuxia-rogue-proposal-v3.md）——已记录 docs/audit/shell-gate.jsonl，不自动回滚」。该文件位于 rapporteur 写区 `docs/proposals/`，内容为正常提案；如需，可用受治理写工具重写以消除标记，请 app 侧核对。
