# 验收核对证据附件 · wuxia-rogue v2（复验）

> 角色：verifier｜关联报告：`docs/quality/wuxia-rogue-report-v1.md`（v2）、`docs/quality/wuxia-rogue-acceptance-report-v1.md`
> 性质：**质检本人真实运行的命令与输出摘录**（非验收结论；不是 P0 sidecar 归档）。
> 环境：Windows 11（win32）、Node v24.22.1；无桌面浏览器/GUI/HTTP 服务。
> 时间：2026-10-31｜说明：以下为工具回执中的实际输出摘录，未做加工。

## 1. 复验探针（`node docs/verification/acceptance-probe.js`，exit 0）

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

**解读**：t1 重开后等级=1、掉落=0、解锁清空、计时归零；t2 完整一局胜利并显示结算；t3 结算态按 R 重开后等级=1 → 首验 AC-8 缺陷关闭。探针只读加载 `src/**`，未修改源码。

## 2. 测试复跑（逐条独立执行）

### 2.1 integration-check（120 断言）

命令：`node tests/integration-check.js` → exit 0

```text
integration-check: 23 scripts · fake DOM · boot · one run
  ✓ index.html 含 23 个 defer 脚本
  ✓ 脚本顺序与架构 §3.2 + tests/perf.js 一致
  ✓ 全部 23 个脚本按序加载无异常
  ✓ WG.core / WG.combat / WG.monsters / WG.loot / WG.fx / WG.ui / WG.perf 存在
  ✓ core.boot() 返回 world；boot 后 state=title
  ✓ canvas 后备尺寸 1280×720
  ✓ Enter（ui:start）后 state=playing
  ✓ KeyD 60 帧后玩家 x 增加 > 100px；相机跟随
  ✓ clearRect 1280×720；Camera.apply translate；世界背景/边界绘制
  ✓ 自动攻击产生 damage 事件；怪物被击杀并发出 monster:killed
  ✓ 击杀后 LootSystem.count > 0；存在经验珠掉落
  ✓ 拾取发出 loot:picked；world.picked 增加；经验值增加
  ✓ 发出 level:up；Progression.level 提升；atk 成长、atkInterval 缩短、maxHp 成长
  ✓ HUD #hud-level / #hud-xp 文本变化
  ✓ WG.perf.fastForward(330) 生效；同屏 ≥200 且 ≤300
  ✓ F3 overlay；F5 怪潮不超过 300
  ✓ AC-7：index.html 与 src/ui 无卡牌禁词
  ✓ 对局中 ui:start 不复位 runTime / 等级
  ✓ 重开前等级 ≥ 3；已有解锁技能；可放置掉落；掉落池非空
  ✓ ui:restart 后 state=playing / runTime 归零 / Progression.level=1 / player.stats.level=1
  ✓ ui:restart 后 LootSystem.count()=0 / unlockList() 为空
  ✓ ui:restart 后 world.kills=0 / picked=0 / coins=0 / 怪物清空 / world.rng 重建
  ✓ 同 seed 重开后银两掉落序列一致 / 掉落数量一致 / 仍为 Lv1
  ✓ 结算前可放置掉落 / 等级 ≥ 2
  ✓ 到达 8:00 后 state=over；结算结果 outcome=win
  ✓ 结算态按 R 后 state=playing；R 重开后 Progression.level=1 / player.stats.level=1
  ✓ R 重开后 LootSystem.count()=0 / unlockList() 为空 / world.kills=0 / runTime 从头计时
  ✓ WG.perf.fastForward(330) 生效；Director 目标 ≥200 且 ≤300；MonsterSystem 容量=300
  ✓ F3 打开 perf overlay；F5 怪潮不超过 300；spawnBurst(1000) 后仍≤300
  ✓ 无 console.error；无未捕获异常
integration-check: 120 passed, 0 failed
```

### 2.2 其余测试

```text
node tests/smoke-core.js            → smoke-core: 76 passed, 0 failed
node tests/loop-check.js            → loop-check: 15 passed, 0 failed
node tests/background-check.js      → background-check: 31 passed, 0 failed
node tests/perf-check.js            → perf-check: 52 passed, 0 failed
node tests/perf-integration-check.js→ perf-integration-check: 16 passed, 0 failed
node tests/bench.js                 → sim/frame: p50=0.072 ms  p95=0.109 ms  p99=0.152 ms  max=0.252 ms
                                      total=76.185 ms  busHits=1120
                                      budget: CONFIG.perf.simP95Ms=6 ms → PASS（Node 纯逻辑基线）
```

## 3. 静态扫描（`node docs/verification/ac-scan.js`，exit 0）

```json
{
  "scannedAt": "2026-10-31T07:31:32.394Z",
  "indexHtml": { "scriptCount": 23, "missing": [], "syntaxFail": [] },
  "jsFiles": { "count": 32, "syntaxFail": [] },
  "ac7": { "filesScanned": 42, "cardTermHits": 33,
           "hits": "全部为注释性否定声明（如『无卡牌：升级为自动数值成长』）、测试/文档断言文本，或 CSS 面板类 .hud-card；无功能性卡牌代码/界面" },
  "external": { "count": 0, "items": [] },
  "sidecars": { "count": 0, "files": [] },
  "keyFiles": [
    { "file": "index.html", "exists": true },
    { "file": "run.cmd", "exists": true },
    { "file": "styles/theme.css", "exists": true },
    { "file": "assets/README.md", "exists": true }
  ]
}
```

- 23 个脚本逐个 `node --check`：全部 ok；32 个 JS 全量语法检查：0 失败。
- `external` 无远程脚本/样式/图片，无 fetch/XHR/WebSocket/beacon。
- `.hud-card` 为 `styles/theme.css` 中的普通 HUD 面板类名（非卡牌玩法），`assets/README.md` 亦仅描述该 CSS 类。
- 仓库无 `*.meta.json` sidecar（0 个），本附件不做 sidecar 自洽比对，也不代表 P0 证据归档。

## 4. 缺陷关闭对照

| 指标 | 首验 v1 | 复验 v2 |
| --- | --- | --- |
| `progressionLevelAfterRestart` | 2 | **1** |
| `playerStatsLevelAfterRestart` | 2 | **1** |
| `lootCountAfterRestart` | 1 | **0** |
| `progressionLevelAfterR` | 2 | **1** |
| 同 seed 银两掉落序列 | 未覆盖 | **一致** |
| integration 断言数 | 87 | **120（全过）** |

## 5. 证据边界

- 本附件不是 P0 sidecar 证据归档；仓库当前无任何 `*.meta.json`，故未做（也无法做）sidecar 自洽比对。
- 未在桌面浏览器中运行；AC-1 手感、AC-2/3/4 观感、AC-6 清屏观感、AC-8 真实 FPS/p95 均**未能实测**，报告已如实标注。
- 以上结果均为质检在本机独立复跑所得，未引用运营报告数字作为通过依据。
