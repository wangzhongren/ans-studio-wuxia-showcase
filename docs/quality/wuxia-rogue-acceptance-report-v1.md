# 质检验收详细报告 · 江湖夜雨（wuxia-rogue）v2（复验）

> 角色：verifier（内置质检）｜flowId：wuxia-rogue｜复验任务：#t-mvw2xqtp-6ea3656e
> 首验任务：#t-mvw2e15c-914d24b9｜规范报告：`docs/quality/wuxia-rogue-report-v1.md`（v2 内容）
> 唯一验收基准：`docs/product/wuxia-rogue-intent-v1.md` AC-1 ~ AC-8
> 架构依据：`docs/contracts/wuxia-rogue-architecture-v1.md`
> 交付报告：`docs/scheduling/wuxia-rogue-delivery-report-v2.md`
> 环境：Windows 11（win32）、Node v24.22.1；无桌面浏览器/GUI/本地 HTTP 服务
> 复验时间：2026-10-31

## 1. 复验范围与方法

本轮针对运营返工报告声称的修复做**独立复验**，不接受「据运营报告」作为通过依据：

1. 源码只读核对：`src/loot/progression.js`、`src/loot/pickup.js`、`src/core/main.js`、`tests/integration-check.js`；
2. 独立复跑探针与全部回归命令（见 §2）；
3. 核对 AC-8 重开复位、同 seed 可复现、完整一局胜利、R 重开；
4. 复核 AC-1~AC-7 无回归；AC-7 结构与静态扫描；
5. 如实标注无法在无浏览器环境实测的目视/真实帧率项。

## 2. 实测命令与输出

### 2.1 探针 `node docs/verification/acceptance-probe.js`（exit 0）

```json
{
  "loadErrors": [],
  "t1": {
    "stateAfterStart": "playing",
    "beforeLevel": 1,
    "afterLevel": 2,
    "playerStatsLevelAfterLevelUp": 2,
    "lootBeforeRestart": 1,
    "progressionLevelAfterRestart": 1,
    "playerStatsLevelAfterRestart": 1,
    "lootCountAfterRestart": 0,
    "worldRunTimeAfterRestart": 0.016666666666666666,
    "unlocksAfterRestart": []
  },
  "t2": {
    "stateAfterDuration": "over",
    "outcome": "win",
    "runTime": 480.00666666666666,
    "kills": 0,
    "resultTextHasWin": true,
    "resultTextSample": "血月退散八分钟已到，你活了下来存活时间08:00等级1击杀0拾取0银两0最终攻击12按 R 重开"
  },
  "t3": {
    "stateAfterR": "playing",
    "progressionLevelAfterR": 1,
    "playerStatsLevelAfterR": 1
  }
}
```

解读：
- t1：升到 Lv2 并放 1 个掉落 → `ui:restart` 后 `Progression.level=1`、`player.stats.level=1`、`LootSystem.count()=0`、`unlocks=[]`、`runTime` 从头计时 → **重开复位成立**；
- t2：8:00 存活判定胜利，结算文本含「血月退散/八分钟已到」→ **完整一局可结算**；
- t3：结算态按 R → `playing` 且等级=1 → **结算后重开复位成立**。

### 2.2 回归命令（全部独立执行，exit 0）

| 命令 | 结果 |
| --- | --- |
| `node tests/integration-check.js` | 120 passed / 0 failed |
| `node tests/smoke-core.js` | 76 passed / 0 failed |
| `node tests/loop-check.js` | 15 passed / 0 failed |
| `node tests/background-check.js` | 31 passed / 0 failed |
| `node tests/perf-check.js` | 52 passed / 0 failed |
| `node tests/perf-integration-check.js` | 16 passed / 0 failed |
| `node tests/bench.js` | p50 0.072 / p95 0.109 / p99 0.152 / max 0.252 ms（预算 6 ms → PASS） |
| `node docs/verification/ac-scan.js` | 23 脚本/32 JS 语法 OK；AC-7 42 文件扫描；外链 0；sidecar 0 |

integration-check 新增的关键断言（已验证真实比较，而非空断言）：
- `ui:restart 后 Progression.level=1`、`player.stats.level=1`、`LootSystem.count()=0`、`unlockList()=0`、`world.kills/picked/coins=0`、怪物清空、`world.rng` 重建；
- 「同 seed 重开后银两掉落序列一致」（`sampleSilver` 采样 2400 次比较序列字符串）与「掉落数量一致」；
- 「对局中 `ui:start` 不复位」——区分开始与重开语义。

### 2.3 AC-7 静态扫描要点

- 扫描 42 个文件，33 处卡牌术语命中，经逐条核对**全部为**：
  - 源码注释中「无卡牌/无抽牌/无手牌」等**否定性声明**；
  - `styles/theme.css` 与 `assets/README.md` 中的 HUD 面板类名 `.hud-card`（普通面板样式，非玩法卡牌）；
  - 测试与文档中的 AC-7 断言文本。
- `integration-check` 对 `index.html` 与 `src/ui` 的卡牌禁词断言为 0 命中；UI 结构仅标题/HUD/结算，升级为自动数值成长，无任何选择弹窗/卡面。
- 无远程脚本/样式/图片，无 fetch/XHR/WebSocket/beacon。

## 3. AC-1 ~ AC-8 复验判定

| AC | 判定 | 关键证据 | 未能实测 |
| --- | --- | --- | --- |
| AC-1 | 机械通过 | KeyD 位移>100px、相机跟随、1280×720 视口、背景/边界随相机、轴分离碰撞 + margin | 手感/滚动观感；无岩石可绕 |
| AC-2 | 机械通过 | 150px 内自动 damage→击杀；索敌/丢失半径；白闪与伤害数字 | 观感 |
| AC-3 | 机械通过 | monster:killed→掉落池非空、经验珠必掉、死亡怪还池 | 目视 |
| AC-4 | 机械通过 | loot:picked、picked 计数、经验增加、磁吸速度代码核对 | 磁吸/HUD 观感 |
| AC-5 | 机械通过 | level:up、atk↑/atkInterval↓/maxHp↑、HUD 文本变化、F3 字段 | F3 真实读数 |
| AC-6 | 机械通过（逻辑） | fastForward(330) 同屏 200~220 且≤300、spawnBurst 钳制 300、范围技能与降级逻辑 | 清屏/粒子/震屏观感、真实帧率 |
| AC-7 | 机械通过 | 42 文件扫描无功能性卡牌；index.html/src/ui 禁词 0；无选择界面 | 完整一局目视 |
| AC-8 | 机械通过 | 探针 t1/t2/t3 + integration 120 断言 + bench p95 0.109ms | 真实 FPS≥45（目标 60）、浏览器 p95 |

## 4. 首验缺陷与关闭记录

| 项 | 首验（v1） | 复验（v2） |
| --- | --- | --- |
| `progressionLevelAfterRestart` | 2（不通过） | **1（通过）** |
| `playerStatsLevelAfterRestart` | 2（不通过） | **1（通过）** |
| `lootCountAfterRestart` | 1（不通过） | **0（通过）** |
| `progressionLevelAfterR` | 2（不通过） | **1（通过）** |
| 同 seed 重开掉落序列 | 未覆盖 | **一致（通过）** |

修复落盘核对（只读）：
- `src/loot/progression.js`：`reset(world)` → level=1、xp=0、清空 unlocked、applyGrowth；导出 `Progression.reset`；
- `src/loot/pickup.js`：`reset(world)` → 清 active/free、计数器归零、syncedLevel=-1、`resetRng(world)`（`((world.seed>>>0)^0x5eed1234)>>>0`）、调用 `Progression.reset`；导出 `LootSystem.reset`；
- `src/core/main.js`：`resetRunState()` + `startRun()`（仅 title）/ `restartRun()`（title/playing/over 强制复位）；`ui:restart`→restartRun；结算态 R→restartRun；
- `tests/integration-check.js`：新增上述重开/同 seed 回归断言。

## 5. 证据自洽

仓库无 `*.meta.json` sidecar（0 个），无法做 P0 sidecar 自洽比对。本次结论不依赖 sidecar 自洽，全部来自质检本人真实运行输出；证据附件为 `docs/verification/wuxia-rogue-acceptance-evidence-v1.md`。质检不代造 sidecar。

## 6. 非阻断发现

1. 脚本数 23 vs 架构 §3.2 的 22（多 `tests/perf.js`，前 22 顺序一致）——已知偏差，宜架构 v2 收编。
2. 无岩石/障碍实体，复现步骤中「绕岩石」无对象；碰撞/边界钳制已具备。
3. `tests/bench.md` §8 遗留问题已过时，建议属主更新。
4. 程序化占位美术、无音效——原型允许。

## 7. 结论与建议

- **机械层面无阻断项**：首验缺陷已关闭，AC-1~AC-8 机械可测部分全部通过，无回归。
- **未能实测项**：真实浏览器目视手感/观感、真实帧率（F3 ≥45/60fps）、浏览器内 p95；这些不是代码缺陷证据，但也不得据运营报告宣称通过。
- 是否接受交付由客户在验收卡上裁决；建议客户按 §2.2 的浏览器步骤自行目视与帧率验收。
