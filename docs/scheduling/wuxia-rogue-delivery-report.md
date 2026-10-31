# 交付报告 · 江湖夜雨（wuxia-rogue）原型 v1

> 运营（convener）交付汇总。范围：`docs/product/wuxia-rogue-intent-v1.md` AC-1~AC-8；
> 契约：`docs/contracts/wuxia-rogue-architecture-v1.md` v1；名单：`docs/proposals/wuxia-rogue-roster-v5.md`。
> 9 个模块均由对应属主实现，运营仅做派发、核对与联调组织，不代写源码。

## 1. 启动方式

1. 在 Windows 资源管理器中双击项目根 `index.html`（推荐 Edge / Chrome）；
2. 或双击 `run.cmd`（等价 `start "" "%~dp0index.html"`）；
3. 标题界面按 **Enter** 开始；WASD/方向键移动，**Shift** 闪身，**F3** 性能面板，**R** 结算后重开。
4. 复现参数：`index.html?seed=7`（固定随机）、`?timescale=4`（调试加速，1~8）、`?debug=1`。
5. 调试键：F3 性能叠层、F4 快进到 5:30、F5 触发 120 只怪潮（仅调试，不影响正式流程）。
6. 回退路径：若企业策略禁止 `file://`，在项目根运行 `python -m http.server 8000` 后访问 `http://localhost:8000/`（本环境 ShellGate 拒绝启动服务，未实测）。

## 2. 模块与产物

| 模块 | 属主 | 产物 |
| --- | --- | --- |
| env-resources | env-bootstrap | `styles/theme.css`（CSS 变量/HUD/布局）、`assets/` 7 个自绘 SVG + README |
| entry-index | env-bootstrap | `index.html`（23 个 defer 脚本，前 22 个按 §3.2 + `tests/perf.js`）、`run.cmd` |
| core-runtime | core-engine | `src/core/` 9 脚本（CONFIG/Rng/Pool/SpatialHash/Input/Camera/Bus/Loop/main） |
| perf-harness | core-engine | `tests/perf.js`、`bench.js`、`bench.md`、perf-check/perf-integration-check |
| combat-player | combat-player | `src/combat/player.js`、`auto-attack.js`（移动/闪身/索敌/剑气/技能/渲染/heal） |
| monsters-waves | monsters-director | `src/monsters/types.js`、`ai.js`、`director.js` |
| loot-progression | loot-progression | `src/loot/tables.js`、`progression.js`、`pickup.js` |
| visual-fx | presentation-fx | `src/fx/particles.js`、`damage-numbers.js`、`screen-fx.js` |
| hud-ui | presentation-fx | `src/ui/hud.js`、`screens.js` |

## 3. 验证结果（运营本轮实测）

| 测试 | 结果 |
| --- | --- |
| `node tests/integration-check.js`（23 脚本全量加载 + 一局模拟，87 断言） | **87 passed / 0 failed** |
| `node tests/smoke-core.js` | 76 passed / 0 failed |
| `node tests/loop-check.js` | 15 passed / 0 failed |
| `node tests/background-check.js` | 31 passed / 0 failed |
| `node tests/perf-check.js` | 52 passed / 0 failed |
| `node tests/perf-integration-check.js` | 16 passed / 0 failed |
| `node tests/bench.js`（满载 300 怪/200 剑气/150 掉落/600 粒子/64 数字，1000 帧） | p95 = 0.110 ms（预算 6 ms）→ PASS |
| `node --check` 全模块脚本 | 全部 exit 0 |
| `index.html` 23 个 src 引用文件存在性 | missing = [] |

集成自测覆盖：boot 装配 → title→playing → KeyD 移动/相机跟随 → 自动索敌/剑气/damage/monster:killed → 掉落/拾取/loot:picked → 经验/level:up/属性与 HUD 成长 → fastForward(330) 同屏 200+ 且 ≤300 → F3/F5 → AC-7 禁词扫描 → 无未捕获异常。

## 4. AC 复现路径（对应 intent v1）

- **AC-1**：开始后按住 D 8 秒并绕行；背景瓦片/边界随相机滚动，玩家不越出世界钳制。
- **AC-2**：靠近怪物 170px 内不按键；自动发射剑气、`damage` 事件、怪物受击与伤害数字。
- **AC-3**：击杀任意怪；死亡点出现经验珠/银两（/疗伤丹）。
- **AC-4**：走近掉落物；直拾或磁吸，HUD 拾取数/经验/银两变化。
- **AC-5**：连续击杀至升级；等级+1、属性变化，F3 详表可见攻击/攻速/拾取半径。
- **AC-6**：`?seed=7` 开局后按 F4（或等 5 分钟）；同屏 200+，回旋/万剑成片清怪，粒子/数字/震屏可见。
- **AC-7**：完整界面与流程无抽牌/手牌/牌组/构筑/三选一；升级自动成长。
- **AC-8**：同 seed 同操作重开现象一致；F3 显示 FPS（≥45 目标 60）；300 怪硬上限不破。

## 5. 已知限制与说明

1. **未在真实浏览器中做人工目视验收**：本环境无法启动浏览器/本地 HTTP 服务（ShellGate 拒绝），上述结果为 Node 假 DOM 的无头集成验证。AC-1~AC-8 的最终目视与手感验收需由质检/客户在桌面浏览器完成。
2. **契约加载不一致**：§4.2 要求运行时 `WG.perf.*`，但 §3.2 固定脚本清单未含 `tests/perf.js`；已在 `index.html` 末尾（`main.js` 之后）追加该 debug 脚本一行，前 22 个顺序未动。建议后续以架构 v2 正式收编该行。
3. **占位美术**：Canvas 内使用程序化几何图形（玩家/怪物/剑气/掉落/背景），`assets/` 的 SVG 占位素材未全部接入渲染；无音效（意图允许占位级）。
4. **数值平衡**：按提案 §6 实现，未经真人长时试玩调参。
5. **性能结论来自 Node 纯逻辑基线**（p95 0.110 ms）与 F3 面板设施；真实浏览器 300 怪渲染帧率需以 F3 实测为准。
6. `src/monsters/selftest.js` 为临时自测脚本，已按任务要求清理。

## 6. 下一步

- 建议由幕僚调度质检（verifier）发起验收：在桌面浏览器双击 `index.html`，按第 4 节逐条复现 AC-1~AC-8，并核对 F3 帧率。
- 验收发现的问题按模块属主返工；运营不代客户验收、不发验收卡。
