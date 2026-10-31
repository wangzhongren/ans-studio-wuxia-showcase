---
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 2
author: rapporteur
createdAt: 2026-10-31
---

# 策划工作记录 · 江湖夜雨（wuxia-rogue）v2（最终交付状态）

## 1. 最终产物（最新版本）

| 产物 | 路径 | 状态 |
| --- | --- | --- |
| 策划方案（project-proposal/v2） | `docs/proposals/wuxia-rogue-proposal-v1.md` | 最新（v1） |
| 模块清单（project-modules/v2） | `docs/proposals/wuxia-rogue-modules-v1.md` | 最新（v1，权威模块快照） |
| 人员名单（project-roster/v3） | `docs/proposals/wuxia-rogue-roster-v5.md` | **最新（v5）** |
| 架构契约（project-architecture/v1） | `docs/contracts/wuxia-rogue-architecture-v1.md` | 最新（v1） |

## 2. 名单版本链（v1→v5 原因）

| 版本 | 结果 | 原因 |
| --- | --- | --- |
| v1 | 非法 | frontmatter `modules` 键重复（文档引用 + 模块数组），YAML 不合法 |
| v2 | 通过 YAML | 文档引用移至 `references.modules` / `modulesDoc`，`modules` 仅作数组 |
| v3 | 校验失败 | 拓扑 `management` 为对象形状，校验要求含 convener 未通过 |
| v4 | 通过拓扑 | `management` 改为「角色 id 列表」（convener + 全部项目角色） |
| v5 | **全部通过** | `modules[]` 按权威模块清单 v1 逐字复制（purpose/publicContract 等一致） |

- 最新名单经 `contract_check` 校验：roster 可用，无结构错误（拓扑/模块/属主/引用均通过）。
- v1–v4 仅作历史，均为只读；下游请以 **roster-v5** 为准。

## 3. 名单结构要点

- 6 角色 / 9 模块；一模块一属主；路径两两不重叠、不嵌套。
- env-bootstrap 未省略：env-resources（category=env，`styles/`、`assets/`）+ entry-index（category=entry，`index.html`、`run.cmd`）。
- 拓扑 `management`：`[convener, env-bootstrap, core-engine, combat-player, monsters-director, loot-progression, presentation-fx]`。
- 拓扑 modules/roles 与 frontmatter 完全一致。

## 4. 已知勘误（方案 v1 §6.4，待下次升版修正）

「所需 XP（累计）」列与 §5.6 公式 `40 + 24(n-1)` 不一致：

| 等级 | v1 表内值 | 按公式正确值 |
| --- | --- | --- |
| Lv5 | 296 | 304 |
| Lv8 | 824 | 784 |
| Lv12 | 2024 | 1760 |

版本化文档落盘后只读，未原地修改；实现以 §5.6 公式为唯一数值源。若客户要求修订，出 proposal-v2 并同步 roster/architecture 版本链（届时 roster 需再升版以更新 proposal 引用）。

## 5. 关键决策与风险

- 技术栈：Canvas 2D + 原生 JS，零依赖双击运行；性能靠对象池/空间哈希/离屏剔除/上限/降级。
- 非卡牌：升级自动成长，无三选一卡面/构筑 UI。
- 待办提醒：架构 v1 的 `roster` 引用仍指向 roster-v1（历史版本）；因架构升版会使 roster-v5 的 `architecture` 引用变旧，故本轮不升架构，留给下一次版本窗口统一对齐。
