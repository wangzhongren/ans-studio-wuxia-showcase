# 质检验收报告 · 江湖夜雨（wuxia-rogue）交付 v2（复验）

> 角色：verifier（内置质检）｜flowId：wuxia-rogue｜复验任务：#t-mvw2xqtp-6ea3656e
> 首验任务：#t-mvw2e15c-914d24b9｜首验报告见同路径历史版本（本文件为 v2 内容，路径沿用规范名）
> 核对对象：`index.html` / `run.cmd` / `styles/` / `assets/` / `src/`（9 模块）/ `tests/`
> 唯一验收基准：`docs/product/wuxia-rogue-intent-v1.md` AC-1 ~ AC-8
> 架构依据：`docs/contracts/wuxia-rogue-architecture-v1.md`（sha256 c7d34062…）
> 环境：Windows 11（win32）、Node v24.22.1；**无桌面浏览器/本地 HTTP 服务能力**
> 复验时间：2026-10-31｜详细版：`docs/quality/wuxia-rogue-acceptance-report-v1.md`
> 交付报告：`docs/scheduling/wuxia-rogue-delivery-report-v2.md`

## 0. 结论

**首验阻断缺陷（AC-8 重开未复位）已修复并经独立复跑确认关闭。**
AC-1 ~ AC-8 的机械可测部分（本机真实运行测试 + 源码结构核对 + 独立探针）**全部通过**；
同 seed 重开可复现（等级、掉落数量与银两掉落序列一致）。
真实浏览器目视手感、满屏清怪观感、真实帧率（F3 ≥45/60 fps）**仍然未能实测**，不得据运营报告直接宣称通过。
是否接受由客户在验收卡上裁决（verifier 不代选、不自批）。

## 1. 实测命令与结果（本次独立复跑）

| 命令 | 结果 |
| --- | --- |
| `node tests/integration-check.js` | **120 passed / 0 failed**（新增重开/同 seed 回归断言） |
| `node tests/smoke-core.js` | **76 passed / 0 failed** |
| `node tests/loop-check.js` | **15 passed / 0 failed** |
| `node tests/background-check.js` | **31 passed / 0 failed** |
| `node tests/perf-check.js` | **52 passed / 0 failed** |
| `node tests/perf-integration-check.js` | **16 passed / 0 failed** |
| `node tests/bench.js` | p50 0.072 / **p95 0.109** / p99 0.152 / max 0.252 ms（预算 6 ms → PASS，仅 Node 纯逻辑基线） |
| `node docs/verification/ac-scan.js` | 23 脚本存在且语法 OK；32 JS 语法全 OK；AC-7 扫描 42 文件；外链/网络 API=0；sidecar=0 |
| `node docs/verification/acceptance-probe.js` | **t1 重开复位通过、t2 完整一局胜利、t3 R 重开复位通过**（见 §3） |

运营报告 v2 的数字（120/76/15/31/52/16、p95≈0.117ms、探针 t1/t2/t3）经质检独立复跑逐项复现；
本次 bench p95 实测 0.109ms，略优于运营报告值。

## 2. AC-1 ~ AC-8 逐条（复验）

判定口径：**机械通过**＝本机真实运行断言/静态结构核对；**未能实测**＝需桌面浏览器目视/手感/真实帧率。

| AC | 判定 | 实测证据 | 未能实测/限制 |
| --- | --- | --- | --- |
| AC-1 地图可移动 | 机械通过 | 世界 3840×2160＞一屏；KeyD 60 帧位移 >100px、相机跟随；clearRect 1280×720；背景/网格/边界随相机绘制不越界；玩家/怪物轴分离碰撞 + margin 钳制 | 走位手感、滚动观感；无岩石障碍实体可「绕」 |
| AC-2 自动攻击 | 机械通过 | 150px 内生成怪无需按键即 damage 并击杀；索敌 170/丢失 220；白闪渲染 + 伤害数字订阅 damage | 剑气/白闪/数字观感 |
| AC-3 击杀掉落 | 机械通过 | monster:killed → LootSystem.count>0，经验珠必掉（银两 35%/疗伤丹 8%）；死亡怪释放归还池 | 掉落物可见的目视 |
| AC-4 拾取生效 | 机械通过 | loot:picked 发出、world.picked 增加、经验增加；直拾 + 磁吸（260 px/s）代码核对 | 磁吸飞行与 HUD 变化观感 |
| AC-5 升级成长 | 机械通过 | addXp→level:up、等级+1、atk↑/atkInterval↓/maxHp↑、HUD 等级与经验文本变化；F3 含攻击/攻速/拾取/磁吸半径 | F3 真实渲染读数 |
| AC-6 后期清怪 | 机械通过（逻辑） | fastForward(330) 目标 220、同屏≥200 且≤300；spawnBurst(1000) 钳制 300；Lv3 回旋(95/18/1.5s)、Lv5 万剑(420/60/12s) 范围伤害走 damage；粒子/数字/震屏/剑雨、FPS<50 持续 2s 降级 | 清屏观感、粒子/震屏实效果、真实帧率 |
| AC-7 非卡牌 | 机械通过 | 42 文件扫描：33 处命中全为「注释声明无卡牌」或 CSS 面板类 `.hud-card`；index.html 与 src/ui 禁词断言=0；UI 仅标题/HUD/结算，升级自动成长无选择弹窗 | 完整一局目视（结构上无卡牌系统） |
| AC-8 可运行与可复现 | **机械通过（含重开复现）** | 完整一局 480s→state=over/outcome=win，结算显示「血月退散/八分钟已到」；结算按 R→playing；ui:restart 后等级=1/经验清零/解锁清空/掉落=0/计数归零；同 seed 重开银两掉落序列一致；300 硬上限不破；Node p95 0.109ms | **真实 FPS≥45（目标 60）与浏览器 p95 未实测** |

## 3. 缺陷关闭核验（首验阻断项）

首验实测（v1）：`progressionLevelAfterRestart=2`、`playerStatsLevelAfterRestart=2`、`lootCountAfterRestart=1`、`progressionLevelAfterR=2`。
本次复跑 `node docs/verification/acceptance-probe.js` 实测：

```json
"t1": { "beforeLevel": 1, "afterLevel": 2,
        "progressionLevelAfterRestart": 1,
        "playerStatsLevelAfterRestart": 1,
        "lootCountAfterRestart": 0,
        "worldRunTimeAfterRestart": 0.0167,
        "unlocksAfterRestart": [] }
"t2": { "stateAfterDuration": "over", "outcome": "win",
        "runTime": 480.0067, "resultTextHasWin": true }
"t3": { "stateAfterR": "playing",
        "progressionLevelAfterR": 1,
        "playerStatsLevelAfterR": 1 }
```

源码核对（只读，不代写）确认修复已落盘：
- `src/loot/progression.js`：新增 `reset(world)`（level=1、xp=0、清空 unlocked、applyGrowth），并挂到 `Progression.reset`；
- `src/loot/pickup.js`：新增 `reset(world)`（清 active/free、计数器归零、syncedLevel=-1），掉落 RNG 以 `((world.seed>>>0)^0x5eed1234)>>>0` 重建，并调用 `Progression.reset`；`LootSystem` 导出 `reset`；
- `src/core/main.js`：拆分 `startRun`（仅 title 态开始）与 `restartRun`（title/playing/over 均强制复位），`ui:restart` 与结算态 `R` 均走 `restartRun`；
- `tests/integration-check.js`：新增重开复位与「同 seed 银两掉落序列一致」断言（120 断言全过）。

**结论：AC-8 重开复位缺陷已关闭，同 seed 可复现经真实运行确认。** 未发现新引入回归（AC-1~AC-7 机械断言全过）。

## 4. 证据自洽（P0 sidecar）

仓库内仍未发现任何 `*.meta.json` sidecar（sidecar 数 = 0）。按任务口径「缺 sidecar 不得当作通过」，本次**未将 P0 证据自洽作为通过依据**；本报告结论全部来自质检本人真实运行输出（证据附件 `docs/verification/wuxia-rogue-acceptance-evidence-v1.md`）。如后续需要 P0 sidecar 归档，应由发起方/工装属主补齐，质检不代造。

## 5. 其他发现（非阻断，与首验一致）

1. `index.html` 共 23 个脚本，架构 §3.2 固定清单为 22 个，多出 `tests/perf.js`（追加在 main.js 之后，前 22 个顺序一致）——已知偏差，不影响 AC，宜以架构 v2 收编。
2. 世界无岩石/障碍实体，「绕岩石/贴崖壁」复现步骤无岩石可绕（边界钳制与轴分离碰撞已具备）。
3. `tests/bench.md` §8 遗留问题（CombatSystem 未实例化、canvas 尺寸未设置）已过时，当前实现已解决；建议属主更新文档。
4. 美术为程序化几何占位、无音效——原型档位允许，不构成缺陷。

## 6. 建议

1. 机械验收层面无阻断项；是否接受交付由客户裁决（验收卡已按要求发起）。
2. 客户在桌面浏览器（Edge/Chrome，`index.html?seed=1234`）完成 AC-1~AC-8 目视/帧率验收；F3 记录 FPS 与 p95；F4 前先玩到 Lv5+ 观察回旋/万剑；重开（R）确认等级/掉落确实清零。
3. 后续以架构 v2 正式收编 `tests/perf.js`，并同步更新 `tests/bench.md` §8。

## 7. 产物

- 规范报告（本文件，v2 复验）：`docs/quality/wuxia-rogue-report-v1.md`
- 详细版：`docs/quality/wuxia-rogue-acceptance-report-v1.md`
- 证据附件：`docs/verification/wuxia-rogue-acceptance-evidence-v1.md`
- 独立扫描：`docs/verification/ac-scan.js`；独立探针：`docs/verification/acceptance-probe.js`
