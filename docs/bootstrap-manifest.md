# Bootstrap 留痕（创世 finalize）

> 本文件由**代码**在 su 的治理会话 settle **之后**生成（su 不会算 hash，故 pin 只能事后算）。
> **pin 每轮 su settle 后自动刷新**（§13.3）：本文件钉的是「**本轮结束时的边界面**」——
> 对**外部**（非经 su 会话）的边界改动，**下一次 su settle 会吸收进 pin**（tamper 检测窗口 = 到下次 settle 为止）。

- 生成时间：2026-10-31T13:22:02.128Z
- 目标项目：C:/Users/51054/Downloads/gamestore/wuxia
- 授权来源：desktop-app:操作者导入空文件夹并开启 chief 对话 = 发起 bootstrap（有界创世授权：仅治理产物 角色卡//docs//.ans/）
- 角色（8）：art-generator、combat-player、core-engine、env-bootstrap、loot-progression、monsters-director、presentation-fx、sect-designer

## Pin 的边界文件（SHA-256）

| 路径 | SHA-256 |
| --- | --- |
| 角色卡/governance-boundary.yaml | a19ee561cac958c29ae4c1b4b8001f57303e17f48a83ab780bc87dde7f6fce93 |
| 角色卡/art-generator/boundary.yaml | febd7e5c71819057fd794d5362034e418c4d3b7cf2e099f5c6daff9b9874175c |
| 角色卡/combat-player/boundary.yaml | 55e15a278ecfe64eca31f81d1e12368fe18cbdafe22dd4563cdbf7035c72ca51 |
| 角色卡/core-engine/boundary.yaml | 9072bff4805c82e2831432839e9e195dd7f310da5c14eb41599dfdb9bf44d2b4 |
| 角色卡/env-bootstrap/boundary.yaml | e836f18940fa048104ef1885efa513b06718e0f83e2eecbe7ec5a115acd712f6 |
| 角色卡/loot-progression/boundary.yaml | 83971a9a3989f05b69486593ad8b9b4ee8ec7cbd7bb8c7efff41b825e3471de9 |
| 角色卡/monsters-director/boundary.yaml | 5e53db4798be5b120e0f2fa987dba27f30beaf9e7b48c59a7d081686227c7b0f |
| 角色卡/presentation-fx/boundary.yaml | f34de318a2a2b437c54e06fbb47a2c1b7cc378ea3aef484e4c3da735c0250c96 |
| 角色卡/sect-designer/boundary.yaml | 29b41f15250ba97647c805e776a3e0a6e9960fa3c1e2ac3dc34700202f409ec6 |

## 实际创建路径（逐条留痕）

- 角色卡/art-generator/工作文档.md
- 角色卡/art-generator/boundary.yaml
- 角色卡/art-generator/role-card.md
- 角色卡/combat-player/工作文档.md
- 角色卡/combat-player/boundary.yaml
- 角色卡/combat-player/role-card.md
- 角色卡/core-engine/工作文档.md
- 角色卡/core-engine/boundary.yaml
- 角色卡/core-engine/role-card.md
- 角色卡/env-bootstrap/工作文档.md
- 角色卡/env-bootstrap/boundary.yaml
- 角色卡/env-bootstrap/role-card.md
- 角色卡/governance-boundary.yaml
- 角色卡/loot-progression/工作文档.md
- 角色卡/loot-progression/boundary.yaml
- 角色卡/loot-progression/role-card.md
- 角色卡/monsters-director/工作文档.md
- 角色卡/monsters-director/boundary.yaml
- 角色卡/monsters-director/role-card.md
- 角色卡/presentation-fx/工作文档.md
- 角色卡/presentation-fx/boundary.yaml
- 角色卡/presentation-fx/role-card.md
- 角色卡/sect-designer/工作文档.md
- 角色卡/sect-designer/boundary.yaml
- 角色卡/sect-designer/role-card.md
- docs/audit/shell-gate.jsonl
- docs/contracts/wuxia-rogue-architecture-v1.md
- docs/contracts/wuxia-rogue-architecture-v2.md
- docs/contracts/wuxia-rogue-v2-architecture-v1.md
- docs/governance/rapporteur/check-v2.py
- docs/governance/rapporteur/check-v2flow.py
- docs/governance/rapporteur/make-proposal-v3.py
- docs/governance/rapporteur/make-v1-canonical-identical.py
- docs/governance/rapporteur/restore-v1-canonical.py
- docs/governance/rapporteur/wuxia-rogue-canonical-evidence-v1.md
- docs/governance/rapporteur/wuxia-rogue-notes-v1.md
- docs/governance/rapporteur/wuxia-rogue-notes-v2.md
- docs/governance/rapporteur/wuxia-rogue-notes-v3.md
- docs/governance/rapporteur/wuxia-rogue-notes-v4.md
- docs/governance/rapporteur/wuxia-rogue-notes-v5.md
- docs/governance/rapporteur/wuxia-rogue-notes-v6.md
- docs/governance/rapporteur/wuxia-rogue-v1-v2mirror.bak.md
- docs/governance/rapporteur/wuxia-rogue-v2-notes-v1.md
- docs/governance/verifier/wuxia-rogue-acceptance-attempts-v1.md
- docs/governance/verifier/wuxia-rogue-v2-acceptance-attempt-v1.md
- docs/intents/wuxia-rogue-map-v2.md
- docs/intents/wuxia-rogue-map.md
- docs/product/wuxia-rogue-intent-v1.md
- docs/product/wuxia-rogue-intent-v2.md
- docs/product/wuxia-rogue-v2-intent-v1.md
- docs/proposals/wuxia-rogue-modules-v1.md
- docs/proposals/wuxia-rogue-modules-v2.md
- docs/proposals/wuxia-rogue-proposal-v1.md
- docs/proposals/wuxia-rogue-proposal-v2.md
- docs/proposals/wuxia-rogue-proposal-v3.md
- docs/proposals/wuxia-rogue-roster-v1.md
- docs/proposals/wuxia-rogue-roster-v2.md
- docs/proposals/wuxia-rogue-roster-v3.md
- docs/proposals/wuxia-rogue-roster-v4.md
- docs/proposals/wuxia-rogue-roster-v5.md
- docs/proposals/wuxia-rogue-roster-v6.md
- docs/proposals/wuxia-rogue-v1.md
- docs/proposals/wuxia-rogue-v2-modules-v1.md
- docs/proposals/wuxia-rogue-v2-proposal-v1.md
- docs/proposals/wuxia-rogue-v2-roster-v1.md
- docs/proposals/wuxia-rogue-v2.md
- docs/proposals/wuxia-rogue-v3.md
- docs/quality/wuxia-rogue-acceptance-report-v1.md
- docs/quality/wuxia-rogue-report-v1.md
- docs/quality/wuxia-rogue-v2-report-v1.md
- docs/scheduling/wuxia-rogue-delivery-plan.md
- docs/scheduling/wuxia-rogue-delivery-report-v2.md
- docs/scheduling/wuxia-rogue-delivery-report.md
- docs/scheduling/wuxia-rogue-v2-art-fix-report-v1.md
- docs/scheduling/wuxia-rogue-v2-art-render-bridge-v1.md
- docs/scheduling/wuxia-rogue-v2-delivery-plan-v1.md
- docs/scheduling/wuxia-rogue-v2-delivery-plan.md
- docs/scheduling/wuxia-rogue-v2-delivery-report-v1.md
- docs/scheduling/wuxia-rogue-v2-feedback2-verify-v1.md
- docs/scheduling/wuxia-rogue-v2-motion-plan-v1.md
- docs/verification/ac-scan.js
- docs/verification/acceptance-probe.js
- docs/verification/wuxia-rogue-acceptance-evidence-v1.md
- docs/verification/wuxia-rogue-v2-final-check.py
- .ans/project.json（本 finalize 写出）
- docs/bootstrap-manifest.md（本 finalize 写出）
