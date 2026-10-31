---
flowId: wuxia-rogue
intentId: wuxia-rogue-map
version: 1
author: rapporteur
createdAt: 2026-10-31
---

# 策划工作记录 · 江湖夜雨（wuxia-rogue）v1

## 1. 本轮产出

| 产物 | 路径 |
| --- | --- |
| 策划方案（project-proposal/v2） | `docs/proposals/wuxia-rogue-proposal-v1.md` |
| 模块清单（project-modules/v2） | `docs/proposals/wuxia-rogue-modules-v1.md` |
| 人员名单（project-roster/v3） | `docs/proposals/wuxia-rogue-roster-v1.md` |
| 架构契约（project-architecture/v1） | `docs/contracts/wuxia-rogue-architecture-v1.md` |

以上均引用 `docs/product/wuxia-rogue-intent-v1.md`（intentId=`wuxia-rogue-map`）。

## 2. 关键决策

1. **技术选型**：HTML5 Canvas 2D + 原生 JavaScript，零依赖、无构建、`file://` 双击可运行；Phaser 需 vendor 库、pygame 需 Python 环境，均被否。
2. **非卡牌**：升级采用自动数值成长，不设三选一卡面/构筑界面，从机制与 UI 双重排除卡牌。
3. **人员**：6 角色 / 9 模块（env-bootstrap 必带 env-resources + entry-index；core-engine 兼性能工装；presentation-fx 兼特效与 HUD）。
4. **可复现**：种子随机 + `?seed=` + `?timescale=` + F3/F4/F5 调试钩子，支撑 AC-6/AC-8。

## 3. 已知勘误（待下一次升版修正）

方案 v1 §6.4「升级」表中「所需 XP（累计）」列与 §5.6 公式 `40 + 24(n-1)` 存在偏差：

| 等级 | v1 表内值 | 按公式正确值 |
| --- | --- | --- |
| Lv5 | 296 | 304 |
| Lv8 | 824 | 784 |
| Lv12 | 2024 | 1760 |

原因：v1 写入后发现累计列手工计算不一致；版本化文档落盘后只读，未原地修改。
处置建议：下次修订（客户反馈后的 proposal-v2 / roster-v2 / architecture-v2）按正确值更新，并保持四份文档版本链一致；实现以 §5.6 公式为唯一数值源。

## 4. 风险

- 同屏 300 怪 + 特效掉帧 → 已用对象池/空间哈希/离屏剔除/自动降级 + F3 与 `tests/` 基准兜底。
- `file://` 受企业策略限制 → 备选 `python -m http.server`，需写入 README。
- 数值节奏（5 分钟清屏）需实机调参 → 已提供 timescale 与跳时钩子。

## 5. 边界声明

未写角色卡（人事环节负责）、未改 `docs/product/**`、未引入卡牌机制。
