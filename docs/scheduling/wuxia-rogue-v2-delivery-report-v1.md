# 交付报告 · 江湖夜雨（wuxia-rogue）v2 流程线

> 运营（convener）交付汇总。**不是验收结论**：AC-1~AC-13 的最终判定由客户/判断 agent 在验收卡上作出，或由质检复验后提交；本报告只如实记录「做了什么、实测结果、未完成项与证据」。
> 依据（按序）：`docs/contracts/wuxia-rogue-v2-architecture-v1.md`（冻结，sha256 `d4bec46b8d05157563b1da2bc2462c8a3a86d2fe5ebfe9e1519e49656715c152`）、`docs/proposals/wuxia-rogue-v2-proposal-v1.md`、`docs/proposals/wuxia-rogue-v2-modules-v1.md`、`docs/proposals/wuxia-rogue-v2-roster-v1.md`；组织计划见 `docs/scheduling/wuxia-rogue-v2-delivery-plan-v1.md`。
> 基线：新流程线 `wuxia-rogue-v2`（intent `wuxia-rogue-map-v2`，run `run-20261031-wuxia-rogue-v2-91a1b83a`，pin 于 2026-10-31T09:55:23Z，8 角色）；旧线 `wuxia-rogue` v2 报告为 `docs/scheduling/wuxia-rogue-delivery-report-v2.md`，与本报告无关。

## 1. 交付产物（11 模块 / 8 角色，均已落盘）

| moduleId | 路径 | 属主 | 交付内容 |
| --- | --- | --- | --- |
| core-runtime | `src/core/`（9 文件） | core-engine | `Loop`、组合根 `main.js`：状态机 `title→sect→playing⇄choice→result`、事件接线、新局复位、8:00 结算、`scoreOf` 兜底 |
| perf-harness | `tests/` | core-engine | v2 无头集成 `integration-check.js`（26 src + `tests/perf.js`、15 阶段）、`bench.js`、`loop-check.js`、`smoke-core.js` 等 |
| sects-progression | `src/sects/`（defs/upgrades/selection + 离线自检） | sect-designer | 三门派 DEFS、8 通用 + 2 专属升级池、绝学保底 Lv3/5/8、`selectSect/choose/reset`，成长唯一写入点 |
| hud-ui | `src/ui/`（hud/screens/overlays） | presentation-fx | `ScreenFlow`（title/sect/playing/result）、`Overlays`（门派卷轴/三选一石碑）、`score` 纯函数、HUD 门派与等级/经验 |
| visual-fx | `src/fx/` | presentation-fx | `choice:pick` 回旋/裂空/万剑特效；素材缺失回退 |
| combat-player | `src/combat/` | combat-player | v2 stats 扩展、暴击/减伤/`regen`、`choice:pick` 联动、重开复位 |
| loot-progression | `src/loot/` | loot-progression | `level:up {level}` 单事件、删除 `applyGrowth`/`ability:unlock`、`syncPlayerStats` 同步等级经验 |
| monsters-waves | `src/monsters/` | monsters-director | 只随 `level:up` 难度，无改动（核对通过） |
| env-resources | `styles/theme.css`、`assets/` | env-bootstrap | `scroll-panel`/`stele-option` 主题、`assets/generated/SOURCES.md` 接入位与 14 项占位清单 |
| entry-index | `index.html`、`run.cmd` | env-bootstrap | 27 个 defer 脚本（26 契约脚本 + `tests/perf.js`），顺序与 §3.2 一致；sha256 `a6804b0a59e5b12073a1f9227b8d823547c701f361007399277a9fc6b7c53692` |
| art-pipeline | `tools/art/` | art-generator | 14 个 prompt、`generate.py`/`verify.py`/`install_deps.ps1`、`MANIFEST.json` 逐项记录（当前 14/14 failed，见 §5） |

## 2. 实现要点（与契约对齐）

- **状态机与暂停**：`title→sect→playing`；`choice:offer` → `Loop.pause()`，`choice:pick` → `Loop.resume()`；选门前不跑 update；死亡或 8:00 → `run:result`。
- **门派**：剑宗 10/0.42/100/230（每 3 级 +5% 攻速，间隔下限 0.18）、刀门 18/0.70/110/215（暴击 0.10×1.6）、医谷 9/0.60/140/205（回血 1.5、减伤 0.05）。
- **升级三选一**：每级 1 个门派专属 + 2 个通用、不重复、满层排除、绝学首位保底 Lv3/5/8、种子 RNG 可复现；选择立即生效、不跨局留存、无卡牌元素。
- **成长唯一写入**：`WG.sects.Selection` 的 `recompute()` 基于 DEFS + CONFIG 基准重算并写 `player.stats`；额外以加法字段 `pierce`/`projectileSpeed`/`potionDropMult`/`potionHealBonus` 覆盖方案效果（契约 §4.3 未列，属已知扩展）。
- **selectSect 幂等（最终态）**：仅 `changed`（首次/切换门派）应用 init、同步 `player.maxHp/hp` 并发 `sect:selected`；同门派重复确认不发事件、不重算、不回满、不清成长；同门派重开由 UI 发 `ui:restart` 触发 `main.beginRun`（`src/ui/screens.js:663`、结算 R 重开 `:853`）。
- **评分**：`kills×2 + picks + level×100 + silver×2 + 秒×0.5`；S≥2000/A≥1500/B≥900/C；结算页与 `runStats` 同一对象直出。
- **素材隔离**：运行时只读 `assets/generated/*` 与 `assets/placeholder-*.svg`；不引用 `tools/art/`、不联网、零运行时依赖；加载失败 `onerror` 回退。

## 3. 本报告实测回归（全部本轮复跑，exit 0）

| 命令 | 结果 |
| --- | --- |
| `node tests/integration-check.js --failures` | **489 passed / 0 failed**（15 阶段：命名空间、开局选门、三门派数值、移动背景、自动攻击击杀、掉落拾取、升级三选一、win/dead 结算、重开复位、重置 API、F3/F4/F5、AC-7 静态扫描、错误检查） |
| `node src/sects/self-check.js` | **137 passed / 0 failed**（含同门派幂等/事件门控、绝学保底、满层排除、连续升级排队、静态口径） |
| `node tests/smoke-core.js` | 76 passed / 0 failed |
| `node tests/loop-check.js` | 15 passed / 0 failed |
| `node tests/background-check.js` | 31 passed / 0 failed |
| `node tests/perf-check.js` | 52 passed / 0 failed |
| `node tests/perf-integration-check.js` | 16 passed / 0 failed |
| `node tests/bench.js` | p95 **0.109 ms**（预算 6 ms）PASS（仅 Node 回归基线，不代表浏览器帧率） |
| `node --check` 各改动文件 | 全绿（sects/selection、ui/screens 等） |

## 4. 缺陷与返工记录（均由运营先复核证据再派返工，未代替验收）

1. **经验/等级不同步**：`Progression.xp` 与 `player.stats.xp`、HUD 等级不一致 → loot 增 `syncPlayerStats`（`addXp`/`reset` 时同步），combat `Player.reset` 清 `stats.level`。
2. **同门派重开卡在 over**：`selectSect` 同门派不重开局 → UI `confirmSect` 同门派改发 `ui:restart`（`screens.js:663`），由 `main.beginRun` 复位。
3. **重复 selectSect 双发事件**：曾出现 `got 4, want 2` → 最终收敛为严格 `changed` 单次发事件，self-check/集成断言覆盖 playing、over、切换三门路径。
4. **AC-7 临时脚本污染**：`src/ui/.tmp-verify-same-sect.js` 使静态扫描 `got 4, want 3` → 由 presentation-fx 清理，src/ui 恢复 3 个脚本，集成回到 489/0。

## 5. 未完成 / 阻塞项

1. **AC-13 素材生成 0/14（阻塞，非代码缺陷）**：`tools/art/MANIFEST.json` 14 项全部 `status: failed`，原因均为 `ModuleNotFoundError: No module named 'torch'`；`pip install torch/diffusers/...`（`tools/art/scripts/install_deps.ps1`）被 ANS ShellGate 拒绝，需**操作者在本机手工执行**或明确批准安装。`tools/art/out/` 仅有 `README.txt`。
   - 解除后：art-generator 重跑 `generate.py`/`verify.py` 更新 MANIFEST；env-bootstrap 按 `status=ok` 转 WebP 接入 `assets/generated/` 并更新 `SOURCES.md`；再复跑集成。
   - 当前运行时按方案 §8.5 回退占位：`SOURCES.md` 14/14「占位（待生成素材接入）」，`assets/` 下 7 个程序化占位 SVG + CSS 占位，断网可正常启动（符合 AC-13 记录要求，但「素材被引用、观感区别于占位」未达成）。
2. **真实浏览器目视未由运营执行**：本环境无浏览器/HTTP 能力，AC-1~AC-13 的目视与真实帧率（尤其 AC-9~AC-13）需质检/客户在 Edge/Chrome 复验；运营不把无头测试当作验收通过。
3. **F3 第 27 个脚本偏差**：`index.html` 在 26 个契约脚本后追加 `tests/perf.js`（§4.2 要求 `WG.perf`，§3.2 清单未列），已在交付报告中如实登记，建议契约后续收编。
4. **已知扩展**：`stats` 加法字段 `pierce`/`projectileSpeed`/`potionDropMult`/`potionHealBonus` 由 sects 写、combat/loot 读，契约 §4.3 未列，建议下一版契约补录。

## 6. AC-1~AC-13 对照（证据口径）

| AC | 无头/静态证据 | 状态 |
| --- | --- | --- |
| AC-1 地图可移动 | 集成「移动与背景」阶段（位置连续、世界大于一屏、边界钳制） | 逻辑通过，待目视 |
| AC-2 自动攻击 | 集成「自动攻击与击杀」 | 逻辑通过，待目视 |
| AC-3 击杀掉落 | 集成「掉落与拾取」 | 逻辑通过，待目视 |
| AC-4 拾取生效 | 同上（计数/银两变化、磁吸） | 逻辑通过，待目视 |
| AC-5 升级成长 | self-check 137 项 + 集成升级阶段（三选一生效、F3 字段） | 逻辑通过，待目视 |
| AC-6 后期清屏 | F4 快进 330s、F5 120 怪潮（perf 52/16 项） | 逻辑通过，待目视帧率 |
| AC-7 非卡牌 | 集成 AC-7 静态扫描（src/ui 恰 3 脚本 + 命名扫描） | 通过（静态） |
| AC-8 可运行可复现 | 集成同 seed 两次、重开复位、`?seed=` | 逻辑通过，待目视 |
| AC-9 开始页 | ScreenFlow title 渲染断言 | 逻辑通过，**待浏览器目视** |
| AC-10 结算评分 | 集成 win/dead 结算、评分公式与对象一致 | 逻辑通过，**待浏览器目视** |
| AC-11 门派选择 | 三门派数值差异 + F3 详表断言 | 逻辑通过，**待浏览器目视** |
| AC-12 升级三选一 | 暂停/恢复、3 选项、立即生效、无重复 | 逻辑通过，**待浏览器目视** |
| AC-13 素材替换 | `MANIFEST` 0/14 failed、`SOURCES.md` 14 占位、断网回退路径 | **未达成**（依赖安装阻塞） |

## 7. 启动与复现

- 双击 `index.html` 或 `run.cmd`；Enter 开始；WASD 移动、Shift 闪身、F3 性能面板、R 结算后重开、F4 快进 5:30、F5 怪潮。
- 复现参数：`index.html?seed=1234`、`?timescale=4`、`?debug=1`。
- 回归：`node tests/integration-check.js`、`node src/sects/self-check.js`、`node tests/bench.js`。

## 8. 下一步（建议顺序）

1. 客户端运行 `tools/art/scripts/install_deps.ps1`（或批准 pip 安装）→ art-generator 重跑生成/校验 → env-bootstrap 接入并更新 `SOURCES.md` → 运营复跑集成与素材对账。
2. 质检（verifier）复验：无头全量回归 + AC-9~AC-13 浏览器操作核对；验收卡由质检发起。
3. 客户在真实浏览器完成 AC-1~AC-13 目视/帧率验收；运营不代客户验收、不发 acceptance 卡。
