# 交付报告 · 江湖夜雨（wuxia-rogue）原型 v2（AC-8 返工修复）

> 运营（convener）交付汇总，**取代 v1**（`docs/scheduling/wuxia-rogue-delivery-report.md`）。
> 返工依据：`docs/quality/wuxia-rogue-report-v1.md` §3；验收探针：`docs/verification/acceptance-probe.js`。
> 范围：`docs/product/wuxia-rogue-intent-v1.md` AC-1~AC-8；契约：`docs/contracts/wuxia-rogue-architecture-v1.md` v1。

## 1. 本轮修复（AC-8 阻断缺陷：重开未复位成长与掉落）

| 属主 | 文件 | 改动 |
| --- | --- | --- |
| loot-progression | `src/loot/progression.js` | 新增 `Progression.reset(world)`：level=1、xp=0、清空 unlocked，调用 `applyGrowth()` 写回成长字段；不改 HP/位置、不发事件 |
| loot-progression | `src/loot/pickup.js` | 新增 `LootSystem.reset(world)`：清空 active/free、计数归零、`syncedLevel=-1`，掉落 RNG 以 `((world.seed>>>0)^0x5eed1234)>>>0` 重建（缺省回退固定种子），并调用 `Progression.reset(world)` |
| core-engine | `src/core/main.js` | 拆分 `startRun`（仅 title）与 `restartRun`（title/playing/over 均强制复位）；`ui:restart` 绑定 restartRun；R 键兜底调用 restartRun；`resetOptionalSystems()` 现能实际触发 loot reset |
| core-engine | `tests/integration-check.js` | 新增重开回归断言：ui:restart 后 Progression.level=1、player.stats.level=1、LootSystem.count()=0、unlockList()=[]、kills/picked/coins=0、怪物清空、world.rng 重建、同 seed 掉落序列一致；结算态 R 重开同样断言 |

## 2. 验收探针结果（本轮实测 `node docs/verification/acceptance-probe.js`）

```json
"t1": { "stateAfterStart": "playing", "beforeLevel": 1, "afterLevel": 2,
        "progressionLevelAfterRestart": 1, "playerStatsLevelAfterRestart": 1,
        "lootCountAfterRestart": 0, "unlocksAfterRestart": [] }
"t2": { "stateAfterDuration": "over", "outcome": "win", "resultTextHasWin": true }
"t3": { "stateAfterR": "playing", "progressionLevelAfterR": 1, "playerStatsLevelAfterR": 1 }
"loadErrors": []
```

结论：t1/t3 已从「等级 2、掉落 1」修复为「等级 1、掉落 0、解锁清空」；t2 完整一局仍正常结算。

## 3. 全量回归（本轮实测，全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `node tests/integration-check.js` | **120 passed / 0 failed**（原 87 项全保留，新增 33 项重开/同 seed/ui:start 不复位断言） |
| `node tests/smoke-core.js` | 76 passed / 0 failed |
| `node tests/loop-check.js` | 15 passed / 0 failed |
| `node tests/background-check.js` | 31 passed / 0 failed |
| `node tests/perf-check.js` | 52 passed / 0 failed |
| `node tests/perf-integration-check.js` | 16 passed / 0 failed |
| `node tests/bench.js` | p95 = 0.117 ms（预算 6 ms）PASS |
| `node docs/verification/acceptance-probe.js` | t1/t3 复位正确、t2 正常结算 |

## 4. 启动方式（不变）

- 双击 `index.html` 或 `run.cmd`；Enter 开始；WASD 移动、Shift 闪身、F3 性能面板、R 结算后重开。
- 复现：`index.html?seed=7`、`?timescale=4`、`?debug=1`；F3 性能叠层、F4 快进 5:30、F5 120 只怪潮。

## 5. AC 复现路径（不变，AC-8 已修复）

- AC-1 按住 D 8 秒 + 绕行；AC-2 靠近 170px 不按键；AC-3 击杀看掉落；AC-4 走近拾取看 HUD；
- AC-5 连续击杀升级 + F3 属性；AC-6 `?seed=7` + F4 看 200+ 怪与范围清怪；
- AC-7 全界面无卡牌；**AC-8 同 seed 重开两次：等级/经验/解锁/掉落均复位，现象一致**。

## 6. 剩余限制

1. **真实浏览器目视与 F3 帧率仍未由运营实测**（本环境无浏览器/HTTP 服务能力）；交付验证为 Node 假 DOM 无头集成，需质检/客户在 Edge/Chrome 复验。
2. `index.html` 末尾追加 `tests/perf.js` 一行（§4.2 要求 WG.perf，§3.2 清单未列），建议架构 v2 收编；`tests/bench.md` §8 遗留描述已过时。
3. 世界暂无岩石/障碍实体（AC-1「绕岩石」按边界钳制与轴分离碰撞验证）；美术为程序化几何占位、无音效（原型档位允许）。
4. 性能结论为 Node 纯逻辑基线；真实 300 怪渲染帧率需 F3 实测。

## 7. 下一步

- 请质检复验：`node docs/verification/acceptance-probe.js` + 全量回归，随后由客户在桌面浏览器完成 AC-1~AC-8 目视/帧率验收。
- 运营不发验收卡、不代客户验收。
