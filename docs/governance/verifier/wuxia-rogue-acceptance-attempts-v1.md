# 验收卡发起留痕 · wuxia-rogue（verifier）

- 角色：verifier｜flowId：wuxia-rogue
- 任务：首验 t-mvw2e15c-914d24b9；复验 t-mvw2xqtp-6ea3656e
- 时间：2026-10-31

## 尝试记录

### 第 1 次（首验，cardKind=acceptance）
- 结果：`自动决策未通过/未完成`
- 原因：`治理事实不可读（验收最小链事实缺失：质检报告）`
- 处置：按约定路径补写 `docs/quality/wuxia-rogue-report-v1.md`（另保留详细版 `wuxia-rogue-acceptance-report-v1.md`）。

### 第 2 次（补报告后重发，cardKind=acceptance）
- 结果：`自动决策未通过/未完成`
- 原因：`规范物证缺失（物证不可读：docs/proposals/wuxia-rogue-v1.md）`
- 核对：当时 `docs/proposals/wuxia-rogue-v1.md` 不存在；`contract_check` 的 run pin proposal 为 `docs/proposals/wuxia-rogue-proposal-v1.md`（sha256 63dd139f…）。
- 边界：verifier 禁写 `docs/proposals/**`，且不应伪造/复制提案文档；无法自行修复该物证路径。
- 应用回执说明：这不是客户拒绝；应用会将退回交 运营/Steward（Convener）组织返工。

### 第 2 次之后的返工（发起方处理）
- 运营方补充了规范路径镜像 `docs/proposals/wuxia-rogue-v1.md`（内容与 pin 的 `wuxia-rogue-proposal-v1.md` 一致，含「规范路径物证说明」），pin 未变；
- 交付方修复 AC-8 重开复位缺陷（`Progression.reset` / `LootSystem.reset` / main `restartRun`），交付报告升级为 `docs/scheduling/wuxia-rogue-delivery-report-v2.md`。

### 第 3 次（复验后重发，cardKind=acceptance）
- 复验结论：首验阻断缺陷已关闭；AC-1~AC-8 机械可测部分全过；浏览器目视/真实帧率未能实测。
- 结果：**卡片已发出**，客户侧「替我决策」开启，判断 agent 代批选择 `accept`（接受交付）；回执明确「不是客户本人点击」。
- 代批说明：本次裁决为 **judge 代批**（operator:judge:claude），非客户本人点击；D3 裁决 id：`decision-req-e3145e79b0b150d9`。
- verifier 立场：仅报告实测事实与未实测边界，未自批、未代选。

## 复验后的状态

- 规范物证路径已存在：`docs/proposals/wuxia-rogue-v1.md`（发起方补充，verifier 未写入）。
- 规范质检报告已更新：`docs/quality/wuxia-rogue-report-v1.md`（v2 复验内容）。
- 证据附件已更新：`docs/verification/wuxia-rogue-acceptance-evidence-v1.md`。
- 复验实测：integration 120 / smoke 76 / loop 15 / background 31 / perf 52 / perf-integration 16，全部 0 failed；bench p95 0.109ms；探针 t1/t2/t3 复位与胜利均通过。

## 相关产物

- `docs/quality/wuxia-rogue-report-v1.md`（规范报告，v2）
- `docs/quality/wuxia-rogue-acceptance-report-v1.md`（详细版，v2）
- `docs/verification/wuxia-rogue-acceptance-evidence-v1.md`（证据附件，v2）
- `docs/verification/ac-scan.js`、`docs/verification/acceptance-probe.js`
